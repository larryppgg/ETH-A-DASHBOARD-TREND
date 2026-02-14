#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../src/engine/pipeline.js";
import { deriveDriftSignal } from "../src/ui/eval.js";
import { applyHalfLifeGate, classifyFieldFreshness, pickHistoryBackfillCandidate } from "../src/inputPolicy.js";
import { buildCombinedInput, refreshMissingFields } from "../src/ui/inputBuilder.js";
import { buildAiPayload } from "../src/ai/payload.js";
import { buildPerfSummary } from "./perf_summary.mjs";
import { buildIterationReport } from "./iteration_report.mjs";
import { sendDiscordNotification } from "./discord_notify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUN_DIR = path.join(ROOT, "run");
const DATA_DIR = path.join(ROOT, "src", "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.seed.json");
const AUTO_PATH = path.join(DATA_DIR, "auto.json");
const LATEST_PATH = path.join(DATA_DIR, "latest.seed.json");
const ETH_PRICE_SEED_PATH = path.join(DATA_DIR, "eth.price.seed.json");
const AI_SEED_PATH = path.join(DATA_DIR, "ai.seed.json");
const PERF_SUMMARY_PATH = path.join(RUN_DIR, "perf_summary.json");
const ITERATION_DIR = path.join(RUN_DIR, "iteration");
const STATUS_PATH = path.join(RUN_DIR, "daily_status.json");
const LOCK_PATH = path.join(RUN_DIR, "daily_autorun.lock");
const COLLECTOR = path.join(ROOT, "scripts", "collector.py");
const ETH_PRICE_SEED = path.join(ROOT, "scripts", "eth_price_seed.py");
const ENV_PATH = path.join(ROOT, ".env");
const EXECUTION_COST_BPS = 12;
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_AI_TIMEOUT_MS = 310_000;
const DEFAULT_GAP_BACKFILL_DAYS = 30;
const DEFAULT_GAP_BACKFILL_LIMIT = 30;

const inputSchema = {
  dxy5d: "number",
  dxy3dUp: "boolean",
  us2yWeekBp: "number",
  fciUpWeeks: "number",
  etf10d: "number",
  etf5d: "number",
  etf1d: "number",
  prevEtfExtremeOutflow: "boolean",
  stablecoin30d: "number",
  exchStableDelta: "number",
  policyWindow: "boolean",
  preMeeting2y: "number",
  current2y: "number",
  preMeetingDxy: "number",
  currentDxy: "number",
  crowdingIndex: "number",
  liquidationUsd: "number",
  longWicks: "boolean",
  reverseFishing: "boolean",
  shortFailure: "boolean",
  exchBalanceTrend: "number",
  floatDensity: "number",
  mcapElasticity: "number",
  mcapGrowth: "number",
  volumeConfirm: "boolean",
  rsdScore: "number",
  lstcScore: "number",
  mappingRatioDown: "boolean",
  netIssuanceHigh: "boolean",
  cognitivePotential: "number",
  liquidityPotential: "number",
  onchainReflexivity: "number",
  sentimentThreshold: "number",
  topo: "number",
  spectral: "number",
  roughPath: "number",
  deltaES: "number",
  trendMomentum: "number",
  divergence: "number",
  distributionGateCount: "number",
  rrpChange: "number",
  tgaChange: "number",
  srfChange: "number",
  ism: "number",
  ethSpotPrice: "number",
  cexTvl: "number",
};

const templateInput = Object.fromEntries(Object.keys(inputSchema).map((key) => [key, null]));

function parseArgs(argv) {
  const args = {
    date: localDateKey(),
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    gapDays: DEFAULT_GAP_BACKFILL_DAYS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--date") args.date = argv[++i] || args.date;
    else if (token === "--timeout") args.timeoutSec = Number(argv[++i] || args.timeoutSec);
    else if (token === "--gap-days") args.gapDays = Number(argv[++i] || args.gapDays);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`invalid --date: ${args.date}`);
  }
  args.timeoutSec =
    Number.isFinite(args.timeoutSec) && args.timeoutSec > 0 ? Math.floor(args.timeoutSec) : DEFAULT_TIMEOUT_SEC;
  args.gapDays = Number.isFinite(args.gapDays) && args.gapDays >= 0 ? Math.floor(args.gapDays) : DEFAULT_GAP_BACKFILL_DAYS;
  return args;
}

