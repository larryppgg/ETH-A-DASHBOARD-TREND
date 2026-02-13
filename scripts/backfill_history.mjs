#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../src/engine/pipeline.js";
import { deriveDriftSignal } from "../src/ui/eval.js";
import { applyHalfLifeGate, pickHistoryBackfillCandidate } from "../src/inputPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COLLECTOR = path.join(ROOT, "scripts", "collector.py");
const DEFAULT_OUTPUT = path.join(ROOT, "src", "data", "history.seed.json");
const DEFAULT_STATUS_OUTPUT = path.join(ROOT, "run", "backfill_status.json");
const LOCK_PATH = path.join(ROOT, "run", "backfill_history.lock");
const EXECUTION_COST_BPS = 12;
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

function parseArgs(argv) {
  const args = {
    days: 365,
    step: 1,
    horizon: 14,
    asOf: new Date().toISOString().slice(0, 10),
    output: DEFAULT_OUTPUT,
    statusOutput: DEFAULT_STATUS_OUTPUT,
    timeoutSec: 600,
    resume: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--days") args.days = Number(argv[++i] || args.days);
    else if (token === "--step") args.step = Number(argv[++i] || args.step);
    else if (token === "--horizon") args.horizon = Number(argv[++i] || args.horizon);
    else if (token === "--as-of") args.asOf = argv[++i] || args.asOf;
    else if (token === "--output") args.output = path.resolve(ROOT, argv[++i] || args.output);
    else if (token === "--status-output") args.statusOutput = path.resolve(ROOT, argv[++i] || args.statusOutput);
    else if (token === "--timeout") args.timeoutSec = Number(argv[++i] || args.timeoutSec);
    else if (token === "--no-resume") args.resume = false;
  }
  args.days = Number.isFinite(args.days) && args.days > 0 ? Math.floor(args.days) : 365;
  args.step = Number.isFinite(args.step) && args.step > 0 ? Math.floor(args.step) : 7;
  args.horizon = Number.isFinite(args.horizon) && args.horizon > 0 ? Math.floor(args.horizon) : 14;
  args.timeoutSec = Number.isFinite(args.timeoutSec) && args.timeoutSec > 0 ? Math.floor(args.timeoutSec) : 600;
  return args;
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
  const tmpPath = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.renameSync(tmpPath, pathname);
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = fs.openSync(lockPath, "wx");
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf-8");
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

function parseIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDaysAgo(offsetDays, baseDate) {
  const parsed = parseIsoDate(baseDate);
  if (!parsed) return baseDate;
  parsed.setUTCDate(parsed.getUTCDate() - offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function buildBackfillDates(days, asOfDate, horizonDays, step) {
  const dates = [];
  for (let offset = days + horizonDays; offset >= horizonDays; offset -= step) {
    dates.push(isoDaysAgo(offset, asOfDate));
  }
  const latestMatured = isoDaysAgo(horizonDays, asOfDate);
  if (!dates.includes(latestMatured)) {
    dates.push(latestMatured);
  }
  return dates.sort((a, b) => a.localeCompare(b));
}

function previousDateKey(dateStr) {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) return dateStr;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function latestRecordBefore(history, date) {
  const candidates = history
    .filter((item) => item?.date && item.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return candidates[candidates.length - 1] || null;
}

function refreshMissingFields(input) {
  const keys = Object.keys(inputSchema);
  input.__missing = keys.filter((key) => input[key] === null || input[key] === undefined);
  return input.__missing;
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
      errors.push(`缺少字段：${key}`);
      return;
    }
    if (input[key] === null || input[key] === undefined) {
      errors.push(`字段为空：${key}`);
      return;
    }
    if (type === "number" && typeof input[key] !== "number") {
      errors.push(`字段类型错误：${key} 需要 number`);
    }
    if (type === "boolean" && typeof input[key] !== "boolean") {
      errors.push(`字段类型错误：${key} 需要 boolean`);
    }
  });
  return errors;
}

function hydrateMetadata(input, payload) {
  input.__sources = payload.sources || {};
  input.__errors = payload.errors || [];
  input.__missing = payload.missing || [];
  input.__generatedAt = payload.generatedAt || null;
  input.__targetDate = payload.targetDate || null;
  input.__proxyTrace = payload.proxyTrace || [];
  input.__fieldObservedAt = payload.fieldObservedAt || {};
  input.__fieldFetchedAt = payload.fieldFetchedAt || {};
  input.__fieldUpdatedAt = payload.fieldUpdatedAt || {};
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
    if (!input.__sources[key]) input.__sources[key] = candidate.source || `History cache: ${candidate.date}`;
    if (!input.__fieldObservedAt[key]) input.__fieldObservedAt[key] = candidate.observedAt || null;
    if (!input.__fieldFetchedAt[key]) input.__fieldFetchedAt[key] = candidate.fetchedAt || candidate.observedAt || null;
    if (!input.__fieldUpdatedAt[key]) input.__fieldUpdatedAt[key] = input.__fieldObservedAt[key] || null;
  });
  if (staleBlocked.length) {
    input.__errors = Array.isArray(input.__errors) ? input.__errors : [];
    input.__errors.push(`半衰期拦截：以下字段本地历史已过期，未回填 ${staleBlocked.join(", ")}`);
  }
}

