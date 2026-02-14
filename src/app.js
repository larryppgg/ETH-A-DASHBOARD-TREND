import { runPipeline } from "./engine/pipeline.js";
import { dateKey } from "./utils.js";
import { renderOutput, renderTimelineOverview } from "./ui/render.js";
import { buildAiPayload } from "./ai/payload.js";
import { renderAiPanel, renderAiStatus } from "./ui/ai.js";
import { shouldAutoRun } from "./autoRun.js";
import {
  needsAutoFetch,
  classifyFieldFreshness,
  pickHistoryBackfillCandidate,
  applyHalfLifeGate,
  mergeInputsPreferFresh,
} from "./inputPolicy.js";
import { cacheHistory, loadCachedHistory, resetCachedHistory } from "./ui/cache.js";
import { buildTimelineIndex, nearestDate, pickRecordByDate } from "./ui/timeline.js";
import { buildDateWindow } from "./ui/historyWindow.js";
import { buildTooltipText } from "./ui/formatters.js";
import { buildCombinedInput } from "./ui/inputBuilder.js";
import { createEtaTimer } from "./ui/etaTimer.js";
import { fieldMeta } from "./ui/fieldMeta.js";
import { deriveDriftSignal } from "./ui/eval.js";
import { parseDeepLink } from "./ui/deepLink.js";

const storageKey = "eth_a_dashboard_history_v201";
const inputKey = "eth_a_dashboard_custom_input";
const aiKey = "eth_a_dashboard_ai_cache_v1";
const aiStatusKey = "eth_a_dashboard_ai_status_v1";
const viewModeKey = "eth_a_dashboard_view_mode_v1";
const mobileTabKey = "eth_a_dashboard_mobile_tab_v1";
const EXECUTION_COST_BPS = 12;
const historySeedPath = "/data/history.seed.json";
const latestSeedPath = "/data/latest.seed.json";
const aiSeedPath = "/data/ai.seed.json";
const dailyStatusPath = "/data/daily-status";
const backfillStatusPath = "/data/backfill-status";
const perfSummaryPath = "/data/perf-summary";
const iterationLatestPath = "/data/iteration-latest";
const ethPriceSeedPath = "/data/eth.price.seed.json";