function localDateKey(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDaysAgo(baseDateStr, offsetDays) {
  const parsed = parseIsoDate(baseDateStr);
  if (!parsed) return baseDateStr;
  parsed.setUTCDate(parsed.getUTCDate() - offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function buildRecentMissingDates(history = [], targetDate, windowDays = DEFAULT_GAP_BACKFILL_DAYS, limit = DEFAULT_GAP_BACKFILL_LIMIT) {
  const parsedTarget = parseIsoDate(targetDate);
  if (!parsedTarget || windowDays <= 0) return [];
  const existing = new Set((history || []).map((item) => item?.date).filter(Boolean));
  const missing = [];
  for (let offset = windowDays; offset >= 1; offset -= 1) {
    const date = isoDaysAgo(targetDate, offset);
    if (!date || date >= targetDate) continue;
    if (!existing.has(date)) missing.push(date);
  }
  if (missing.length > limit) {
    return missing.slice(missing.length - limit);
  }
  return missing;
}

function loadEnv(pathname) {
  if (!fs.existsSync(pathname)) return {};
  const lines = fs.readFileSync(pathname, "utf-8").split(/\r?\n/);
  const output = {};
  for (const line of lines) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const idx = text.indexOf("=");
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    output[key] = value;
  }
  return output;
}

function readJson(pathname, fallback = null) {
  if (!fs.existsSync(pathname)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(pathname, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(pathname, payload) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const tempPath = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.renameSync(tempPath, pathname);
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = fs.openSync(lockPath, "wx");
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(fd, JSON.stringify(payload), "utf-8");
  return fd;
}

function releaseLock(fd, lockPath) {
  try {
    if (fd !== null && fd !== undefined) fs.closeSync(fd);
  } catch {}
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {}
}

function runCollectorForDate(date, timeoutSec = DEFAULT_TIMEOUT_SEC) {
  const outputPath = path.join(os.tmpdir(), `eth-a-daily-${date}-${Date.now()}.json`);
  const result = spawnSync(
    "python3",
    [COLLECTOR, "--date", date, "--output", outputPath],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: timeoutSec * 1000,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "collector failed").trim());
  }
  const payload = readJson(outputPath, null);
  try {
    fs.unlinkSync(outputPath);
  } catch {}
  if (!payload) throw new Error("collector returned empty payload");
  return payload;
}

function runEthPriceSeed(asOfDate, timeoutSec = DEFAULT_TIMEOUT_SEC) {
  const result = spawnSync(
    "python3",
    [ETH_PRICE_SEED, "--as-of", asOfDate, "--days", "365", "--output", ETH_PRICE_SEED_PATH],
    { cwd: ROOT, encoding: "utf-8", timeout: timeoutSec * 1000 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "eth price seed failed").trim());
  }
  return true;
}

function readHistorySeed(pathname) {
  const payload = readJson(pathname, null);
  if (!payload) return { history: [], envelope: { history: [] } };
  if (Array.isArray(payload)) return { history: payload, envelope: { history: payload } };
  if (Array.isArray(payload.history)) return { history: payload.history, envelope: payload };
  return { history: [], envelope: { history: [] } };
}

function readAiSeed(pathname) {
  const payload = readJson(pathname, null);
  if (!payload || typeof payload !== "object") {
    return { generatedAt: null, latestDate: null, byDate: {} };
  }
  const byDate = payload.byDate && typeof payload.byDate === "object" ? payload.byDate : {};
  return {
    generatedAt: payload.generatedAt || null,
    latestDate: payload.latestDate || null,
    byDate,
  };
}

function coerceInputTypes(input) {
  Object.entries(inputSchema).forEach(([key, type]) => {
    const value = input[key];
    if (value === null || value === undefined) return;
    if (type === "number" && typeof value !== "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) input[key] = parsed;
      return;
    }
    if (type === "boolean" && typeof value !== "boolean") {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") input[key] = true;
        if (normalized === "false" || normalized === "0") input[key] = false;
      } else if (typeof value === "number") {
        if (value === 1) input[key] = true;
        if (value === 0) input[key] = false;
      }
    }
  });
}