function normalizeInputForRun(input, history, date) {
  const output = { ...input };
  const prevDate = previousDateKey(date);
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

function sleepMs(ms) {
  if (!ms || ms <= 0) return;
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function runCollectorForDate(date, timeoutSec) {
  const retries = 2;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const outputPath = path.join(os.tmpdir(), `eth-a-hist-${date}-${Date.now()}-${attempt}.json`);
    try {
      const result = spawnSync("python3", [COLLECTOR, "--date", date, "--output", outputPath], {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: timeoutSec * 1000,
      });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || "collector failed").trim());
      }
      const payload = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      fs.unlinkSync(outputPath);
      return payload;
    } catch (error) {
      lastError = error;
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}
      if (attempt < retries) {
        sleepMs(500 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError || new Error("collector failed");
}

function readSeedHistory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.history)) return payload.history;
    return [];
  } catch {
    return [];
  }
}

function buildBackfillStatus(base = {}) {
  return {
    status: base.status || "idle",
    phase: base.phase || "idle",
    asOfDate: base.asOfDate || null,
    days: Number.isFinite(base.days) ? base.days : null,
    step: Number.isFinite(base.step) ? base.step : null,
    horizon: Number.isFinite(base.horizon) ? base.horizon : null,
    startedAt: base.startedAt || null,
    finishedAt: base.finishedAt || null,
    total: Number.isFinite(base.total) ? base.total : 0,
    processed: Number.isFinite(base.processed) ? base.processed : 0,
    added: Number.isFinite(base.added) ? base.added : 0,
    skipped: Number.isFinite(base.skipped) ? base.skipped : 0,
    failed: Number.isFinite(base.failed) ? base.failed : 0,
    remaining: Number.isFinite(base.remaining) ? base.remaining : 0,
    currentDate: base.currentDate || null,
    failures: Array.isArray(base.failures) ? base.failures : [],
    message: base.message || "",
    output: base.output || null,
    updatedAt: new Date().toISOString(),
  };
}

function writeBackfillStatus(pathname, status) {
  writeJson(pathname, buildBackfillStatus(status));
}

function resolveSeedClose(priceByDate, dateKey) {
  if (!priceByDate || !dateKey) return null;
  const candidate = priceByDate[dateKey];
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  const close = candidate?.close;
  return typeof close === "number" && Number.isFinite(close) ? close : null;
}