const elements = {
  quickNav: document.getElementById("quickNav"),
  navTopBtn: document.getElementById("navTopBtn"),
  runBtn: document.getElementById("runBtn"),
  clearBtn: document.getElementById("clearBtn"),
  viewPlainBtn: document.getElementById("viewPlainBtn"),
  viewExpertBtn: document.getElementById("viewExpertBtn"),
  statusBadge: document.getElementById("statusBadge"),
  statusTitle: document.getElementById("statusTitle"),
  statusSub: document.getElementById("statusSub"),
  betaValue: document.getElementById("betaValue"),
  hedgeValue: document.getElementById("hedgeValue"),
  phaseValue: document.getElementById("phaseValue"),
  confidenceValue: document.getElementById("confidenceValue"),
  extremeValue: document.getElementById("extremeValue"),
  distributionValue: document.getElementById("distributionValue"),
  lastRun: document.getElementById("lastRun"),
  runStatus: document.getElementById("runStatus"),
  gateList: document.getElementById("gateList"),
  gateInspector: document.getElementById("gateInspector"),
  gateChain: document.getElementById("gateChain"),
  auditVisual: document.getElementById("auditVisual"),
  topReasons: document.getElementById("topReasons"),
  riskNotes: document.getElementById("riskNotes"),
  evidenceHints: document.getElementById("evidenceHints"),
  betaChart: document.getElementById("betaChart"),
  confidenceChart: document.getElementById("confidenceChart"),
  fofChart: document.getElementById("fofChart"),
  betaTrendMeta: document.getElementById("betaTrendMeta"),
  confidenceTrendMeta: document.getElementById("confidenceTrendMeta"),
  fofTrendMeta: document.getElementById("fofTrendMeta"),
  kanbanA: document.getElementById("kanbanA"),
  kanbanB: document.getElementById("kanbanB"),
  kanbanC: document.getElementById("kanbanC"),
  inputJson: document.getElementById("inputJson"),
  runDate: document.getElementById("runDate"),
  templateBtn: document.getElementById("templateBtn"),
  validateBtn: document.getElementById("validateBtn"),
  fetchBtn: document.getElementById("fetchBtn"),
  forceFetchBtn: document.getElementById("forceFetchBtn"),
  sourceStatus: document.getElementById("sourceStatus"),
  inputError: document.getElementById("inputError"),
  coverageList: document.getElementById("coverageList"),
  applyInputBtn: document.getElementById("applyInputBtn"),
  resetInputBtn: document.getElementById("resetInputBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  aiPanel: document.getElementById("aiPanel"),
  aiStatus: document.getElementById("aiStatus"),
  healthFreshness: document.getElementById("healthFreshness"),
  healthMissing: document.getElementById("healthMissing"),
  healthProxy: document.getElementById("healthProxy"),
  healthAi: document.getElementById("healthAi"),
  healthTimeliness: document.getElementById("healthTimeliness"),
  healthQuality: document.getElementById("healthQuality"),
  healthDrift: document.getElementById("healthDrift"),
  healthExecution: document.getElementById("healthExecution"),
  decisionConclusion: document.getElementById("decisionConclusion"),
  decisionExecutable: document.getElementById("decisionExecutable"),
  decisionWhy: document.getElementById("decisionWhy"),
  decisionNext: document.getElementById("decisionNext"),
  predictionSummaryValue: document.getElementById("predictionSummaryValue"),
  predictionSummaryEvalBtn: document.getElementById("predictionSummaryEvalBtn"),
  predictionSummaryIterBtn: document.getElementById("predictionSummaryIterBtn"),
  statusOverview: document.getElementById("statusOverview"),
  keyEvidence: document.getElementById("keyEvidence"),
  etaValue: document.getElementById("etaValue"),
  actionSummary: document.getElementById("actionSummary"),
  actionDetail: document.getElementById("actionDetail"),
  actionAvoid: document.getElementById("actionAvoid"),
  actionWatch: document.getElementById("actionWatch"),
  counterfactuals: document.getElementById("counterfactuals"),
  missingImpact: document.getElementById("missingImpact"),
  workflowFetch: document.getElementById("workflowFetch"),
  workflowValidate: document.getElementById("workflowValidate"),
  workflowRun: document.getElementById("workflowRun"),
  workflowReplay: document.getElementById("workflowReplay"),
  runStageFetch: document.getElementById("runStageFetch"),
  runStageValidate: document.getElementById("runStageValidate"),
  runStageCompute: document.getElementById("runStageCompute"),
  runStageReplay: document.getElementById("runStageReplay"),
  runStageAi: document.getElementById("runStageAi"),
  runMetaId: document.getElementById("runMetaId"),
  runMetaTime: document.getElementById("runMetaTime"),
  runMetaDataTime: document.getElementById("runMetaDataTime"),
  runMetaSource: document.getElementById("runMetaSource"),
  runMetaTrust: document.getElementById("runMetaTrust"),
  runMetaDailyStatus: document.getElementById("runMetaDailyStatus"),
  runMetaDailyAt: document.getElementById("runMetaDailyAt"),
  timelineOverview: document.getElementById("timelineOverview"),
  timelineLegend: document.getElementById("timelineLegend"),
  timelineRange: document.getElementById("timelineRange"),
  timelineLabel: document.getElementById("timelineLabel"),
  timelineLatestBtn: document.getElementById("timelineLatestBtn"),
  timelineTooltip: document.getElementById("timelineTooltip"),
  historyRange: document.getElementById("historyRange"),
  historyDate: document.getElementById("historyDate"),
  historyHint: document.getElementById("historyHint"),
  evalPanel: document.getElementById("evalPanel"),
  backfill90Btn: document.getElementById("backfill90Btn"),
  backfill180Btn: document.getElementById("backfill180Btn"),
  backfill365Btn: document.getElementById("backfill365Btn"),
  evalBackfillStatus: document.getElementById("evalBackfillStatus"),
  iterationMeta: document.getElementById("iterationMeta"),
  iterationBody: document.getElementById("iterationBody"),
  runAdvice: document.getElementById("runAdvice"),
  runAdviceBody: document.getElementById("runAdviceBody"),
  quickFetchBtn: document.getElementById("quickFetchBtn"),
  quickForceFetchBtn: document.getElementById("quickForceFetchBtn"),
  quickRerunBtn: document.getElementById("quickRerunBtn"),
  coverageSearch: document.getElementById("coverageSearch"),
  coverageFilter: document.getElementById("coverageFilter"),
  coverageClearBtn: document.getElementById("coverageClearBtn"),
  mobileTabbar: document.getElementById("mobileTabbar"),
  runFloatingBtn: document.getElementById("runFloatingBtn"),
  runFloatingEta: document.getElementById("runFloatingEta"),
};

function cloneJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

function normalizeViewMode(mode) {
  return mode === "expert" ? "expert" : "plain";
}

function setButtonActive(button, active) {
  if (!button || !button.classList) return;
  if (active) button.classList.add("active");
  else button.classList.remove("active");
}

function applyViewMode(mode) {
  const resolved = normalizeViewMode(mode);
  if (typeof document !== "undefined" && document.body) {
    if (!document.body.dataset) {
      // For test harness where dataset may be missing.
      document.body.dataset = {};
    }
    document.body.dataset.viewMode = resolved;
  }
  setButtonActive(elements.viewPlainBtn, resolved === "plain");
  setButtonActive(elements.viewExpertBtn, resolved === "expert");
}

function setViewMode(mode, { rerender = false } = {}) {
  const resolved = normalizeViewMode(mode);
  try {
    localStorage.setItem(viewModeKey, resolved);
  } catch {}
  applyViewMode(resolved);
  if (rerender) {
    const history = loadHistory();
    if (history.length) {
      renderSnapshot(history, selectedDate || timelineIndex.latestDate);
    } else {
      renderTimeline([], null);
    }
  }
}

function refreshMissingFields(input, schemaKeys = []) {
  if (!input || !Array.isArray(schemaKeys)) return [];
  const missing = schemaKeys.filter((key) => input[key] === null || input[key] === undefined);
  input.__missing = missing;
  return missing;
}

function coerceInputTypes(input) {
  if (!input) return input;
  Object.entries(inputSchema).forEach(([key, type]) => {
    const value = input[key];
    if (value === null || value === undefined) return;
    if (type === "number" && typeof value !== "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) input[key] = parsed;
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
  return input;
}

function hydrateFieldFreshness(input, asOfDate) {
  if (!input) return;
  input.__fieldFreshness = input.__fieldFreshness || {};
  Object.keys(inputSchema).forEach((key) => {
    const observedAt =
      input.__fieldObservedAt?.[key] || input.__fieldUpdatedAt?.[key] || input.__generatedAt || null;
    const freshness = classifyFieldFreshness(observedAt, asOfDate || input.date || dateKey(), key);
    input.__fieldFreshness[key] = freshness;
  });
}

function backfillMissingFromHistory(input, history, targetDate = null) {
  if (!input) return [];
  const filled = [];
  const staleBlocked = [];
  Object.entries(inputSchema).forEach(([key, type]) => {
    if (input[key] !== null && input[key] !== undefined) return;
    const candidate = pickHistoryBackfillCandidate(history, key, targetDate || input.date || dateKey());
    if (!candidate) {
      const staleCandidate = pickHistoryBackfillCandidate(
        history,
        key,
        targetDate || input.date || dateKey(),
        { allowStale: true }
      );
      if (staleCandidate?.freshness?.level === "stale") {
        staleBlocked.push(key);
      }
      return;
    }
    if (typeof candidate.value !== type) return;
    input[key] = candidate.value;
    filled.push(key);
    input.__sources = input.__sources || {};
    input.__fieldObservedAt = input.__fieldObservedAt || {};
    input.__fieldFetchedAt = input.__fieldFetchedAt || {};
    input.__fieldUpdatedAt = input.__fieldUpdatedAt || {};
    input.__fieldFreshness = input.__fieldFreshness || {};
    if (!input.__sources[key]) {
      input.__sources[key] = candidate.source || `History cache: ${candidate.date}`;
    }
    if (!input.__fieldObservedAt[key]) {
      input.__fieldObservedAt[key] = candidate.observedAt || null;
    }
    if (!input.__fieldFetchedAt[key]) {
      input.__fieldFetchedAt[key] = candidate.fetchedAt || candidate.observedAt || null;
    }
    if (!input.__fieldUpdatedAt[key]) {
      input.__fieldUpdatedAt[key] = input.__fieldObservedAt[key] || null;
    }
    input.__fieldFreshness[key] = candidate.freshness || null;
  });
  hydrateFieldFreshness(input, targetDate || input.date || dateKey());
  if (filled.length) {
    input.__errors = Array.isArray(input.__errors) ? input.__errors : [];
    input.__errors.push(`历史日期回抓：使用本地快照补齐字段 ${filled.join(", ")}`);
  }
  if (staleBlocked.length) {
    input.__errors = Array.isArray(input.__errors) ? input.__errors : [];
    input.__errors.push(`半衰期拦截：以下字段本地历史已过期，未回填 ${staleBlocked.join(", ")}`);
  }
  return filled;
}

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
};

const templateInput = Object.fromEntries(Object.keys(inputSchema).map((key) => [key, null]));

// Full history seeds can exceed browser LocalStorage quota (e.g. 365d backfill).
// Keep a best-effort in-memory history for the current session and persist only when it fits.
let historyMemory = [];

function loadHistory() {
  if (Array.isArray(historyMemory) && historyMemory.length) return historyMemory;
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveHistory(history) {
  const normalized = normalizeHistoryRecords(history);
  historyMemory = normalized;

  const persist = (records) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(records));
      cacheHistory(records);
      return true;
    } catch {
      return false;
    }
  };

  // Avoid stringifying very large history arrays (slow + likely over LocalStorage quota).
  const primary = normalized.length <= 120 ? normalized : normalized.slice(-60);
  if (persist(primary)) return;
  // Fall back to a smaller slice so we at least remember recent runs across reloads.
  persist(normalized.slice(-60));
}

function normalizeHistoryRecords(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((item) => item && typeof item.date === "string" && item.input && item.output)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mergeHistoryRecords(seedRecords, localRecords) {
  const merged = new Map();
  normalizeHistoryRecords(seedRecords).forEach((item) => merged.set(item.date, item));
  normalizeHistoryRecords(localRecords).forEach((item) => merged.set(item.date, item));
  return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function loadSeedHistory() {
  try {
    const response = await fetch(`${historySeedPath}?ts=${Date.now()}`);
    if (!response.ok) return [];
    const payload = await response.json();
    if (Array.isArray(payload)) {
      return normalizeHistoryRecords(payload);
    }
    if (Array.isArray(payload?.history)) {
      return normalizeHistoryRecords(payload.history);
    }
    return [];
  } catch {
    return [];
  }
}

function normalizeSeedRecord(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload.record && typeof payload.record === "object" ? payload.record : payload;
  const date = candidate?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!candidate.input || !candidate.output) return null;
  return { date, input: candidate.input, output: candidate.output };
}

async function loadSeedLatest() {
  try {
    const response = await fetch(`${latestSeedPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeSeedRecord(payload);
  } catch {
    return null;
  }
}

function normalizeAiSeed(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.byDate && typeof payload.byDate === "object") return payload.byDate;
  if (Array.isArray(payload.items)) {
    return payload.items.reduce((acc, item) => {
      if (item?.date) acc[item.date] = item;
      return acc;
    }, {});
  }
  if (payload.date && payload.summary) {
    return { [payload.date]: payload };
  }
  return {};
}

async function loadSeedAi() {
  try {
    const response = await fetch(`${aiSeedPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return {};
    const payload = await response.json();
    return normalizeAiSeed(payload);
  } catch {
    return {};
  }
}

function normalizeEthPriceSeed(payload) {
  if (!payload || typeof payload !== "object") return null;
  const byDate = payload.byDate && typeof payload.byDate === "object" ? payload.byDate : null;
  if (!byDate) return null;
  return {
    generatedAt: payload.generatedAt || null,
    asOfDate: payload.asOfDate || null,
    byDate,
    errors: Array.isArray(payload.errors) ? payload.errors : [],
    source: payload.source || null,
  };
}

async function loadEthPriceSeed() {
  try {
    const response = await fetch(`${ethPriceSeedPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeEthPriceSeed(payload);
  } catch {
    return null;
  }
}

function normalizePerfSummary(payload) {
  if (!payload || typeof payload !== "object") return null;
  const status = String(payload.status || "ok").toLowerCase();
  return {
    status,
    generatedAt: payload.generatedAt || null,
    asOfDate: payload.asOfDate || null,
    maturity: payload.maturity || null,
    byHorizon: payload.byHorizon || null,
    drift: payload.drift || null,
    recent: payload.recent || null,
    runId: payload.runId || null,
    promptVersion: payload.promptVersion || null,
  };
}

async function loadPerfSummary() {
  try {
    const response = await fetch(`${perfSummaryPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return normalizePerfSummary(await response.json());
  } catch {
    return null;
  }
}

function normalizeIterationLatest(payload) {
  if (!payload || typeof payload !== "object") return null;
  const status = String(payload.status || "").toLowerCase();
  const content = typeof payload.content === "string" ? payload.content : "";
  return {
    status: status || "unknown",
    date: payload.date || null,
    updatedAt: payload.updatedAt || null,
    content,
    error: payload.error || null,
  };
}

async function loadIterationLatest() {
  try {
    const response = await fetch(`${iterationLatestPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return normalizeIterationLatest(await response.json());
  } catch {
    return null;
  }
}

function applyIterationLatest(iteration) {
  iterationLatestCache = iteration || null;
  if (!elements.iterationBody && !elements.iterationMeta) return;
  if (!iteration || iteration.status === "missing") {
    if (elements.iterationMeta) elements.iterationMeta.textContent = "未生成";
    if (elements.iterationBody) elements.iterationBody.textContent = "今日尚未生成迭代建议。";
    return;
  }
  if (elements.iterationMeta) {
    const dateText = iteration.date ? `date=${iteration.date}` : "";
    const timeText = iteration.updatedAt ? `更新 ${formatRunTimestamp(iteration.updatedAt)}` : "";
    elements.iterationMeta.textContent = [dateText, timeText].filter(Boolean).join(" · ") || "--";
  }
  if (elements.iterationBody) {
    elements.iterationBody.textContent =
      iteration.content || (iteration.error ? `读取失败：${iteration.error}` : "迭代建议为空。");
  }
}

function normalizeDailyStatus(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    date: payload.date || null,
    status: String(payload.status || "unknown").toLowerCase(),
    phase: payload.phase || null,
    startedAt: payload.startedAt || null,
    finishedAt: payload.finishedAt || null,
    durationMs: Number.isFinite(payload.durationMs) ? payload.durationMs : null,
    autoGeneratedAt: payload.autoGeneratedAt || null,
    errors: Array.isArray(payload.errors) ? payload.errors : [],
    runId: payload.runId || null,
    aiMode: payload.aiMode || null,
    lastErrorStage: payload.lastErrorStage || null,
    lastSuccessAt: payload.lastSuccessAt || null,
  };
}

async function loadDailyStatus() {
  try {
    const response = await fetch(`${dailyStatusPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return normalizeDailyStatus(await response.json());
  } catch {
    return null;
  }
}

function dailyStatusLabel(status) {
  if (!status) return "未配置";
  if (status.status === "ok") return "完成";
  if (status.status === "warn") return "完成(WARN)";
  if (status.status === "running") return "运行中";
  if (status.status === "fail") return "失败";
  return "未知";
}

function applyDailyStatusMeta(status) {
  dailyStatusCache = status || null;
  if (!elements.runMetaDailyStatus && !elements.runMetaDailyAt) return;
  if (!status) {
    if (elements.runMetaDailyStatus) {
      elements.runMetaDailyStatus.textContent = "未配置";
      elements.runMetaDailyStatus.className = "";
    }
    if (elements.runMetaDailyAt) {
      elements.runMetaDailyAt.textContent = "--";
    }
    return;
  }
  if (elements.runMetaDailyStatus) {
    const baseLabel = dailyStatusLabel(status);
    const phaseSuffix = status.phase ? ` · ${status.phase}` : "";
    elements.runMetaDailyStatus.textContent = `${baseLabel}${phaseSuffix}`;
    elements.runMetaDailyStatus.className =
      status.status === "fail" ? "danger" : status.status === "warn" ? "warn" : status.status === "ok" ? "ok" : "";
  }
  if (elements.runMetaDailyAt) {
    const finished = formatRunTimestamp(status.finishedAt);
    const generated = formatRunTimestamp(status.autoGeneratedAt);
    const durationText =
      typeof status.durationMs === "number" && Number.isFinite(status.durationMs)
        ? ` · ${Math.round(status.durationMs / 1000)}s`
        : "";
    const successText = status.lastSuccessAt ? ` · 上次成功 ${formatRunTimestamp(status.lastSuccessAt)}` : "";
    elements.runMetaDailyAt.textContent = finished !== "--" || generated !== "--"
      ? `${finished !== "--" ? finished : "--"}${generated !== "--" ? ` · 抓取 ${generated}` : ""}${durationText}${successText}`
      : "--";
  }
}

function loadCustomInput() {
  const raw = localStorage.getItem(inputKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveCustomInput(input) {
  localStorage.setItem(inputKey, JSON.stringify(input));
}

function loadAiCache() {
  const raw = localStorage.getItem(aiKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveAiCache(payload) {
  localStorage.setItem(aiKey, JSON.stringify(payload));
}

function setAiStatus(text) {
  localStorage.setItem(aiStatusKey, text);
  renderAiStatus(elements.aiStatus, text);
  if (elements.healthAi) {
    elements.healthAi.textContent = text;
  }
}

function formatFieldValue(value, unit = "") {
  if (value === null || value === undefined) return "缺失";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return `${value.toFixed(3)}${unit ? ` ${unit}` : ""}`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function buildLocalFieldInsight(field, record) {
  const output = record?.output || {};
  if (field.value === null || field.value === undefined) {
    return `${field.label} 当前缺失，先补齐该指标再判断其对 ${output.state || "-"} 档位的影响。`;
  }
  const gateHint = field.gate ? `对应 ${field.gate} 闸门` : "对应策略闸门";
  const stateHint =
    output.state === "A"
      ? "偏进攻"
      : output.state === "B"
      ? "偏防守"
      : output.state === "C"
      ? "偏避险"
      : "当前态势";
  return `${field.label} 当前为 ${formatFieldValue(field.value, field.unit)}，${gateHint}，用于${field.desc || "判断结构状态"}。该值对当前${stateHint}判断形成约束，后续重点观察其是否延续当前方向。`;
}

function aiCacheForDate(date) {
  const seed = date ? aiSeedByDate?.[date] : null;
  if (seed) return seed;
  const cached = loadAiCache();
  if (!cached) return null;
  if (!date) return cached;
  if (!cached.date) return cached;
  return cached.date === date ? cached : null;
}

function escapeHtml(raw) {
  return String(raw || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeGateAiLabel(label = "") {
  const key = String(label || "").trim();
  if (key === "关键证据" || key === "依据") return "依据";
  if (key === "执行限制") return "时效";
  if (key === "下一步观察" || key === "下一次观察" || key === "观察") return "反证";
  return key;
}

function summarizeGateEvidence(gate) {
  const inputs = gate?.details?.inputs || {};
  const entries = Object.entries(inputs).slice(0, 2);
  if (!entries.length) return "当前无可用输入字段。";
  return entries
    .map(([key, value]) => `${humanizeFieldName(key)}=${formatFieldValue(value, fieldMeta[key]?.unit || "")}`)
    .join("；");
}

function summarizeGateFreshness(gate) {
  const timings = gate?.details?.timings || {};
  const stale = [];
  const aging = [];
  Object.entries(timings).forEach(([key, timing]) => {
    const level = timing?.freshness?.level;
    if (level === "stale") stale.push(humanizeFieldName(key));
    if (level === "aging") aging.push(humanizeFieldName(key));
  });
  if (stale.length) return `结论受限，过期字段：${stale.slice(0, 3).join("、")}`;
  if (aging.length) return `时效通过但存在衰减字段：${aging.slice(0, 3).join("、")}`;
  return "时效通过";
}

function buildGateFallbackText(gate) {
  const note = String(gate?.note || "暂无结论").replace(/\s+/g, " ").trim();
  const status = String(gate?.status || "").toLowerCase();
  const rules = (gate?.details?.rules || [])
    .slice(0, 2)
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("；");
  const action =
    status === "closed"
      ? "先降仓并保留对冲，等该闸门转 OPEN 再恢复风险敞口。"
      : status === "warn"
      ? "降低杠杆并保持观察，反证出现前不追高。"
      : "维持当前节奏，重点跟踪反证是否触发。";
  return [
    `【结论】：${note}`,
    `【依据】：${summarizeGateEvidence(gate)}${rules ? `；规则：${rules}` : ""}`,
    `【动作】：${action}`,
    "【反证】：若关键输入方向反转并连续维持 2 个观测点，则重算该闸门。",
    `【时效】：${summarizeGateFreshness(gate)}`,
  ].join("\n");
}

function parseGateAiSections(text) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return null;
  const pattern =
    /(?:^|\n)\s*(?:[-*]\s*)?[【\[]?\s*(结论|关键证据|依据|动作|反证|时效|执行限制|下一步观察|下一次观察|观察)\s*[】\]]?\s*(?:[:：\-]\s*)?/g;
  const points = [];
  let match = pattern.exec(raw);
  while (match) {
    points.push({
      start: match.index,
      contentStart: pattern.lastIndex,
      key: normalizeGateAiLabel(match[1]),
    });
    match = pattern.exec(raw);
  }
  if (!points.length) return null;
  const order = ["结论", "依据", "动作", "反证", "时效"];
  const map = {};
  points.forEach((point, idx) => {
    const end = idx + 1 < points.length ? points[idx + 1].start : raw.length;
    const value = raw
      .slice(point.contentStart, end)
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return;
    if (map[point.key]) {
      map[point.key] += ` / ${value}`;
    } else {
      map[point.key] = value;
    }
  });
  const hasStructured = order.some((key) => map[key]);
  if (!hasStructured) return null;
  return order.map((key) => ({ key, value: map[key] || "--" }));
}

function renderGateAiSectionsHtml(text) {
  const sections = parseGateAiSections(text);
  if (!sections) return null;
  return sections
    .map((section) => {
      const cls = section.key === "结论" ? "gate-ai-row primary" : "gate-ai-row";
      return `<div class="${cls}"><span class="gate-ai-k">${escapeHtml(section.key)}</span><span class="gate-ai-v">${escapeHtml(
        section.value
      )}</span></div>`;
    })
    .join("");
}

function updateAiBlock(node, text, status) {
  if (!node) return;
  const textNode = node.querySelector(".coverage-ai-text");
  if (!textNode) return;
  const resolvedText = text || "等待生成...";
  node.setAttribute("data-state", status || "pending");
  const hasAttr = (name) => typeof node.hasAttribute === "function" && node.hasAttribute(name);
  const isGateNode = hasAttr("data-gate-ai") || hasAttr("data-gate-ai-inline");
  const structuredHtml =
    isGateNode && (status === "done" || status === "ok") ? renderGateAiSectionsHtml(resolvedText) : null;
  if (structuredHtml) {
    node.classList.add("ai-structured");
    textNode.innerHTML = structuredHtml;
  } else {
    node.classList.remove("ai-structured");
    textNode.textContent = resolvedText;
  }
  const toggle = node.querySelector(".coverage-ai-toggle");
  if (!toggle) return;
  if (structuredHtml) {
    toggle.hidden = true;
    node.classList.remove("expanded");
    toggle.textContent = "展开";
    return;
  }
  const canFold = resolvedText.length > 140;
  toggle.hidden = !canFold;
  if (!canFold) {
    node.classList.remove("expanded");
    toggle.textContent = "展开";
  }
}

function applyCoverageFieldAi(aiPayload, date = selectedDate) {
  if (!elements.coverageList) return;
  const safePayload = aiPayload && (!date || !aiPayload.date || aiPayload.date === date) ? aiPayload : null;
  const fieldMap = new Map(((safePayload && safePayload.fields) || []).map((item) => [item.key, item]));
  const gateMap = new Map(((safePayload && safePayload.gates) || []).map((item) => [item.id, item]));
  const nodes = elements.coverageList.querySelectorAll("[data-field-ai]");
  nodes.forEach((node) => {
    const key = node.getAttribute("data-field-ai");
    const target = fieldMap.get(key);
    if (!target) {
      updateAiBlock(node, "等待生成...", "pending");
      return;
    }
    updateAiBlock(node, target.text || "等待生成...", target.status || "pending");
  });

  const gateNodes = elements.coverageList.querySelectorAll("[data-gate-ai]");
  gateNodes.forEach((node) => {
    const gateId = node.getAttribute("data-gate-ai");
    const target = gateMap.get(gateId);
    if (!target) {
      updateAiBlock(node, "等待生成...", "pending");
      return;
    }
    updateAiBlock(node, target.text || "等待生成...", target.status || "pending");
  });

  // Inline gate AI (audit/inspector) and inline field AI (key evidence chips).
  document.querySelectorAll("[data-gate-ai-inline]").forEach((node) => {
    if (!node || typeof node.getAttribute !== "function") return;
    const gateId = node.getAttribute("data-gate-ai-inline");
    const target = gateMap.get(gateId);
    if (!target) {
      updateAiBlock(node, "等待生成...", "pending");
      return;
    }
    updateAiBlock(node, target.text || "等待生成...", target.status || "pending");
  });

  document.querySelectorAll("[data-field-ai-inline]").forEach((node) => {
    if (!node || typeof node.getAttribute !== "function") return;
    const key = node.getAttribute("data-field-ai-inline");
    const target = fieldMap.get(key);
    if (!target) {
      node.setAttribute("data-state", "pending");
      node.textContent = "AI：等待生成...";
      return;
    }
    node.setAttribute("data-state", target.status || "pending");
    node.textContent = target.text || "AI：等待生成...";
  });
}

function buildOfflineAiState(record, payload) {
  const output = record?.output || {};
  const reasons = (output.reasonsTop3 || []).map((item) => item.text).join(" / ") || "暂无";
  const risks = (output.riskNotes || []).join(" / ") || "暂无";
  const action = `${output.state || "-"} / β ${output.beta ?? "--"} / β_cap ${output.betaCap ?? "--"}`;
  return {
    date: record?.date || "",
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
    fields: (payload?.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      gate: field.gate,
      text: buildLocalFieldInsight(field, record),
      status: "done",
    })),
  };
}

async function checkAiStatus() {
  try {
    const resp = await fetch("/ai/status");
    if (!resp.ok) {
      setAiStatus("AI 离线解读（网络不可达）");
      return false;
    }
    const payload = await resp.json();
    if (!payload.enabled) {
      setAiStatus("AI 离线解读（本地）");
      return false;
    }
    setAiStatus("AI 已连接");
    return true;
  } catch (error) {
    setAiStatus("AI 离线解读（网络不可达）");
    return false;
  }
}

async function runAi(record, history = []) {
  const payload = buildAiPayload(record, history);
  const offline = buildOfflineAiState(record, payload);
  saveAiCache(offline);
  renderAiPanel(elements.aiPanel, offline);
  applyCoverageFieldAi(offline, record.date);

  const enabled = await checkAiStatus();
  if (!enabled) {
    setAiStatus("AI 离线解读（本地）");
    setRunStage(elements.runStageAi, "完成(离线)");
    return;
  }
  setAiStatus("AI 生成中...");
  setRunStage(elements.runStageAi, "生成中");
  const aiState = {
    date: payload.date,
    summary: "生成中...",
    summaryStatus: "pending",
    overall: "生成中...",
    overallStatus: "pending",
    gates: record.output.gates.map((gate) => ({
      id: gate.id,
      name: gate.name,
      text: "生成中...",
      status: "pending",
    })),
    fields: payload.fields.map((field) => ({
      key: field.key,
      label: field.label,
      gate: field.gate,
      text: buildLocalFieldInsight(field, record),
      status: "pending",
    })),
  };
  saveAiCache(aiState);
  renderAiPanel(elements.aiPanel, aiState);
  applyCoverageFieldAi(aiState, record.date);

  let errorCount = 0;
  const update = () => {
    saveAiCache(aiState);
    renderAiPanel(elements.aiPanel, aiState);
    applyCoverageFieldAi(aiState, record.date);
  };

  const summaryPromise = fetch("/ai/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: payload.summary.prompt }),
  })
    .then((resp) => {
      if (!resp.ok) throw new Error("summary failed");
      return resp.json();
    })
    .then((data) => {
      aiState.summary = data.summary || "无";
      aiState.summaryStatus = "done";
      update();
    })
    .catch(() => {
      aiState.summary = `本地离线解读：当前状态 ${record.output.state}，核心驱动 ${record.output.reasonsTop3
        .map((item) => item.text)
        .join(" / ") || "暂无"}。`;
      aiState.summaryStatus = "done";
      errorCount += 1;
      update();
    });

  const overallPromise = fetch("/ai/overall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: payload.overall.prompt }),
  })
    .then((resp) => {
      if (!resp.ok) throw new Error("overall failed");
      return resp.json();
    })
    .then((data) => {
      aiState.overall = data.summary || "无";
      aiState.overallStatus = "done";
      update();
    })
    .catch(() => {
      aiState.overall = `本地离线总结：建议动作 ${record.output.state} / β ${record.output.beta} / β_cap ${record.output.betaCap}。`;
      aiState.overallStatus = "done";
      errorCount += 1;
      update();
    });

  const runGateBatch = async (batch, delayMs = 0) => {
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await Promise.all(
      batch.map((gate) =>
        fetch("/ai/gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: gate.id, prompt: gate.prompt }),
        })
          .then((resp) => {
            if (!resp.ok) throw new Error("gate failed");
            return resp.json();
          })
          .then((data) => {
            const target = aiState.gates.find((item) => item.id === data.id);
            if (target) {
              target.text = data.text || "无";
              target.status = "done";
            }
            update();
          })
          .catch(() => {
            const target = aiState.gates.find((item) => item.id === gate.id);
            if (target) {
              const fallbackGate = (record.output.gates || []).find((item) => item.id === gate.id);
              target.text = buildGateFallbackText(fallbackGate || { id: gate.id });
              target.status = "done";
            }
            errorCount += 1;
            update();
          })
      )
    );
  };

  const gates = payload.gates || [];
  const batchSize = 4;
  for (let i = 0; i < gates.length; i += batchSize) {
    const batch = gates.slice(i, i + batchSize);
    await runGateBatch(batch, i === 0 ? 0 : 300);
  }

  const runFieldBatch = async (batch, delayMs = 0) => {
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await Promise.all(
      batch.map((field) =>
        fetch("/ai/gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: field.key, prompt: field.prompt }),
        })
          .then((resp) => {
            if (!resp.ok) throw new Error("field failed");
            return resp.json();
          })
          .then((data) => {
            const target = aiState.fields.find((item) => item.key === data.id);
            if (target) {
              target.text = data.text || target.text;
              target.status = "done";
            }
            update();
          })
          .catch(() => {
            const target = aiState.fields.find((item) => item.key === field.key);
            if (target) {
              target.status = "error";
            }
            errorCount += 1;
            update();
          })
      )
    );
  };

  const fields = payload.fields || [];
  const fieldBatchSize = 6;
  for (let i = 0; i < fields.length; i += fieldBatchSize) {
    const batch = fields.slice(i, i + fieldBatchSize);
    await runFieldBatch(batch, i === 0 ? 0 : 120);
  }

  await Promise.all([summaryPromise, overallPromise]);
  setAiStatus(errorCount ? "AI 已生成（部分离线）" : "AI 已生成");
  setRunStage(elements.runStageAi, errorCount ? "完成(含离线)" : "完成");
}

function parseInputJson(text) {
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function buildCsv(history) {
  const headers = [
    "date",
    "state",
    "beta",
    "betaCap",
    "hedge",
    "phaseLabel",
    "confidence",
    "extremeAllowed",
    "fofScore",
  ];
  const rows = history
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => [
      item.date,
      item.output.state,
      item.output.beta,
      item.output.betaCap,
      item.output.hedge ? "ON" : "OFF",
      item.output.phaseLabel,
      item.output.confidence,
      item.output.extremeAllowed ? "YES" : "NO",
      item.output.fofScore,
    ]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

function humanizeFieldName(key) {
  return fieldMeta[key]?.label || key;
}

function listMissingFields(input) {
  return Object.keys(inputSchema).filter((key) => !(key in input));
}

function hasNullFields(input) {
  return Object.keys(inputSchema).some((key) => input[key] === null || input[key] === undefined);
}

function previousDateKey(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function latestRecordBefore(history, date) {
  if (!Array.isArray(history) || !history.length || !date) return null;
  const candidates = history
    .filter((item) => item?.date && item.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return candidates[candidates.length - 1] || null;
}

function isoDaysAgo(offsetDays, baseDate = dateKey()) {
  const date = new Date(`${baseDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return baseDate;
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

function buildBackfillDates(maturedDays = 90, asOfDate = dateKey(), horizonDays = 14, stepDays = 1) {
  const safeDays = Math.max(7, Number(maturedDays) || 90);
  const step = Math.max(1, Number(stepDays) || 1);
  const dates = [];
  for (let offset = safeDays + horizonDays; offset >= horizonDays; offset -= step) {
    dates.push(isoDaysAgo(offset, asOfDate));
  }
  return dates;
}

function normalizeInputForRun(input, history) {
  const output = { ...input };
  const prevDate = previousDateKey(output.date || dateKey());
  const prevRecord = history.find((item) => item.date === prevDate);
  if (!("prevEtfExtremeOutflow" in output)) {
    output.prevEtfExtremeOutflow = Boolean(prevRecord?.input?.etf1d <= -180);
  }
  if ((output.exchBalanceTrend === null || output.exchBalanceTrend === undefined) && output.cexTvl) {
    const prevTvl = prevRecord?.input?.cexTvl;
    if (prevTvl !== undefined) {
      output.exchBalanceTrend = output.cexTvl - prevTvl;
    }
  }
  return output;
}

function showError(messages) {
  if (!messages.length) {
    elements.inputError.style.display = "none";
    elements.inputError.textContent = "";
    return;
  }
  elements.inputError.style.display = "block";
  elements.inputError.textContent = messages.join(" | ");
}

function showSourceStatus(text) {
  elements.sourceStatus.innerHTML = text || "";
}

function showRunStatus(text) {
  if (!elements.runStatus) return;
  elements.runStatus.textContent = text || "";
  // Keep the diagnostic panel in sync during runs; renderOutput will override with structured advice.
  if (elements.runAdviceBody && text) {
    elements.runAdviceBody.textContent = text;
  }
}

function setRunAdvice(text) {
  if (!elements.runAdviceBody) return;
  elements.runAdviceBody.textContent = text || "";
}

function setEvalBackfillStatus(text) {
  if (!elements.evalBackfillStatus) return;
  elements.evalBackfillStatus.textContent = text || "";
}

const etaTimer = createEtaTimer();

function updateEtaDisplay() {
  if (!elements.etaValue) return;
  const total = etaTimer.totalMs();
  const text = etaTimer.formatMs(total);
  elements.etaValue.textContent = text;
  if (elements.runFloatingEta) {
    elements.runFloatingEta.textContent = text;
  }
}

let selectedDate = null;
let timelineIndex = buildTimelineIndex([]);
let historyWindow = buildDateWindow(new Date(), 365);
let aiSeedByDate = {};
let ethPriceSeedByDate = null;
let perfSummaryCache = null;
let iterationLatestCache = null;
let dailyStatusCache = null;
let backfillPollTimer = null;

const deepLink =
  typeof window !== "undefined" && window.location
    ? parseDeepLink(window.location.search || "", window.location.hash || "")
    : { date: null, tab: null, hash: "" };

function setupQuickNav() {
  if (!elements.quickNav) return;
  const items = Array.from(elements.quickNav.querySelectorAll("a.nav-item"));
  const links = items
    .map((item) => ({ node: item, href: item.getAttribute("href") }))
    .filter((item) => item.href && item.href.startsWith("#"));
  const targets = links
    .map((item) => ({ ...item, target: document.querySelector(item.href) }))
    .filter((item) => item.target);

  links.forEach(({ node, href }) => {
    const target = document.querySelector(href);
    if (!target) return;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (elements.navTopBtn) {
    elements.navTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const setActive = (href) => {
    items.forEach((item) => item.classList.remove("active"));
    const hit = items.find((item) => item.getAttribute("href") === href);
    if (hit) hit.classList.add("active");
  };

  if (targets.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];
        if (!visible) return;
        const match = targets.find((item) => item.target === visible.target);
        if (match) setActive(match.href);
      },
      { root: null, threshold: [0.18, 0.26, 0.34] }
    );
    targets.forEach((item) => observer.observe(item.target));
  }
}

function applyCoverageControls() {
  if (!elements.coverageList) return;
  const query = (elements.coverageSearch?.value || "").trim().toLowerCase();
  const filter = (elements.coverageFilter?.value || "all").trim();
  const rows = Array.from(elements.coverageList.querySelectorAll(".coverage-row"));
  rows.forEach((row) => {
    const key = (row.getAttribute("data-field-key") || "").toLowerCase();
    const label = (row.querySelector(".coverage-label")?.textContent || "").toLowerCase();
    const source = (row.querySelector(".coverage-cell.source")?.textContent || "").toLowerCase();
    const matchesQuery = !query || key.includes(query) || label.includes(query) || source.includes(query);

    let matchesFilter = true;
    if (filter === "missing") matchesFilter = row.classList.contains("missing");
    else if (filter === "aging") matchesFilter = row.classList.contains("aging");
    else if (filter === "stale") matchesFilter = row.classList.contains("stale");
    else if (filter === "key") matchesFilter = row.classList.contains("key-evidence");

    row.style.display = matchesQuery && matchesFilter ? "" : "none";
  });

  // Hide empty sections only when user is filtering/searching; default view keeps all sections visible.
  const shouldHideEmpty = Boolean(query) || filter !== "all";
  elements.coverageList.querySelectorAll(".coverage-section").forEach((section) => {
    if (!shouldHideEmpty) {
      section.style.display = "";
      return;
    }
    const visibleRows = Array.from(section.querySelectorAll(".coverage-row")).some(
      (row) => row.style.display !== "none"
    );
    // Derived sections are always shown (they have no .coverage-row).
    const hasDerived = Boolean(section.querySelector(".coverage-derived"));
    section.style.display = visibleRows || hasDerived ? "" : "none";
  });
}

function setupCoverageControls() {
  if (elements.coverageSearch) {
    elements.coverageSearch.addEventListener("input", () => applyCoverageControls());
  }
  if (elements.coverageFilter) {
    elements.coverageFilter.addEventListener("change", () => applyCoverageControls());
  }
  if (elements.coverageClearBtn) {
    elements.coverageClearBtn.addEventListener("click", () => {
      if (elements.coverageSearch) elements.coverageSearch.value = "";
      if (elements.coverageFilter) elements.coverageFilter.value = "all";
      applyCoverageControls();
    });
  }
}

function setupLayoutModeObserver() {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      if (window.matchMedia("(max-width: 720px)").matches) return;
    }
  } catch {}
  if (!document?.body?.dataset) return;
  const sections = Array.from(document.querySelectorAll(".stage-marker[data-layout-mode]"));
  if (!sections.length) return;
  const setMode = (mode) => {
    if (!mode) return;
    document.body.dataset.layoutMode = mode;
  };
  setMode("decision");
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];
      if (!visible) return;
      setMode(visible.target.getAttribute("data-layout-mode"));
    },
    { root: null, threshold: [0.2, 0.35, 0.5] }
  );
  sections.forEach((section) => observer.observe(section));
}

function setupMobileTabs() {
  const tabbar = elements.mobileTabbar;
  if (!tabbar || typeof tabbar.querySelectorAll !== "function") return;
  if (typeof window === "undefined") return;
  if (typeof window.matchMedia !== "function") return;

  const mm = window.matchMedia("(max-width: 720px)");
  const buttons = Array.from(tabbar.querySelectorAll("[data-tab]"));
  if (!buttons.length) return;

  const sectionsByTab = {
    decision: [
      document.getElementById("decisionPanel"),
      document.getElementById("actionPanel"),
      document.getElementById("statusPanel"),
      document.getElementById("runBar"),
    ],
    explain: [
      document.getElementById("timelinePanel"),
      document.getElementById("reasonsPanel"),
      document.getElementById("aiPanelSection"),
      document.getElementById("trendPanel"),
      document.getElementById("evalPanelSection"),
      document.getElementById("iterationPanelSection"),
    ],
    audit: [
      document.getElementById("gateAuditPanel"),
      document.querySelector(".kanban"),
      document.querySelector(".gateflow"),
      document.querySelector(".inspector"),
    ],
    data: [document.getElementById("dataPanelSection")],
  };

  const allSections = Array.from(
    new Set(
      Object.values(sectionsByTab)
        .flat()
        .filter(Boolean)
    )
  );

  const clampTab = (tabId) => (tabId && tabId in sectionsByTab ? tabId : "decision");

  const tabForHash = (hash) => {
    if (!hash || typeof hash !== "string" || !hash.startsWith("#")) return null;
    const id = hash.slice(1);
    if (!id) return null;
    for (const [tabId, nodes] of Object.entries(sectionsByTab)) {
      if (nodes.some((node) => node && node.id === id)) return tabId;
    }
    return null;
  };

  const setActiveButtons = (tabId) => {
    buttons.forEach((button) => {
      const active = button.getAttribute("data-tab") === tabId;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.classList?.toggle?.("active", active);
    });
  };

  let foldsInitialized = false;
  const collapseHeavyFoldsOnce = () => {
    if (foldsInitialized) return;
    try {
      document.querySelectorAll("details.mobile-fold").forEach((node) => node.removeAttribute("open"));
    } catch {}
    foldsInitialized = true;
  };

  const openHeavyFolds = () => {
    try {
      document.querySelectorAll("details.mobile-fold").forEach((node) => node.setAttribute("open", ""));
    } catch {}
  };

  const selectTab = (tabId, options = {}) => {
    const resolved = clampTab(tabId);
    document.body.dataset.mobileTab = resolved;
    document.body.dataset.layoutMode = resolved;
    if (mm.matches) collapseHeavyFoldsOnce();

    const visibleSet = new Set((sectionsByTab[resolved] || []).filter(Boolean));
    allSections.forEach((node) => {
      node.hidden = !visibleSet.has(node);
    });
    setActiveButtons(resolved);
    try {
      localStorage.setItem(mobileTabKey, resolved);
    } catch {}

    if (options.scrollToTop !== false) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const resolveInitialTab = () => {
    if (deepLink.tab) return clampTab(deepLink.tab);
    const hashTab = tabForHash(window.location.hash);
    if (hashTab) return hashTab;
    try {
      const stored = localStorage.getItem(mobileTabKey);
      if (stored) return clampTab(stored);
    } catch {}
    return "decision";
  };

  const enable = () => {
    collapseHeavyFoldsOnce();
    selectTab(resolveInitialTab(), { scrollToTop: false });
  };

  const disable = () => {
    allSections.forEach((node) => {
      node.hidden = false;
    });
    openHeavyFolds();
    try {
      delete document.body.dataset.mobileTab;
      document.body.dataset.layoutMode = "decision";
    } catch {}
    setActiveButtons("decision");
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      selectTab(button.getAttribute("data-tab"));
    });
  });

  if (elements.runFloatingBtn && elements.runBtn) {
    elements.runFloatingBtn.addEventListener("click", () => {
      elements.runBtn.click();
    });
  }

  window.__ethSetMobileTab = (tabId, options) => {
    if (!mm.matches) return;
    selectTab(tabId, options);
  };

  const onChange = (event) => {
    if (event.matches) enable();
    else disable();
  };
  if (typeof mm.addEventListener === "function") {
    mm.addEventListener("change", onChange);
  } else if (typeof mm.addListener === "function") {
    mm.addListener(onChange);
  }

  window.addEventListener("hashchange", () => {
    if (!mm.matches) return;
    const hash = window.location.hash;
    const tabId = tabForHash(hash);
    if (tabId) {
      selectTab(tabId, { scrollToTop: false });
      const target = document.querySelector(hash);
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  });

  if (mm.matches) enable();
  else disable();
}

function setupMobileAccordions() {
  const panels = Array.from(document.querySelectorAll('.panel[data-mobile-collapsible="true"]'));
  if (!panels.length) return;
  panels.forEach((panel) => {
    if (!panel || typeof panel.querySelector !== "function" || typeof panel.prepend !== "function") return;
    if (panel.querySelector(".panel-mobile-toggle")) return;
    panel.classList.add("mobile-collapsible");
    const titleNode = panel.querySelector(".panel-title");
    const label =
      (typeof panel.getAttribute === "function" && panel.getAttribute("data-mobile-label")) ||
      titleNode?.textContent?.trim() ||
      "模块";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "panel-mobile-toggle";
    toggle.textContent = label;
    toggle.setAttribute("aria-expanded", "true");
    panel.prepend(toggle);
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("mobile-collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  });
}

function setupAiFoldToggle() {
  if (typeof document?.addEventListener !== "function") return;
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".coverage-ai-toggle");
    if (!button) return;
    const block = button.closest(".coverage-ai");
    if (!block) return;
    const expanded = block.classList.toggle("expanded");
    button.textContent = expanded ? "收起" : "展开";
  });
}

function setHistoryHint(text) {
  if (!elements.historyHint) return;
  elements.historyHint.textContent = text || "";
}

function syncHistoryWindow() {
  historyWindow = buildDateWindow(new Date(), 365);
  if (elements.historyRange) {
    elements.historyRange.max = Math.max(0, historyWindow.dates.length - 1);
    elements.historyRange.value = Math.max(0, historyWindow.dates.length - 1);
  }
  if (elements.historyDate) {
    elements.historyDate.value = historyWindow.latest || "";
  }
}

function syncHistorySelection(date) {
  if (!date || !historyWindow?.dates?.length) return;
  const idx = historyWindow.dates.indexOf(date);
  if (idx < 0) return;
  if (elements.historyRange) {
    elements.historyRange.value = idx;
  }
  if (elements.historyDate) {
    elements.historyDate.value = date;
  }
}

function updateTimeline(history) {
  timelineIndex = buildTimelineIndex(history);
  const total = timelineIndex.dates.length;
  if (elements.timelineRange) {
    elements.timelineRange.max = total === 1 ? 1 : Math.max(0, total - 1);
  }
}

function renderTimeline(history, date) {
  updateTimeline(history);
  const fallbackDate = date || timelineIndex.latestDate;
  const resolvedDate = pickRecordByDate(history, fallbackDate)
    ? fallbackDate
    : nearestDate(timelineIndex.dates, fallbackDate);
  selectedDate = resolvedDate;
  if (elements.timelineRange && timelineIndex.dates.length) {
    const idx = timelineIndex.dates.indexOf(resolvedDate);
    const visualIndex = idx >= 0 ? idx : timelineIndex.dates.length - 1;
    elements.timelineRange.value = timelineIndex.dates.length === 1 ? 1 : visualIndex;
  }
  if (elements.timelineLabel) {
    elements.timelineLabel.textContent = resolvedDate ? `快照 ${resolvedDate}` : "暂无快照";
  }
  renderTimelineOverview(elements.timelineOverview, elements.timelineLegend, history, resolvedDate);
  return resolvedDate;
}

function renderSnapshot(history, date) {
  const resolvedDate = renderTimeline(history, date);
  const record = pickRecordByDate(history, resolvedDate);
  if (record) {
    renderOutput(elements, record, history, { priceByDate: ethPriceSeedByDate, perfSummary: perfSummaryCache });
    applyCoverageFieldAi(aiCacheForDate(record.date), record.date);
    applyCoverageControls();
    updateRunMetaFromRecord(record);
    if (elements.inputJson) {
      elements.inputJson.value = JSON.stringify(record.input, null, 2);
    }
    if (elements.runDate) {
      elements.runDate.value = record.date;
    }
    syncHistorySelection(record.date);
  } else if (history.length) {
    const fallback = history[history.length - 1];
    renderOutput(elements, fallback, history, { priceByDate: ethPriceSeedByDate, perfSummary: perfSummaryCache });
    applyCoverageFieldAi(aiCacheForDate(fallback.date), fallback.date);
    applyCoverageControls();
    syncHistorySelection(fallback.date);
  }
}

function setWorkflowStatus(target, text) {
  if (!target) return;
  target.textContent = text;
}

function formatRunTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function latestFieldObservedAt(input) {
  const map = input?.__fieldObservedAt || {};
  let latest = null;
  Object.values(map).forEach((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  });
  return latest ? latest.toISOString() : null;
}

function setRunMeta(meta) {
  if (!meta) return;
  if (elements.runMetaId && meta.id) elements.runMetaId.textContent = meta.id;
  if (elements.runMetaTime && meta.time) elements.runMetaTime.textContent = meta.time;
  if (elements.runMetaDataTime && meta.dataTime) elements.runMetaDataTime.textContent = meta.dataTime;
  if (elements.runMetaSource && meta.source) elements.runMetaSource.textContent = meta.source;
  if (elements.runMetaTrust && meta.trust) {
    elements.runMetaTrust.textContent = meta.trust;
    elements.runMetaTrust.className = meta.trustLevel ? meta.trustLevel : "";
  }
  if (elements.runMetaDailyStatus && meta.dailyStatus) {
    elements.runMetaDailyStatus.textContent = meta.dailyStatus;
    elements.runMetaDailyStatus.className = meta.dailyStatusLevel || "";
  }
  if (elements.runMetaDailyAt && meta.dailyAt) {
    elements.runMetaDailyAt.textContent = meta.dailyAt;
  }
}

function updateRunMetaFromRecord(record) {
  if (!record) return;
  const input = record.input || {};
  const output = record.output || {};
  const generatedAt = input.__generatedAt || input.generatedAt;
  const observedAt = latestFieldObservedAt(input);
  const proxyTrace = input.__proxyTrace || input.proxyTrace || [];
  let proxyText = "未知";
  if (proxyTrace.length) {
    const allOk = proxyTrace.every((item) => item.ok);
    proxyText = allOk
      ? `OK (${proxyTrace.map((item) => item.proxy).join("/")})`
      : `WARN (${proxyTrace.map((item) => item.proxy).join("/")})`;
  }
  const missing = input.__missing || [];
  const errors = input.__errors || [];
  const softOnly =
    errors.length > 0 &&
    errors.every((err) => /fallback|blocked|cloudflare|rate limit|历史日期回抓|仅支持最新数据/i.test(err));
  let trust = "OK";
  let trustLevel = "ok";
  if (errors.length && !softOnly) {
    trust = "FAIL";
    trustLevel = "danger";
  } else if (missing.length || softOnly) {
    trust = "WARN";
    trustLevel = "warn";
  }
  if (output.modelRisk?.level === "danger" || output.execution?.level === "high") {
    trust = "FAIL";
    trustLevel = "danger";
  } else if (
    trust === "OK" &&
    (output.modelRisk?.level === "warn" || output.execution?.level === "medium")
  ) {
    trust = "WARN";
    trustLevel = "warn";
  }
  const dataTimeParts = [];
  if (generatedAt) dataTimeParts.push(`抓取 ${formatRunTimestamp(generatedAt)}`);
  if (observedAt) dataTimeParts.push(`观测最新 ${formatRunTimestamp(observedAt)}`);
  setRunMeta({
    dataTime: dataTimeParts.length ? dataTimeParts.join(" · ") : "--",
    source: proxyText,
    trust,
    trustLevel,
  });
}

function setRunStage(target, text) {
  if (!target) return;
  target.textContent = text;
}

async function runToday(options = {}) {
  elements.runBtn.disabled = true;
  elements.runBtn.textContent = "运行中...";
  const targetDate = elements.runDate.value || dateKey();
  try {
    const runId = `RUN-${Date.now()}`;
    setRunMeta({ id: runId, time: `本地计算 ${formatRunTimestamp(Date.now())}` });
    setRunStage(elements.runStageFetch, "待运行");
    setRunStage(elements.runStageValidate, "待运行");
    setRunStage(elements.runStageCompute, "待运行");
    setRunStage(elements.runStageReplay, "待运行");
    setRunStage(elements.runStageAi, "待运行");
    etaTimer.start("total", Date.now());
    const schemaKeys = Object.keys(inputSchema);
    const { mode = "auto", forceRefresh = false } = options;
    const history = loadHistory();

    const baseRecord = history.find((item) => item.date === targetDate);
    const baseInput = cloneJson(baseRecord?.input || null);
    let customInput = baseInput ? { ...baseInput, date: targetDate } : null;

    if (customInput) {
      coerceInputTypes(customInput);
      hydrateFieldFreshness(customInput, targetDate);
      applyHalfLifeGate(customInput, schemaKeys, targetDate);
    }

    if (mode === "auto") {
      showRunStatus("本地历史优先：检查快照与半衰期...");
      setWorkflowStatus(elements.workflowFetch, "检查中");
      setRunStage(elements.runStageFetch, "检查中");
      etaTimer.start("fetch", Date.now());

      // "今日运行" 是显式的用户动作：必须刷新抓取时间，避免“看起来没有更新”。
      // 观测时间是否变化取决于数据源本身是否更新（例如月度/周度数据不会每次都变）。
      if (forceRefresh && targetDate === dateKey()) {
        showRunStatus("强制刷新今日数据（更新抓取时间）...");
        const refreshed = await autoFetch({ targetDate, force: true });
        if (refreshed) {
          customInput = mergeInputsPreferFresh(customInput, refreshed, schemaKeys, targetDate);
          coerceInputTypes(customInput);
          hydrateFieldFreshness(customInput, targetDate);
          applyHalfLifeGate(customInput, schemaKeys, targetDate);
        }
      }

      // 1) 先尝试使用本地 auto.json（不触发外部抓取），再按需触发外部刷新补齐缺失。
      if (needsAutoFetch(customInput, schemaKeys)) {
        showRunStatus("读取本地快照（auto.json）...");
        const localSnap = await autoFetch({ targetDate, force: false });
        if (localSnap) {
          customInput = mergeInputsPreferFresh(customInput, localSnap, schemaKeys, targetDate);
          coerceInputTypes(customInput);
          hydrateFieldFreshness(customInput, targetDate);
          applyHalfLifeGate(customInput, schemaKeys, targetDate);
        }
      }

      if (needsAutoFetch(customInput, schemaKeys)) {
        showRunStatus("外部抓取补齐缺失字段...");
        const refreshed = await autoFetch({ targetDate, force: true });
        if (refreshed) {
          customInput = mergeInputsPreferFresh(customInput, refreshed, schemaKeys, targetDate);
          coerceInputTypes(customInput);
          hydrateFieldFreshness(customInput, targetDate);
          applyHalfLifeGate(customInput, schemaKeys, targetDate);
        }
      }

      etaTimer.end("fetch", Date.now());
      updateEtaDisplay();

      if (!customInput) {
        showError(["未获取到可用数据：本地快照为空且外部抓取失败。"]);
        showRunStatus("运行失败：未获取到数据");
        setWorkflowStatus(elements.workflowFetch, "失败");
        setRunStage(elements.runStageFetch, "失败");
        return;
      }
      setWorkflowStatus(elements.workflowFetch, needsAutoFetch(customInput, schemaKeys) ? "WARN" : "完成");
      setRunStage(elements.runStageFetch, needsAutoFetch(customInput, schemaKeys) ? "WARN" : "完成");
    } else if (needsAutoFetch(customInput, schemaKeys)) {
      showRunStatus("输入不完整：请使用自动抓取补齐缺失字段。");
      setWorkflowStatus(elements.workflowFetch, "跳过");
      setRunStage(elements.runStageFetch, "跳过");
    } else {
      showRunStatus("使用本地快照...");
      setWorkflowStatus(elements.workflowFetch, "跳过");
      setRunStage(elements.runStageFetch, "跳过");
    }

    const normalizedInput = normalizeInputForRun({ ...customInput, date: targetDate }, history);
    coerceInputTypes(normalizedInput);
    hydrateFieldFreshness(normalizedInput, targetDate);
    applyHalfLifeGate(normalizedInput, schemaKeys, targetDate);
    backfillMissingFromHistory(normalizedInput, history, targetDate);
    refreshMissingFields(normalizedInput, Object.keys(inputSchema));
    const errors = validateInput(normalizedInput);
    if (errors.length) {
      const missing = normalizedInput.__missing || [];
      const staleHints = (normalizedInput.__errors || []).filter((item) =>
        String(item).startsWith("半衰期拦截：")
      );
      const errorText = missing.length
        ? [`缺失字段：${missing.map((item) => humanizeFieldName(item)).join("、")}`, ...staleHints]
        : errors;
      showError(errorText);
      showRunStatus("运行失败：字段不完整");
      if (elements.runAdviceBody) {
        const next =
          targetDate === dateKey()
            ? "建议：先点“强制抓取（外部刷新）”，再点“重试今日运行”。"
            : "建议：换一个更近的历史日期回放，或先运行最新日期再回放历史。";
        setRunAdvice(
          `运行失败：字段不完整。\n` +
            (missing.length ? `缺失：${missing.map((item) => humanizeFieldName(item)).join("、")}\n` : "") +
            (staleHints.length ? `${staleHints.join(" / ")}\n` : "") +
            `${next}`
        );
      }
      setWorkflowStatus(elements.workflowValidate, "失败");
      setRunStage(elements.runStageValidate, "失败");
      return;
    }
    if ("__sources" in normalizedInput) {
      const missing = listMissingFields(normalizedInput);
      if (missing.length) {
        showError([`仍缺字段：${missing.join(", ")}`]);
        showRunStatus("运行失败：缺失字段");
        setWorkflowStatus(elements.workflowValidate, "失败");
        setRunStage(elements.runStageValidate, "失败");
        return;
      }
    }
    showError([]);
    showRunStatus("计算中...");
    setWorkflowStatus(elements.workflowValidate, "通过");
    setWorkflowStatus(elements.workflowRun, "计算中");
    setRunStage(elements.runStageValidate, "通过");
    setRunStage(elements.runStageCompute, "计算中");
    etaTimer.start("compute", Date.now());
    const input = { ...normalizedInput };
    const driftSignal = deriveDriftSignal(history, {
      horizon: 7,
      asOfDate: targetDate,
      minSamples: 6,
      lookback: 18,
    });
    const prevRecord = latestRecordBefore(history, targetDate);
    const output = runPipeline(input, {
      asOfDate: targetDate,
      drift: driftSignal,
      previousBeta: prevRecord?.output?.beta,
      costBps: EXECUTION_COST_BPS,
    });
    etaTimer.end("compute", Date.now());
    updateEtaDisplay();
    const record = { date: targetDate, input, output };
    const updated = history.filter((item) => item.date !== targetDate);
    updated.push(record);
    saveHistory(updated);
    renderSnapshot(updated, targetDate);
    updateRunMetaFromRecord(record);
    etaTimer.start("ai", Date.now());
    showRunStatus("完成");
    setWorkflowStatus(elements.workflowRun, "完成");
    setWorkflowStatus(elements.workflowReplay, "可回放");
    setRunStage(elements.runStageCompute, "完成");
    setRunStage(elements.runStageReplay, "可回放");
    runAi(record, updated)
      .catch(() => {})
      .finally(() => {
        etaTimer.end("ai", Date.now());
        etaTimer.end("total", Date.now());
        updateEtaDisplay();
      });
  } finally {
    elements.runBtn.disabled = false;
    elements.runBtn.textContent = "今日运行";
  }
}

function clearHistory() {
  historyMemory = [];
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  resetCachedHistory();
  showError([]);
  renderTimeline([], null);
  syncHistoryWindow();
  setHistoryHint("");
}

function applyCustomInput() {
  try {
    const parsed = parseInputJson(elements.inputJson.value);
    if (!parsed) {
      showError(["输入为空"]);
      return;
    }
    saveCustomInput(parsed);
    runToday({ mode: "manual" });
  } catch (error) {
    showError(["JSON 解析失败：请检查格式。"]);
  }
}

function resetCustomInput() {
  localStorage.removeItem(inputKey);
  elements.inputJson.value = "";
  showError([]);
}

async function autoFetch(options = {}) {
  const { targetDate = null, force = false } = options;
  try {
    showSourceStatus("抓取中...");
    showError([]);
    setWorkflowStatus(elements.workflowFetch, force ? "抓取中" : "本地快照");

    const today = dateKey();
    const wantsHistory = Boolean(targetDate && targetDate !== today);
    const readLocalAuto = !force && !wantsHistory;

    let response;
    if (readLocalAuto) {
      response = await fetch(`/data/auto.json?ts=${Date.now()}`, { cache: "no-store" });
    } else {
      const payloadBody = {};
      if (targetDate) payloadBody.date = targetDate;
      if (force) payloadBody.force = true;
      const endpoint = wantsHistory ? "/data/history" : "/data/refresh";
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
        cache: "no-store",
      });
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "实时抓取失败");
    }
    const payload = await response.json();
    const combined = buildCombinedInput(payload, templateInput);
    combined.__proxyTrace = payload.proxyTrace;
    hydrateFieldFreshness(combined, targetDate || dateKey());
    elements.inputJson.value = JSON.stringify(combined, null, 2);
    saveCustomInput(combined);
    const missing = listMissingFields(combined).filter((key) => key !== "__sources");
    const trace = payload.proxyTrace || [];
    const proxyAllFailed = trace.length ? trace.every((item) => !item.ok) : false;
    const errors = [];
    if (missing.length) {
      errors.push(`仍缺字段：${missing.join(", ")}`);
    }
    if (proxyAllFailed) {
      errors.push("外网不可达：代理/直连均失败，请检查路由器 Clash 的 LAN 访问与端口。");
    }
    showError(errors);
    const proxyTrace = (payload.proxyTrace || [])
      .map((item) => {
        if (item.ok) return `${item.proxy}=OK`;
        return `${item.proxy}=FAIL (${item.error || "未知"})`;
      })
      .join("<br/>");
    showSourceStatus(
      `${
        readLocalAuto
          ? `<strong>已读取</strong>：本地快照 auto.json（无需外部抓取）。更新时间：${payload.generatedAt || "未知"}`
          : `<strong>已抓取</strong>：本地爬虫数据（FRED/DefiLlama/Farside/CoinGecko/Binance/Coinglass）。更新时间：${payload.generatedAt || "未知"}`
      }<br/>代理：${proxyTrace || "未检测"}<br/>缺失：${(payload.missing || []).join(", ") || "无"}<br/>错误：${
        (payload.errors || []).join(" | ") || "无"
      }`
    );
    setWorkflowStatus(elements.workflowFetch, "完成");
    return combined;
  } catch (error) {
    showError([error.message || "自动抓取失败"]);
    showSourceStatus("");
    setWorkflowStatus(elements.workflowFetch, "失败");
    return null;
  }
}

async function fetchHistoryDate(targetDate) {
  try {
    const response = await fetch("/data/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: targetDate }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "历史抓取失败");
    }
    return await response.json();
  } catch (error) {
    showError([error.message || "历史抓取失败"]);
    return null;
  }
}

async function selectHistoryDate(date) {
  if (!date) return;
  const history = loadHistory();
  const existing = history.find((item) => item.date === date);
  if (existing) {
    renderSnapshot(history, date);
    updateRunMetaFromRecord(existing);
    setHistoryHint("已载入本地快照");
    return;
  }
  etaTimer.start("total", Date.now());
  try {
    etaTimer.start("fetch", Date.now());
    setRunMeta({ id: `HIS-${date}`, time: formatRunTimestamp(Date.now()) });
    setRunStage(elements.runStageFetch, "抓取中");
    setRunStage(elements.runStageValidate, "待运行");
    setRunStage(elements.runStageCompute, "待运行");
    setRunStage(elements.runStageReplay, "待运行");
    setRunStage(elements.runStageAi, "待运行");
    setHistoryHint("抓取中...");
    const payload = await fetchHistoryDate(date);
    etaTimer.end("fetch", Date.now());
    updateEtaDisplay();
    if (!payload) {
      setRunStage(elements.runStageFetch, "失败");
      setHistoryHint("抓取失败");
      return;
    }
    setRunStage(elements.runStageFetch, "完成");
    const combined = buildCombinedInput(payload, templateInput);
    const normalized = normalizeInputForRun({ ...combined, date }, history);
    const schemaKeys = Object.keys(inputSchema);
    coerceInputTypes(normalized);
    hydrateFieldFreshness(normalized, date);
    applyHalfLifeGate(normalized, schemaKeys, date);
    backfillMissingFromHistory(normalized, history, date);
    refreshMissingFields(normalized, Object.keys(inputSchema));
    const errors = validateInput(normalized);
    if (errors.length) {
      const staleHints = (normalized.__errors || []).filter((item) =>
        String(item).startsWith("半衰期拦截：")
      );
      showError([...errors, ...staleHints]);
      setHistoryHint("数据不完整，无法回放");
      setRunStage(elements.runStageValidate, "失败");
      setRunStage(elements.runStageCompute, "跳过");
      setRunStage(elements.runStageReplay, "跳过");
      return;
    }
    etaTimer.start("compute", Date.now());
    setRunStage(elements.runStageValidate, "通过");
    setRunStage(elements.runStageCompute, "计算中");
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
    etaTimer.end("compute", Date.now());
    updateEtaDisplay();
    const record = { date, input: normalized, output };
    const updated = history.filter((item) => item.date !== date);
    updated.push(record);
    saveHistory(updated);
    renderSnapshot(updated, date);
    updateRunMetaFromRecord(record);
    etaTimer.start("ai", Date.now());
    setRunStage(elements.runStageCompute, "完成");
    setRunStage(elements.runStageReplay, "可回放");
    await runAi(record, updated);
    etaTimer.end("ai", Date.now());
    setHistoryHint("已抓取并写入历史");
  } finally {
    etaTimer.end("total", Date.now());
    updateEtaDisplay();
  }
}

function setBackfillButtonsDisabled(disabled) {
  [elements.backfill90Btn, elements.backfill180Btn, elements.backfill365Btn].forEach((button) => {
    if (button) button.disabled = disabled;
  });
}

function clearBackfillPollTimer() {
  if (backfillPollTimer) {
    clearTimeout(backfillPollTimer);
    backfillPollTimer = null;
  }
}

function normalizeBackfillStatus(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    status: String(payload.status || "idle").toLowerCase(),
    phase: payload.phase || null,
    startedAt: payload.startedAt || null,
    finishedAt: payload.finishedAt || null,
    asOfDate: payload.asOfDate || null,
    days: Number.isFinite(payload.days) ? payload.days : null,
    step: Number.isFinite(payload.step) ? payload.step : null,
    horizon: Number.isFinite(payload.horizon) ? payload.horizon : null,
    total: Number.isFinite(payload.total) ? payload.total : 0,
    processed: Number.isFinite(payload.processed) ? payload.processed : 0,
    added: Number.isFinite(payload.added) ? payload.added : 0,
    skipped: Number.isFinite(payload.skipped) ? payload.skipped : 0,
    failed: Number.isFinite(payload.failed) ? payload.failed : 0,
    remaining: Number.isFinite(payload.remaining) ? payload.remaining : 0,
    currentDate: payload.currentDate || null,
    message: payload.message || "",
  };
}

async function loadBackfillStatus() {
  try {
    const response = await fetch(`${backfillStatusPath}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeBackfillStatus(payload);
  } catch {
    return null;
  }
}

function formatBackfillStatusText(status) {
  if (!status) return "回测状态未知";
  if (status.status === "running") {
    const progress = status.total
      ? `${Math.min(status.processed, status.total)}/${status.total}`
      : `${status.processed}`;
    return `回填中：${progress}${status.currentDate ? ` · ${status.currentDate}` : ""} · 新增 ${status.added} / 跳过 ${status.skipped} / 失败 ${status.failed}`;
  }
  if (status.status === "done" || status.status === "ok") {
    return `回测补齐完成：新增 ${status.added}，已存在 ${status.skipped}，失败 ${status.failed}。`;
  }
  if (status.status === "fail") {
    return `回测补齐失败：${status.message || "请查看日志"}（失败 ${status.failed}）`;
  }
  return status.message || "回测任务未运行";
}

async function refreshHistoryFromSeed(preferredDate = null) {
  const seed = await loadSeedHistory();
  if (!seed.length) return false;
  saveHistory(seed);
  renderSnapshot(seed, preferredDate || selectedDate || timelineIndex.latestDate || seed[seed.length - 1]?.date || null);
  return true;
}

async function pollBackfillStatusUntilDone() {
  const status = await loadBackfillStatus();
  if (!status) {
    setEvalBackfillStatus("回测状态读取失败，请稍后重试。");
    setBackfillButtonsDisabled(false);
    clearBackfillPollTimer();
    return;
  }
  setEvalBackfillStatus(formatBackfillStatusText(status));
  if (status.status === "running") {
    showRunStatus("回测补齐中...");
    backfillPollTimer = setTimeout(() => {
      pollBackfillStatusUntilDone().catch(() => {});
    }, 1600);
    return;
  }
  clearBackfillPollTimer();
  setBackfillButtonsDisabled(false);
  if (status.status === "done" || status.status === "ok") {
    await refreshHistoryFromSeed(status.asOfDate || dateKey());
    showRunStatus("完成");
  } else if (status.status === "fail") {
    showRunStatus("回测补齐失败");
  }
}

async function backfillEvaluationHistory(maturedDays = 90) {
  clearBackfillPollTimer();
  setBackfillButtonsDisabled(true);
  const payload = {
    days: Number(maturedDays) || 90,
    step: 1,
    horizon: 14,
    asOfDate: dateKey(),
    timeoutSec: 600,
  };
  setEvalBackfillStatus(
    `准备回测补齐 ${payload.days} 天样本（步长 ${payload.step} 天）...`
  );
  showRunStatus("回测补齐中...");
  try {
    const response = await fetch("/data/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || "无法启动回测补齐任务");
    }
    await pollBackfillStatusUntilDone();
  } catch (error) {
    setEvalBackfillStatus(`回测补齐失败：${error.message || "未知错误"}`);
    showRunStatus("回测补齐失败");
    setBackfillButtonsDisabled(false);
    clearBackfillPollTimer();
  }
}

function exportJson(history) {
  const content = JSON.stringify(history, null, 2);
  downloadFile("eth-a-dashboard-history.json", content, "application/json");
}

function exportCsv(history) {
  const content = buildCsv(history);
  downloadFile("eth-a-dashboard-history.csv", content, "text/csv");
}

function syncControls() {
  if (elements.runDate && !elements.runDate.value) {
    elements.runDate.value = dateKey();
  }
  const customInput = loadCustomInput();
  if (customInput && elements.inputJson && !elements.inputJson.value) {
    elements.inputJson.value = JSON.stringify(customInput, null, 2);
  }
}

function initWorkflow() {
  setWorkflowStatus(elements.workflowFetch, "待运行");
  setWorkflowStatus(elements.workflowValidate, "待运行");
  setWorkflowStatus(elements.workflowRun, "待运行");
  setWorkflowStatus(elements.workflowReplay, "待运行");
}

elements.runBtn.addEventListener("click", () => {
  // Button label is "今日运行": always run for today and refresh once.
  if (elements.runDate) {
    elements.runDate.value = dateKey();
  }
  runToday({ mode: "auto", forceRefresh: true });
});
elements.clearBtn.addEventListener("click", clearHistory);
elements.viewPlainBtn?.addEventListener("click", () => setViewMode("plain", { rerender: true }));
elements.viewExpertBtn?.addEventListener("click", () => setViewMode("expert", { rerender: true }));
elements.applyInputBtn?.addEventListener("click", applyCustomInput);
elements.resetInputBtn?.addEventListener("click", resetCustomInput);
elements.exportJsonBtn?.addEventListener("click", () => exportJson(loadHistory()));
elements.exportCsvBtn?.addEventListener("click", () => exportCsv(loadHistory()));
elements.templateBtn?.addEventListener("click", () => {
  elements.inputJson.value = JSON.stringify(templateInput, null, 2);
});
elements.validateBtn?.addEventListener("click", () => {
  try {
    const parsed = parseInputJson(elements.inputJson.value);
    if (!parsed) {
      showError(["输入为空"]);
      return;
    }
    const errors = validateInput(parsed);
    showError(errors);
  } catch (error) {
    showError(["JSON 解析失败：请检查格式。"]);
  }
});
elements.fetchBtn?.addEventListener("click", () =>
  autoFetch({ targetDate: elements.runDate.value || dateKey(), force: false })
);
elements.forceFetchBtn?.addEventListener("click", () =>
  autoFetch({ targetDate: elements.runDate.value || dateKey(), force: true })
);
elements.quickFetchBtn?.addEventListener("click", () =>
  autoFetch({ targetDate: elements.runDate.value || dateKey(), force: false })
);
elements.quickForceFetchBtn?.addEventListener("click", () =>
  autoFetch({ targetDate: elements.runDate.value || dateKey(), force: true })
);
elements.quickRerunBtn?.addEventListener("click", () => {
  if (elements.runDate) {
    elements.runDate.value = dateKey();
  }
  runToday({ mode: "auto", forceRefresh: true });
});
elements.backfill90Btn?.addEventListener("click", () => backfillEvaluationHistory(90));
elements.backfill180Btn?.addEventListener("click", () => backfillEvaluationHistory(180));
elements.backfill365Btn?.addEventListener("click", () => backfillEvaluationHistory(365));
if (elements.timelineRange) {
  elements.timelineRange.addEventListener("input", () => {
    const history = loadHistory();
    const idx = Number(elements.timelineRange.value || 0);
    const realIndex = Math.min(idx, Math.max(0, timelineIndex.dates.length - 1));
    const date = timelineIndex.dates[realIndex];
    if (date) {
      renderSnapshot(history, date);
    }
  });
}
if (elements.timelineLatestBtn) {
  elements.timelineLatestBtn.addEventListener("click", () => {
    const history = loadHistory();
    renderSnapshot(history, timelineIndex.latestDate);
  });
}
if (elements.historyRange) {
  elements.historyRange.addEventListener("input", () => {
    const idx = Number(elements.historyRange.value || 0);
    const date = historyWindow.dates[idx];
    if (elements.historyDate) {
      elements.historyDate.value = date || "";
    }
    if (!date) return;
    const history = loadHistory();
    const existing = history.find((item) => item.date === date);
    if (existing) {
      renderSnapshot(history, date);
      setHistoryHint("已载入本地快照");
    } else {
      setHistoryHint("松开滑块将触发历史抓取");
    }
  });
  elements.historyRange.addEventListener("change", () => {
    const idx = Number(elements.historyRange.value || 0);
    const date = historyWindow.dates[idx];
    if (date) {
      selectHistoryDate(date);
    }
  });
}
if (elements.historyDate) {
  elements.historyDate.addEventListener("change", () => {
    const date = elements.historyDate.value;
    const idx = historyWindow.dates.indexOf(date);
    if (idx < 0) {
      setHistoryHint("日期超出 365 天窗口");
      return;
    }
    if (elements.historyRange) {
      elements.historyRange.value = idx;
    }
    selectHistoryDate(date);
  });
}
if (elements.timelineOverview) {
  elements.timelineOverview.addEventListener("click", (event) => {
    const history = loadHistory();
    if (!history.length) return;
    const rect = elements.timelineOverview.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (timelineIndex.dates.length - 1));
    const date = timelineIndex.dates[idx];
    if (date) {
      renderSnapshot(history, date);
    }
  });
  elements.timelineOverview.addEventListener("wheel", (event) => {
    const history = loadHistory();
    if (!history.length) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const currentIdx = timelineIndex.dates.indexOf(selectedDate);
    const nextIdx = Math.min(
      timelineIndex.dates.length - 1,
      Math.max(0, currentIdx + direction)
    );
    const date = timelineIndex.dates[nextIdx];
    if (date) {
      renderSnapshot(history, date);
    }
  }, { passive: false });
  elements.timelineOverview.addEventListener("mousemove", (event) => {
    if (!elements.timelineTooltip) return;
    const history = loadHistory();
    if (!history.length) return;
    const rect = elements.timelineOverview.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (timelineIndex.dates.length - 1));
    const date = timelineIndex.dates[idx];
    const record = pickRecordByDate(history, date);
    const panel = elements.timelineOverview.closest(".timeline-panel");
    if (!record || !panel) return;
    const panelRect = panel.getBoundingClientRect();
    elements.timelineTooltip.textContent = buildTooltipText(record);
    elements.timelineTooltip.style.left = `${event.clientX - panelRect.left}px`;
    elements.timelineTooltip.style.top = `${rect.top - panelRect.top + 6}px`;
    elements.timelineTooltip.style.opacity = "1";
  });
  elements.timelineOverview.addEventListener("mouseleave", () => {
    if (!elements.timelineTooltip) return;
    elements.timelineTooltip.style.opacity = "0";
  });
}
window.__runToday__ = () => runToday({ mode: "auto" });
window.__autoFetch__ = autoFetch;

setupQuickNav();
setupCoverageControls();
setupMobileTabs();
setupLayoutModeObserver();
setupMobileAccordions();
setupAiFoldToggle();
syncHistoryWindow();

try {
  applyViewMode(localStorage.getItem(viewModeKey) || "plain");
} catch {
  applyViewMode("plain");
}

syncControls();
initWorkflow();
renderAiPanel(elements.aiPanel, loadAiCache());
renderAiStatus(elements.aiStatus, localStorage.getItem(aiStatusKey) || "AI 未联机，已使用本地解读");
applyCoverageFieldAi(aiCacheForDate(selectedDate), selectedDate);
applyDailyStatusMeta(null);

async function bootstrapHistoryView() {
  const local = normalizeHistoryRecords(loadHistory());
  const cached = local.length ? [] : normalizeHistoryRecords(loadCachedHistory() || []);
  // Mobile users should see today's snapshot immediately; full history (27MB) can load later.
  const [latestSeed, seedAi, dailyStatus, backfillStatus, ethPriceSeed, perfSummary, iterationLatest] = await Promise.all([
    loadSeedLatest(),
    loadSeedAi(),
    loadDailyStatus(),
    loadBackfillStatus(),
    loadEthPriceSeed(),
    loadPerfSummary(),
    loadIterationLatest(),
  ]);

  aiSeedByDate = seedAi || {};
  ethPriceSeedByDate = ethPriceSeed?.byDate || null;
  perfSummaryCache = perfSummary || null;
  applyDailyStatusMeta(dailyStatus);
  applyIterationLatest(iterationLatest);

  if (backfillStatus) {
    setEvalBackfillStatus(formatBackfillStatusText(backfillStatus));
    if (backfillStatus.status === "running") {
      setBackfillButtonsDisabled(true);
      pollBackfillStatusUntilDone().catch(() => {});
    }
  } else if (elements.evalBackfillStatus) {
    elements.evalBackfillStatus.textContent = "历史样本加载中...";
  }

  let history = local.length ? local : cached;
  if (latestSeed) {
    history = mergeHistoryRecords([latestSeed], history);
  }

  if (history.length) {
    saveHistory(history);
    renderSnapshot(history, deepLink.date || latestSeed?.date || null);
    const latest = history[history.length - 1];
    const seededAi = latest?.date ? aiSeedByDate?.[latest.date] : null;
    if (seededAi) {
      saveAiCache(seededAi);
      renderAiPanel(elements.aiPanel, seededAi);
      applyCoverageFieldAi(seededAi, latest.date);
      setAiStatus("AI 已预生成（日任务）");
    }

    // If this record comes from daily autorun, reflect the run stages/ID (otherwise it looks like "待运行").
    if (dailyStatus && latest?.date && dailyStatus.date === latest.date) {
      setRunMeta({
        id: dailyStatus.runId || null,
        time: dailyStatus.finishedAt ? `自动任务 ${formatRunTimestamp(dailyStatus.finishedAt)}` : null,
      });
      setWorkflowStatus(elements.workflowFetch, "完成");
      setWorkflowStatus(elements.workflowValidate, "通过");
      setWorkflowStatus(elements.workflowRun, "完成");
      setWorkflowStatus(elements.workflowReplay, "可回放");
      setRunStage(elements.runStageFetch, "完成");
      setRunStage(elements.runStageValidate, "通过");
      setRunStage(elements.runStageCompute, "完成");
      setRunStage(elements.runStageReplay, "可回放");
      setRunStage(elements.runStageAi, seededAi ? "完成" : "预生成");
    }
  } else {
    renderTimeline([], null);
  }

  // Deep link: after initial render, scroll to hash target (if any).
  try {
    if (deepLink.hash) {
      const target = document.querySelector(deepLink.hash);
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  } catch {}

  const today = dateKey();
  const dailyReady =
    dailyStatus &&
    dailyStatus.date === today &&
    (dailyStatus.status === "ok" || dailyStatus.status === "warn");
  const hasToday = history.some((item) => item?.date === today);

  // Kick off full history load in background (does not block initial render).
  loadSeedHistory()
    .then((seed) => {
      if (!seed.length) return;
      const current = normalizeHistoryRecords(loadHistory());
      const merged = mergeHistoryRecords(seed, current);
      saveHistory(merged);
      renderSnapshot(merged, selectedDate || timelineIndex.latestDate);
      if (elements.evalBackfillStatus) {
        elements.evalBackfillStatus.textContent = `已加载历史样本 ${merged.length} 条（含本地种子）`;
      }
    })
    .catch(() => {});

  // If daily task is ready but we still have no today's record (e.g. latest seed missing),
  // fall back to a lightweight local run so the user sees data without clicking.
  if (dailyReady && !hasToday) {
    setTimeout(() => {
      runToday({ mode: "auto" });
    }, 300);
  } else if (!dailyReady && shouldAutoRun(history, today)) {
    setTimeout(() => {
      runToday({ mode: "auto" });
    }, 300);
  } else if (dailyReady) {
    showRunStatus("今日自动任务已完成，当前展示为最新结果。");
  }
}

bootstrapHistoryView();