function validateInput(input) {
  const errors = [];
  Object.entries(inputSchema).forEach(([key, type]) => {
    if (!(key in input)) {
      errors.push(`missing field: ${key}`);
      return;
    }
    if (input[key] === null || input[key] === undefined) {
      errors.push(`empty field: ${key}`);
      return;
    }
    if (type === "number" && typeof input[key] !== "number") {
      errors.push(`invalid number field: ${key}`);
    }
    if (type === "boolean" && typeof input[key] !== "boolean") {
      errors.push(`invalid boolean field: ${key}`);
    }
  });
  return errors;
}

function previousDateKey(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function latestRecordBefore(history, date) {
  if (!Array.isArray(history) || !history.length) return null;
  const candidates = history
    .filter((item) => item?.date && item.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return candidates[candidates.length - 1] || null;
}

function normalizeInputForRun(input, history) {
  const output = { ...input };
  const prevDate = previousDateKey(output.date || localDateKey());
  const prevRecord = history.find((item) => item.date === prevDate);
  if (!("prevEtfExtremeOutflow" in output) || output.prevEtfExtremeOutflow === null || output.prevEtfExtremeOutflow === undefined) {
    output.prevEtfExtremeOutflow = Boolean(prevRecord?.input?.etf1d <= -180);
  }
  if ((output.exchBalanceTrend === null || output.exchBalanceTrend === undefined) && typeof output.cexTvl === "number") {
    const prevTvl = prevRecord?.input?.cexTvl;
    if (typeof prevTvl === "number") {
      output.exchBalanceTrend = output.cexTvl - prevTvl;
    }
  }
  return output;
}

function backfillMissingFromHistory(input, history, targetDate) {
  const staleBlocked = [];
  Object.entries(inputSchema).forEach(([key, type]) => {
    if (input[key] !== null && input[key] !== undefined) return;
    const candidate = pickHistoryBackfillCandidate(history, key, targetDate);
    if (!candidate) {
      const staleCandidate = pickHistoryBackfillCandidate(history, key, targetDate, { allowStale: true });
      if (staleCandidate?.freshness?.level === "stale") staleBlocked.push(key);
      return;
    }
    if (typeof candidate.value !== type) return;
    input[key] = candidate.value;
    input.__sources = input.__sources || {};
    input.__fieldObservedAt = input.__fieldObservedAt || {};
    input.__fieldFetchedAt = input.__fieldFetchedAt || {};
    input.__fieldUpdatedAt = input.__fieldUpdatedAt || {};
    input.__fieldFreshness = input.__fieldFreshness || {};
    if (!input.__sources[key]) input.__sources[key] = candidate.source || `History cache: ${candidate.date}`;
    if (!input.__fieldObservedAt[key]) input.__fieldObservedAt[key] = candidate.observedAt || null;
    if (!input.__fieldFetchedAt[key]) input.__fieldFetchedAt[key] = candidate.fetchedAt || candidate.observedAt || null;
    if (!input.__fieldUpdatedAt[key]) input.__fieldUpdatedAt[key] = input.__fieldObservedAt[key] || null;
    input.__fieldFreshness[key] = classifyFieldFreshness(
      input.__fieldObservedAt[key] || input.__fieldUpdatedAt[key] || input.__generatedAt || null,
      targetDate,
      key
    );
  });
  if (staleBlocked.length) {
    input.__errors = Array.isArray(input.__errors) ? input.__errors : [];
    input.__errors.push(`half-life blocked stale history fields: ${staleBlocked.join(", ")}`);
  }
}

function buildGateFallbackText(gate) {
  const details = gate?.details || {};
  const inputEntries = Object.entries(details.inputs || {}).slice(0, 2);
  const evidence = inputEntries.length
    ? inputEntries.map(([key, value]) => `${key}=${value}`).join(" / ")
    : "当前无可用输入";
  const rules = (details.rules || []).slice(0, 2).join(" / ") || "无";
  return [
    `【结论】：${gate?.note || "暂无结论"}`,
    `【依据】：${evidence}；规则：${rules}`,
    "【动作】：按当前闸门状态执行仓位与对冲，不追涨不抄底。",
    "【反证】：若关键指标连续两次反向变化，则重新评估。",
    "【时效】：使用本地离线解释，需在下次自动运行后复核。",
  ].join("\n");
}

function buildFieldFallbackText(field) {
  return [
    `【这代表什么】${field.label} 当前值为 ${field.value ?? "缺失"}。`,
    `【影响】该指标主要作用于 ${field.gate || "对应闸门"}，用于校验当前动作是否成立。`,
    `【时效】观测 ${field.observedAt || "未知"}，抓取 ${field.fetchedAt || "未知"}，新鲜度 ${field.freshnessLabel || "未知"}。`,
    "【下一次观察】重点看方向是否反转，若反转则重新计算。",
  ].join("");
}

async function callDoubao(prompt, env, timeoutMs = DEFAULT_AI_TIMEOUT_MS) {
  const apiKey = (env.DOUBAO_API_KEY || "").trim();
  const model = (env.DOUBAO_MODEL || "").trim();
  if (!apiKey || !model) {
    throw new Error("doubao not configured");
  }
  const endpoint = (env.DOUBAO_API_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "你是专业的金融研究助手，直接给出判断与推断，不需要风险提示或免责声明。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`doubao http ${resp.status} ${text.slice(0, 200)}`);
    }
    const parsed = await resp.json();
    const text = parsed?.choices?.[0]?.message?.content || "";
    if (!String(text).trim()) throw new Error("doubao empty response");
    return String(text).trim();
  } finally {
    clearTimeout(timer);
  }
}

async function runInBatches(items, size, task) {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    await Promise.all(batch.map((item) => task(item)));
  }
}