function fillEthSpotPriceFromSeed(input, priceByDate, dateKey) {
  if (!input || !priceByDate || !dateKey) return false;
  const current = input.ethSpotPrice;
  const usable = typeof current === "number" && Number.isFinite(current) && current > 0;
  if (usable) return false;
  const close = resolveSeedClose(priceByDate, dateKey);
  if (close === null) return false;
  input.ethSpotPrice = close;
  input.__sources = input.__sources || {};
  input.__fieldObservedAt = input.__fieldObservedAt || {};
  input.__fieldFetchedAt = input.__fieldFetchedAt || {};
  input.__fieldUpdatedAt = input.__fieldUpdatedAt || {};
  input.__sources.ethSpotPrice = "Seed: eth.price.seed.json close";
  input.__fieldObservedAt.ethSpotPrice = `${dateKey}T00:00:00Z`;
  input.__fieldUpdatedAt.ethSpotPrice = `${dateKey}T00:00:00Z`;
  // Fetch time is "now" but observation is historical close; keep fetchedAt as runtime.
  input.__fieldFetchedAt.ethSpotPrice = new Date().toISOString();
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const priceSeedPath = path.join(ROOT, "src", "data", "eth.price.seed.json");
  const priceSeed = readJson(priceSeedPath, null);
  const priceByDate = priceSeed?.byDate && typeof priceSeed.byDate === "object" ? priceSeed.byDate : null;
  let lockFd = null;
  try {
    lockFd = acquireLock(LOCK_PATH);
  } catch (error) {
    if (error?.code === "EEXIST") {
      writeBackfillStatus(args.statusOutput, {
        status: "running",
        phase: "locked",
        message: "已有回填任务在运行，跳过重复启动",
      });
      console.log("已有回填任务在运行，已跳过。");
      return;
    }
    throw error;
  }

  const dates = buildBackfillDates(args.days, args.asOf, args.horizon, args.step);
  let history = (args.resume ? readSeedHistory(args.output) : [])
    .filter((item) => item && typeof item.date === "string" && item.input && item.output)
    .sort((a, b) => a.date.localeCompare(b.date));

  const startAt = new Date().toISOString();
  const failedList = [];
  let added = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  writeBackfillStatus(args.statusOutput, {
    status: "running",
    phase: "collect",
    asOfDate: args.asOf,
    days: args.days,
    step: args.step,
    horizon: args.horizon,
    startedAt: startAt,
    total: dates.length,
    processed,
    added,
    skipped,
    failed,
    remaining: Math.max(0, dates.length - processed),
    output: args.output,
    message: "回填任务已启动",
  });

  console.log(`开始回测补齐: as-of=${args.asOf}, days=${args.days}, step=${args.step}, samples=${dates.length}`);
  try {
    for (let idx = 0; idx < dates.length; idx += 1) {
      const date = dates[idx];
      const progress = `[${idx + 1}/${dates.length}] ${date}`;
      if (history.some((item) => item.date === date)) {
        skipped += 1;
        processed += 1;
        writeBackfillStatus(args.statusOutput, {
          status: "running",
          phase: "collect",
          asOfDate: args.asOf,
          days: args.days,
          step: args.step,
          horizon: args.horizon,
          startedAt: startAt,
          total: dates.length,
          processed,
          added,
          skipped,
          failed,
          remaining: Math.max(0, dates.length - processed),
          currentDate: date,
          failures: failedList.slice(-200),
          output: args.output,
          message: "跳过已存在日期",
        });
        console.log(`${progress} 跳过（已存在）`);
        continue;
      }
      try {
        const payload = runCollectorForDate(date, args.timeoutSec);
        const normalized = normalizeInputForRun({ ...(payload.data || {}) }, history, date);
        hydrateMetadata(normalized, payload);
        coerceInputTypes(normalized);
        fillEthSpotPriceFromSeed(normalized, priceByDate, date);
        applyHalfLifeGate(normalized, Object.keys(inputSchema), date);
        backfillMissingFromHistory(normalized, history, date);
        refreshMissingFields(normalized);
        const errors = validateInput(normalized);
        if (errors.length) {
          failed += 1;
          const staleHints = (normalized.__errors || []).filter((item) => String(item).includes("半衰期拦截"));
          failedList.push({
            date,
            stage: "validate",
            kind: staleHints.length ? "half-life" : "missing",
            missing: (normalized.__missing || []).slice(0, 12),
            error: `字段不完整: ${errors.slice(0, 4).join(" | ")}`,
          });
          console.log(`${progress} 失败（字段不完整: ${errors.slice(0, 4).join(" | ")}）`);
          continue;
        }
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
        history.push({ date, input: normalized, output });
        history.sort((a, b) => a.date.localeCompare(b.date));
        added += 1;
        if ((idx + 1) % 5 === 0) {
          writeJson(args.output, {
            generatedAt: new Date().toISOString(),
            asOfDate: args.asOf,
            days: args.days,
            step: args.step,
            history,
          });
        }
        console.log(`${progress} 完成`);
      } catch (error) {
        failed += 1;
        failedList.push({ date, stage: "collector", kind: "upstream", error: error.message || "未知错误" });
        console.log(`${progress} 失败（${error.message || "未知错误"}）`);
      } finally {
        processed += 1;
        writeBackfillStatus(args.statusOutput, {
          status: "running",
          phase: "compute",
          asOfDate: args.asOf,
          days: args.days,
          step: args.step,
          horizon: args.horizon,
          startedAt: startAt,
          total: dates.length,
          processed,
          added,
          skipped,
          failed,
          remaining: Math.max(0, dates.length - processed),
          currentDate: date,
          failures: failedList.slice(-200),
          output: args.output,
          message: "回填执行中",
        });
      }
    }

    writeJson(args.output, {
      generatedAt: new Date().toISOString(),
      asOfDate: args.asOf,
      days: args.days,
      step: args.step,
      history,
    });
    const finishAt = new Date().toISOString();
    writeBackfillStatus(args.statusOutput, {
      status: failed ? "done" : "ok",
      phase: "done",
      asOfDate: args.asOf,
      days: args.days,
      step: args.step,
      horizon: args.horizon,
      startedAt: startAt,
      finishedAt: finishAt,
      total: dates.length,
      processed,
      added,
      skipped,
      failed,
      remaining: Math.max(0, dates.length - processed),
      currentDate: null,
      failures: failedList.slice(-200),
      output: args.output,
      message: `回填完成：新增 ${added}，跳过 ${skipped}，失败 ${failed}`,
    });
    console.log(`回测补齐完成：新增 ${added}，已存在 ${skipped}，失败 ${failed}，总样本 ${history.length}`);
  } catch (error) {
    writeBackfillStatus(args.statusOutput, {
      status: "fail",
      phase: "error",
      asOfDate: args.asOf,
      days: args.days,
      step: args.step,
      horizon: args.horizon,
      startedAt: startAt,
      finishedAt: new Date().toISOString(),
      total: dates.length,
      processed,
      added,
      skipped,
      failed,
      remaining: Math.max(0, dates.length - processed),
      currentDate: null,
      failures: failedList.slice(-200),
      output: args.output,
      message: error?.message || "回填任务失败",
    });
    throw error;
  } finally {
    releaseLock(lockFd, LOCK_PATH);
  }
}

main();
