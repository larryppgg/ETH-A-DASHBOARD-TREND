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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUN_DIR = path.join(ROOT, "run");
const DATA_DIR = path.join(ROOT, "src", "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.seed.json");
const AUTO_PATH = path.join(DATA_DIR, "auto.json");
const AI_SEED_PATH = path.join(DATA_DIR, "ai.seed.json");
const STATUS_PATH = path.join(RUN_DIR, "daily_status.json");
const LOCK_PATH = path.join(RUN_DIR, "daily_autorun.lock");
const COLLECTOR = path.join(ROOT, "scripts", "collector.py");
const ENV_PATH = path.join(ROOT, ".env");
const EXECUTION_COST_BPS = 12;
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_AI_TIMEOUT_MS = 310_000;

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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--date") args.date = argv[++i] || args.date;
    else if (token === "--timeout") args.timeoutSec = Number(argv[++i] || args.timeoutSec);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`invalid --date: ${args.date}`);
  }
  args.timeoutSec =
    Number.isFinite(args.timeoutSec) && args.timeoutSec > 0 ? Math.floor(args.timeoutSec) : DEFAULT_TIMEOUT_SEC;
  return args;
}

function localDateKey(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
    errors: Array.isArray(base.errors) ? base.errors : [],
    autoGeneratedAt: base.autoGeneratedAt || null,
    runId: base.runId || null,
    aiMode: base.aiMode || "unknown",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(ENV_PATH), ...process.env };
  const startedAt = new Date().toISOString();
  const runId = `AUTO-${Date.now()}`;
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
    errors: [],
    runId,
  });
  writeJson(STATUS_PATH, status);

  try {
    const collectorPayload = runCollectorForDate(args.date, args.timeoutSec);
    writeJson(AUTO_PATH, collectorPayload);

    const { history: historyRecords, envelope } = readHistorySeed(HISTORY_PATH);
    const history = historyRecords
      .filter((item) => item && typeof item.date === "string" && item.input && item.output)
      .sort((a, b) => a.date.localeCompare(b.date));

    const combined = buildCombinedInput(collectorPayload, templateInput);
    combined.date = args.date;
    coerceInputTypes(combined);
    applyHalfLifeGate(combined, Object.keys(inputSchema), args.date);
    backfillMissingFromHistory(combined, history, args.date);
    refreshMissingFields(combined, Object.keys(inputSchema));

    const errors = validateInput(combined);
    if (errors.length) {
      throw new Error(`daily run aborted: ${errors.slice(0, 6).join(" | ")}`);
    }

    const normalized = normalizeInputForRun(combined, history);
    const driftSignal = deriveDriftSignal(history, {
      horizon: 7,
      asOfDate: args.date,
      minSamples: 6,
      lookback: 18,
    });
    const prevRecord = latestRecordBefore(history, args.date);
    const output = runPipeline(normalized, {
      asOfDate: args.date,
      drift: driftSignal,
      previousBeta: prevRecord?.output?.beta,
      costBps: EXECUTION_COST_BPS,
    });
    const record = { date: args.date, input: normalized, output };
    const mergedHistory = mergeHistory(history, record);

    const nextEnvelope = { ...(envelope || {}) };
    nextEnvelope.generatedAt = new Date().toISOString();
    if (!nextEnvelope.asOfDate) nextEnvelope.asOfDate = args.date;
    if (!nextEnvelope.days) nextEnvelope.days = 365;
    if (!nextEnvelope.step) nextEnvelope.step = 1;
    nextEnvelope.history = mergedHistory;
    writeJson(HISTORY_PATH, nextEnvelope);

    const { aiState, warnings } = await generateAiState(record, mergedHistory, env);
    const aiSeed = readAiSeed(AI_SEED_PATH);
    aiSeed.generatedAt = new Date().toISOString();
    aiSeed.latestDate = args.date;
    aiSeed.byDate = aiSeed.byDate || {};
    aiSeed.byDate[args.date] = aiState;
    writeJson(AI_SEED_PATH, aiSeed);

    status.status = warnings.length ? "warn" : "ok";
    status.errors.push(...warnings);
    status.autoGeneratedAt = collectorPayload.generatedAt || null;
    status.aiMode = warnings.length ? "partial" : "online";
    status.finishedAt = new Date().toISOString();
    writeJson(STATUS_PATH, status);
    console.log(
      `daily autorun done: date=${args.date} status=${status.status} history=${mergedHistory.length} warnings=${warnings.length}`
    );
  } catch (error) {
    status.status = "fail";
    status.errors.push(error?.message || "daily autorun failed");
    status.finishedAt = new Date().toISOString();
    status.aiMode = "unknown";
    writeJson(STATUS_PATH, status);
    console.error(`daily autorun failed: ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    releaseLock(lockFd, LOCK_PATH);
  }
}

main();