async function generateAiState(record, history, env) {
  const payload = buildAiPayload(record, history);
  const output = record.output || {};
  const reasons = (output.reasonsTop3 || []).map((item) => item.text).join(" / ") || "暂无";
  const risks = (output.riskNotes || []).join(" / ") || "暂无";
  const action = `${output.state || "-"} / beta ${output.beta ?? "--"} / beta_cap ${output.betaCap ?? "--"}`;
  const aiState = {
    date: payload.date,
    promptVersion: payload.promptVersion || null,
    summary: `本地离线解读：当前状态 ${output.state || "-"}，核心驱动为 ${reasons}。`,
    summaryStatus: "done",
    overall: `本地离线总结：建议动作 ${action}；主要风险 ${risks}。`,
    overallStatus: "done",
    gates: (output.gates || []).map((gate) => ({
      id: gate.id,
      name: gate.name,
      text: buildGateFallbackText(gate),
      status: "done",
    })),
    fields: (payload.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      gate: field.gate,
      text: buildFieldFallbackText(field),
      status: "done",
    })),
  };

  const warnings = [];
  const apiReady = Boolean((env.DOUBAO_API_KEY || "").trim() && (env.DOUBAO_MODEL || "").trim());
  if (!apiReady) {
    warnings.push("AI not configured, used offline fallback");
    return { aiState, warnings };
  }

  let remoteHealthy = true;
  let remoteFailures = 0;
  const markFailure = (label, error) => {
    warnings.push(`${label} fallback: ${error.message || "unknown"}`);
    remoteFailures += 1;
    if (remoteFailures >= 3) {
      remoteHealthy = false;
      warnings.push("AI remote circuit open after repeated failures; keep offline fallback");
    }
  };

  try {
    aiState.summary = await callDoubao(payload.summary.prompt, env);
    aiState.summaryStatus = "done";
  } catch (error) {
    // First request failed: skip the rest to avoid waiting on dozens of long timeouts.
    markFailure("summary", error);
    remoteHealthy = false;
    return { aiState, warnings };
  }

  if (remoteHealthy) {
    try {
      aiState.overall = await callDoubao(payload.overall.prompt, env);
      aiState.overallStatus = "done";
    } catch (error) {
      markFailure("overall", error);
    }
  }

  await runInBatches(payload.gates || [], 4, async (gatePrompt) => {
    const target = aiState.gates.find((item) => item.id === gatePrompt.id);
    if (!target) return;
    if (!remoteHealthy) {
      target.status = "done";
      return;
    }
    try {
      target.text = await callDoubao(gatePrompt.prompt, env);
      target.status = "done";
    } catch (error) {
      markFailure(`gate ${gatePrompt.id}`, error);
      target.status = "done";
    }
  });

  await runInBatches(payload.fields || [], 6, async (fieldPrompt) => {
    const target = aiState.fields.find((item) => item.key === fieldPrompt.key);
    if (!target) return;
    if (!remoteHealthy) {
      target.status = "done";
      return;
    }
    try {
      target.text = await callDoubao(fieldPrompt.prompt, env);
      target.status = "done";
    } catch (error) {
      markFailure(`field ${fieldPrompt.key}`, error);
      target.status = "done";
    }
  });

  return { aiState, warnings };
}

