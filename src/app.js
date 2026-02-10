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

const storageKey = "eth_a_dashboard_history_v201";
const inputKey = "eth_a_dashboard_custom_input";
const aiKey = "eth_a_dashboard_ai_cache_v1";
const aiStatusKey = "eth_a_dashboard_ai_status_v1";
const viewModeKey = "eth_a_dashboard_view_mode_v1";

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
  runAdvice: document.getElementById("runAdvice"),
  runAdviceBody: document.getElementById("runAdviceBody"),
  quickFetchBtn: document.getElementById("quickFetchBtn"),
  quickForceFetchBtn: document.getElementById("quickForceFetchBtn"),
  quickRerunBtn: document.getElementById("quickRerunBtn"),
  coverageSearch: document.getElementById("coverageSearch"),
  coverageFilter: document.getElementById("coverageFilter"),
  coverageClearBtn: document.getElementById("coverageClearBtn"),
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
  if (!input || !Array.isArray(schemaKeys)) {
    return [];
  }
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

function loadHistory() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(storageKey, JSON.stringify(history));
  cacheHistory(history);
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
  const cached = loadAiCache();
  if (!cached) return null;
  if (!date) return cached;
  if (!cached.date) return cached;
  return cached.date === date ? cached : null;
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
    const textNode = node.querySelector(".coverage-ai-text");
    if (!textNode) return;
    if (!target) {
      node.setAttribute("data-state", "pending");
      textNode.textContent = "等待生成...";
      return;
    }
    node.setAttribute("data-state", target.status || "pending");
    textNode.textContent = target.text || "等待生成...";
  });

  const gateNodes = elements.coverageList.querySelectorAll("[data-gate-ai]");
  gateNodes.forEach((node) => {
    const gateId = node.getAttribute("data-gate-ai");
    const target = gateMap.get(gateId);
    const textNode = node.querySelector(".coverage-ai-text");
    if (!textNode) return;
    if (!target) {
      node.setAttribute("data-state", "pending");
      textNode.textContent = "等待生成...";
      return;
    }
    node.setAttribute("data-state", target.status || "pending");
    textNode.textContent = target.text || "等待生成...";
  });

  // Inline gate AI (audit/inspector) and inline field AI (key evidence chips).
  document.querySelectorAll("[data-gate-ai-inline]").forEach((node) => {
    if (!node || typeof node.getAttribute !== "function") return;
    const gateId = node.getAttribute("data-gate-ai-inline");
    const target = gateMap.get(gateId);
    const textNode = node.querySelector(".coverage-ai-text");
    if (!target) {
      node.setAttribute("data-state", "pending");
      if (textNode) textNode.textContent = "等待生成...";
      return;
    }
    node.setAttribute("data-state", target.status || "pending");
    if (textNode) textNode.textContent = target.text || "等待生成...";
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
      text: `${gate.note || "暂无"}；状态 ${String(gate.status || "--").toUpperCase()}`,
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

async function runAi(record) {
  const payload = buildAiPayload(record);
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
              target.text = `${fallbackGate?.note || "暂无"}；状态 ${String(fallbackGate?.status || "--").toUpperCase()}`;
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

const etaTimer = createEtaTimer();

function updateEtaDisplay() {
  if (!elements.etaValue) return;
  const total = etaTimer.totalMs();
  elements.etaValue.textContent = etaTimer.formatMs(total);
}

let selectedDate = null;
let timelineIndex = buildTimelineIndex([]);
let historyWindow = buildDateWindow(new Date(), 365);

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
    renderOutput(elements, record, history);
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
    renderOutput(elements, fallback, history);
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
}

function updateRunMetaFromRecord(record) {
  if (!record) return;
  const input = record.input || {};
  const generatedAt = input.__generatedAt || input.generatedAt;
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
  setRunMeta({
    dataTime: generatedAt ? `抓取 ${formatRunTimestamp(generatedAt)}` : "--",
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
    const baseInput = cloneJson(baseRecord?.input || loadCustomInput());
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
    const output = runPipeline(input);
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
    runAi(record)
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
  localStorage.removeItem(storageKey);
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
    const output = runPipeline(normalized);
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
    await runAi(record);
    etaTimer.end("ai", Date.now());
    setHistoryHint("已抓取并写入历史");
  } finally {
    etaTimer.end("total", Date.now());
    updateEtaDisplay();
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
syncHistoryWindow();

try {
  applyViewMode(localStorage.getItem(viewModeKey) || "plain");
} catch {
  applyViewMode("plain");
}

const history = loadHistory().length ? loadHistory() : (loadCachedHistory() || []);
if (history.length) {
  renderSnapshot(history, null);
} else {
  renderTimeline([], null);
}

syncControls();
initWorkflow();
renderAiPanel(elements.aiPanel, loadAiCache());
renderAiStatus(elements.aiStatus, localStorage.getItem(aiStatusKey) || "AI 离线解读待机");
applyCoverageFieldAi(aiCacheForDate(selectedDate), selectedDate);

if (shouldAutoRun(history, dateKey())) {
  setTimeout(() => {
    runToday({ mode: "auto" });
  }, 300);
}