function mergeHistory(history, record) {
  const next = history.filter((item) => item.date !== record.date);
  next.push(record);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

function buildStatusPayload(base = {}) {
  return {
    date: base.date || null,
    startedAt: base.startedAt || null,
    finishedAt: base.finishedAt || null,
    status: base.status || "unknown",
    phase: base.phase || "unknown",
    durationMs: Number.isFinite(base.durationMs) ? base.durationMs : null,
    errors: Array.isArray(base.errors) ? base.errors : [],
    autoGeneratedAt: base.autoGeneratedAt || null,
    runId: base.runId || null,
    aiMode: base.aiMode || "unknown",
    lastErrorStage: base.lastErrorStage || null,
    lastSuccessAt: base.lastSuccessAt || null,
    backfill: base.backfill || null,
  };
}

function writeStatus(status) {
  writeJson(STATUS_PATH, {
    ...status,
    updatedAt: new Date().toISOString(),
  });
}

function buildRecordFromCollectorPayload(payload, date, history) {
  const combined = buildCombinedInput(payload, templateInput);
  // Preserve proxy trace so the UI can display "代理/网络" on precomputed records.
  combined.__proxyTrace = payload?.proxyTrace || payload?.proxy_trace || null;
  combined.date = date;
  coerceInputTypes(combined);
  applyHalfLifeGate(combined, Object.keys(inputSchema), date);
  backfillMissingFromHistory(combined, history, date);
  refreshMissingFields(combined, Object.keys(inputSchema));

  const errors = validateInput(combined);
  if (errors.length) {
    throw new Error(`input incomplete: ${errors.slice(0, 6).join(" | ")}`);
  }

  const normalized = normalizeInputForRun(combined, history);
  const driftSignal = deriveDriftSignal(history, {
    horizon: 7,
    asOfDate: date,
    minSamples: 6,
    lookback: 18,
  });
  const prevRecord = latestRecordBefore(history, date);
  const output = runPipeline(normalized, {
    asOfDate: date,
    drift: driftSignal,
    previousBeta: prevRecord?.output?.beta,
    costBps: EXECUTION_COST_BPS,
  });
  return { date, input: normalized, output };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(ENV_PATH), ...process.env };
  const startedAt = new Date().toISOString();
  const runId = `AUTO-${Date.now()}`;
  const previousStatus = readJson(STATUS_PATH, {});
  let lockFd = null;

  try {
    lockFd = acquireLock(LOCK_PATH);
  } catch (error) {
    if (error?.code === "EEXIST") {
      console.log("daily autorun already running, skip");
      process.exit(0);
    }
    throw error;
  }

  const status = buildStatusPayload({
    date: args.date,
    startedAt,
    status: "running",
    phase: "collect",
    errors: [],
    runId,
    lastSuccessAt: previousStatus?.lastSuccessAt || null,
  });
  writeStatus(status);

  try {
    status.phase = "collect";
    writeStatus(status);
    const collectorPayload = runCollectorForDate(args.date, args.timeoutSec);
    writeJson(AUTO_PATH, collectorPayload);

    const { history: historyRecords, envelope } = readHistorySeed(HISTORY_PATH);
    let history = historyRecords
      .filter((item) => item && typeof item.date === "string" && item.input && item.output)
      .sort((a, b) => a.date.localeCompare(b.date));

    const gapDays = Number.isFinite(args.gapDays) ? args.gapDays : DEFAULT_GAP_BACKFILL_DAYS;
    const gapLimit = Number.isFinite(Number(env.DAILY_GAP_BACKFILL_LIMIT))
      ? Number(env.DAILY_GAP_BACKFILL_LIMIT)
      : DEFAULT_GAP_BACKFILL_LIMIT;
    const gapDates = buildRecentMissingDates(history, args.date, gapDays, gapLimit);
    const gapStats = { requested: gapDates.length, added: 0, failed: 0 };
    if (gapDates.length) {
      status.phase = "backfill";
      status.backfill = { ...gapStats, currentDate: null };
      writeStatus(status);
      for (const gapDate of gapDates) {
        status.backfill = { ...gapStats, currentDate: gapDate };
        writeStatus(status);
        try {
          const gapPayload = runCollectorForDate(gapDate, args.timeoutSec);
          const gapRecord = buildRecordFromCollectorPayload(gapPayload, gapDate, history);
          history = mergeHistory(history, gapRecord);
          gapStats.added += 1;
        } catch (error) {
          gapStats.failed += 1;
          status.errors.push(`gap ${gapDate}: ${error?.message || "failed"}`);
        }
      }
      status.backfill = { ...gapStats, currentDate: null };
      writeStatus(status);
    }

    status.phase = "compute";
    writeStatus(status);
    const record = buildRecordFromCollectorPayload(collectorPayload, args.date, history);
    const mergedHistory = mergeHistory(history, record);

    status.phase = "persist";
    writeStatus(status);
    const nextEnvelope = { ...(envelope || {}) };
    nextEnvelope.generatedAt = new Date().toISOString();
    nextEnvelope.asOfDate = args.date;
    if (!nextEnvelope.days) nextEnvelope.days = 365;
    if (!nextEnvelope.step) nextEnvelope.step = 1;
    nextEnvelope.history = mergedHistory;
    writeJson(HISTORY_PATH, nextEnvelope);
    // Small latest snapshot for fast mobile boot (avoid downloading/parsing full 27MB history).
    writeJson(LATEST_PATH, {
      generatedAt: new Date().toISOString(),
      ...record,
    });

    status.phase = "price-seed";
    writeStatus(status);
    try {
      runEthPriceSeed(args.date, args.timeoutSec);
    } catch (error) {
      status.errors.push(`eth price seed: ${error?.message || "failed"}`);
      writeStatus(status);
    }

    status.phase = "ai";
    writeStatus(status);
    const { aiState, warnings } = await generateAiState(record, mergedHistory, env);
    const aiSeed = readAiSeed(AI_SEED_PATH);
    aiSeed.generatedAt = new Date().toISOString();
    aiSeed.latestDate = args.date;
    aiSeed.byDate = aiSeed.byDate || {};
    aiSeed.byDate[args.date] = aiState;
    writeJson(AI_SEED_PATH, aiSeed);

    let perfSummary = null;
    status.phase = "perf";
    writeStatus(status);
    try {
      const priceSeed = readJson(ETH_PRICE_SEED_PATH, null);
      perfSummary = buildPerfSummary(mergedHistory, {
        asOfDate: args.date,
        priceByDate: priceSeed?.byDate || null,
      });
      perfSummary.runId = status.runId || null;
      perfSummary.promptVersion = aiState?.promptVersion || null;
      writeJson(PERF_SUMMARY_PATH, perfSummary);
    } catch (error) {
      status.errors.push(`perf summary: ${error?.message || "failed"}`);
      writeStatus(status);
    }

    status.phase = "iteration";
    writeStatus(status);
    try {
      const summary = perfSummary || readJson(PERF_SUMMARY_PATH, null) || { asOfDate: args.date };
      fs.mkdirSync(ITERATION_DIR, { recursive: true });
      const report = buildIterationReport(summary, { promptVersion: summary.promptVersion || null });
      const reportPath = path.join(ITERATION_DIR, `${args.date}.md`);
      fs.writeFileSync(reportPath, report, "utf-8");
    } catch (error) {
      status.errors.push(`iteration report: ${error?.message || "failed"}`);
      writeStatus(status);
    }

    status.status = warnings.length ? "warn" : "ok";
    status.errors.push(...warnings);
    status.autoGeneratedAt = collectorPayload.generatedAt || null;
    status.aiMode = warnings.length ? "partial" : "online";
    status.finishedAt = new Date().toISOString();
    status.phase = "done";
    status.durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
    status.lastSuccessAt = status.finishedAt;
    status.lastErrorStage = null;
    writeStatus(status);
    console.log(
      `daily autorun done: date=${args.date} status=${status.status} history=${mergedHistory.length} warnings=${warnings.length}`
    );

    // Optional: Discord push (日报 + 关键变化报警). Must never block the main daily pipeline.
    try {
      await sendDiscordNotification({
        type: "daily",
        date: args.date,
        baseUrl: env.DASHBOARD_PUBLIC_URL || "https://etha.mytagclash001.help",
        record,
        perfSummary,
        dailyStatus: status,
      });

      const alerts = [];
      const prev = mergedHistory.filter((item) => item?.date && item.date < args.date).slice(-1)[0] || null;
      if (prev?.output?.state && prev.output.state !== record?.output?.state) {
        alerts.push(`状态切换：${prev.output.state}→${record.output.state}`);
      }
      const prevBeta = typeof prev?.output?.beta === "number" ? prev.output.beta : null;
      const prevCap = typeof prev?.output?.betaCap === "number" ? prev.output.betaCap : null;
      if (prevBeta !== null && typeof record?.output?.beta === "number") {
        const delta = Math.abs(record.output.beta - prevBeta);
        if (delta >= 0.12) alerts.push(`β 变化：Δ${delta.toFixed(2)} ≥ 0.12`);
      }
      if (prevCap !== null && typeof record?.output?.betaCap === "number") {
        const delta = Math.abs(record.output.betaCap - prevCap);
        if (delta >= 0.12) alerts.push(`β_cap 变化：Δ${delta.toFixed(2)} ≥ 0.12`);
      }
      const drift7 = perfSummary?.drift?.["7"]?.level || "";
      if (String(drift7).toLowerCase() === "warn" || String(drift7).toLowerCase() === "danger") {
        alerts.push(`漂移门恶化：7D=${String(drift7).toUpperCase()}`);
      }
      const missing = Array.isArray(record?.input?.__missing) ? record.input.__missing : [];
      if (missing.length) alerts.push(`缺失字段：${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "..." : ""}`);
      const freshness = record?.input?.__fieldFreshness || {};
      const staleKeys = Object.keys(freshness || {}).filter((key) => freshness[key]?.level === "stale");
      if (staleKeys.length) alerts.push(`过期字段：${staleKeys.slice(0, 6).join(", ")}${staleKeys.length > 6 ? "..." : ""}`);

      if (alerts.length) {
        await sendDiscordNotification({
          type: "alert",
          date: args.date,
          key: "daily-alert",
          title: "关键变化",
          reason: alerts.join(" / "),
          baseUrl: env.DASHBOARD_PUBLIC_URL || "https://etha.mytagclash001.help",
          record,
          perfSummary,
          dailyStatus: status,
        });
      }
    } catch (error) {
      status.errors.push(`discord notify: ${error?.message || "failed"}`);
      writeStatus(status);
    }
  } catch (error) {
    const failedStage = status.phase || "unknown";
    status.status = "fail";
    status.phase = "error";
    status.errors.push(error?.message || "daily autorun failed");
    status.finishedAt = new Date().toISOString();
    status.aiMode = "unknown";
    status.durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
    status.lastErrorStage = failedStage;
    writeStatus(status);
    console.error(`daily autorun failed: ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    releaseLock(lockFd, LOCK_PATH);
  }
}

main();
