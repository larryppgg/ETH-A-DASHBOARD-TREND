import { runPipeline } from "./engine/pipeline.js";
import { dateKey } from "./utils.js";
import { renderOutput, renderTimelineOverview } from "./ui/render.js";
import { buildAiPayload } from "./ai/payload.js";
import { renderAiPanel, renderAiStatus } from "./ui/ai.js";
import { shouldAutoRun } from "./autoRun.js";
import { needsAutoFetch } from "./inputPolicy.js";
import { cacheHistory, loadCachedHistory, resetCachedHistory } from "./ui/cache.js";
import { buildTimelineIndex, nearestDate, pickRecordByDate } from "./ui/timeline.js";
import { buildDateWindow } from "./ui/historyWindow.js";
import { buildTooltipText } from "./ui/formatters.js";
import { buildCombinedInput } from "./ui/inputBuilder.js";
import { createEtaTimer } from "./ui/etaTimer.js";

const storageKey = "eth_a_dashboard_history_v201";
const inputKey = "eth_a_dashboard_custom_input";
const aiKey = "eth_a_dashboard_ai_cache_v1";
const aiStatusKey = "eth_a_dashboard_ai_status_v1";

const elements = {
  runBtn: document.getElementById("runBtn"),
  clearBtn: document.getElementById("clearBtn"),
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
  kanbanA: document.getElementById("kanbanA"),
  kanbanB: document.getElementById("kanbanB"),
  kanbanC: document.getElementById("kanbanC"),
  inputJson: document.getElementById("inputJson"),
  runDate: document.getElementById("runDate"),
  templateBtn: document.getElementById("templateBtn"),
  validateBtn: document.getElementById("validateBtn"),
  fetchBtn: document.getElementById("fetchBtn"),
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
  overviewAction: document.getElementById("overviewAction"),
  overviewActionHint: document.getElementById("overviewActionHint"),
  overviewDrivers: document.getElementById("overviewDrivers"),
  overviewDriversHint: document.getElementById("overviewDriversHint"),
  overviewBlocks: document.getElementById("overviewBlocks"),
  overviewBlocksHint: document.getElementById("overviewBlocksHint"),
  statusOverview: document.getElementById("statusOverview"),
  statusDetailA: document.getElementById("statusDetailA"),
  statusDetailB: document.getElementById("statusDetailB"),
  statusDetailC: document.getElementById("statusDetailC"),
  etaValue: document.getElementById("etaValue"),
  actionSummary: document.getElementById("actionSummary"),
  actionDetail: document.getElementById("actionDetail"),
  counterfactuals: document.getElementById("counterfactuals"),
  missingImpact: document.getElementById("missingImpact"),
  workflowFetch: document.getElementById("workflowFetch"),
  workflowValidate: document.getElementById("workflowValidate"),
  workflowRun: document.getElementById("workflowRun"),
  workflowReplay: document.getElementById("workflowReplay"),
  timelineOverview: document.getElementById("timelineOverview"),
  timelineLegend: document.getElementById("timelineLegend"),
  timelineRange: document.getElementById("timelineRange"),
  timelineLabel: document.getElementById("timelineLabel"),
  timelineLatestBtn: document.getElementById("timelineLatestBtn"),
  timelineTooltip: document.getElementById("timelineTooltip"),
  historyRange: document.getElementById("historyRange"),
  historyDate: document.getElementById("historyDate"),
  historyHint: document.getElementById("historyHint"),
};

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

async function checkAiStatus() {
  try {
    const resp = await fetch("/ai/status");
    if (!resp.ok) {
      setAiStatus("AI 未连接");
      return false;
    }
    const payload = await resp.json();
    if (!payload.enabled) {
      setAiStatus("AI 未启用");
      return false;
    }
    setAiStatus("AI 已连接");
    return true;
  } catch (error) {
    setAiStatus("AI 未连接");
    return false;
  }
}

async function runAi(record) {
  const enabled = await checkAiStatus();
  if (!enabled) {
    return;
  }
  setAiStatus("AI 生成中...");
  const payload = buildAiPayload(record);
  const aiState = {
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
  };
  saveAiCache(aiState);
  renderAiPanel(elements.aiPanel, aiState);

  let errorCount = 0;
  const update = () => {
    saveAiCache(aiState);
    renderAiPanel(elements.aiPanel, aiState);
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
      aiState.summary = "生成失败";
      aiState.summaryStatus = "error";
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
      aiState.overall = "生成失败";
      aiState.overallStatus = "error";
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
              target.text = "生成失败";
              target.status = "error";
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

  await Promise.all([summaryPromise, overallPromise]);
  setAiStatus(errorCount ? "AI 部分完成" : "AI 已生成");
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
    syncHistorySelection(fallback.date);
  }
}

function setWorkflowStatus(target, text) {
  if (!target) return;
  target.textContent = text;
}

async function runToday(options = {}) {
  elements.runBtn.disabled = true;
  elements.runBtn.textContent = "运行中...";
  const targetDate = elements.runDate.value || dateKey();
  try {
    etaTimer.start("total", Date.now());
    const { mode = "auto" } = options;
    let customInput = loadCustomInput();
    if (mode === "auto") {
      showRunStatus("启动自动抓取...");
      setWorkflowStatus(elements.workflowFetch, "抓取中");
      etaTimer.start("fetch", Date.now());
      const fetched = await autoFetch();
      etaTimer.end("fetch", Date.now());
      updateEtaDisplay();
      if (!fetched) {
        showError(["未提供输入数据，请先粘贴 JSON 或插入模板并填写。"]);
        showRunStatus("运行失败：未获取到数据");
        setWorkflowStatus(elements.workflowFetch, "失败");
        return;
      }
      customInput = fetched;
      setWorkflowStatus(elements.workflowFetch, "完成");
    } else if (needsAutoFetch(customInput, Object.keys(inputSchema))) {
      showRunStatus("输入不完整，请先补齐或使用自动抓取。");
      setWorkflowStatus(elements.workflowFetch, "跳过");
    } else {
      showRunStatus("使用已填输入...");
      setWorkflowStatus(elements.workflowFetch, "跳过");
    }
    const history = loadHistory();
    const normalizedInput = normalizeInputForRun({ ...customInput, date: targetDate }, history);
    const errors = validateInput(normalizedInput);
    if (errors.length) {
      const missing = normalizedInput.__missing || [];
      const errorText = missing.length ? [`缺失字段：${missing.join(", ")}`] : errors;
      showError(errorText);
      showRunStatus("运行失败：字段不完整");
      setWorkflowStatus(elements.workflowValidate, "失败");
      return;
    }
    if ("__sources" in normalizedInput) {
      const missing = listMissingFields(normalizedInput);
      if (missing.length) {
        showError([`仍缺字段：${missing.join(", ")}`]);
        showRunStatus("运行失败：缺失字段");
        setWorkflowStatus(elements.workflowValidate, "失败");
        return;
      }
    }
    showError([]);
    showRunStatus("计算中...");
    setWorkflowStatus(elements.workflowValidate, "通过");
    setWorkflowStatus(elements.workflowRun, "计算中");
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
    etaTimer.start("ai", Date.now());
    showRunStatus("完成");
    setWorkflowStatus(elements.workflowRun, "完成");
    setWorkflowStatus(elements.workflowReplay, "可回放");
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

async function autoFetch() {
  try {
    showSourceStatus("抓取中...");
    showError([]);
    setWorkflowStatus(elements.workflowFetch, "抓取中");
    const response = await fetch(`/data/auto.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("本地抓取数据不存在，请先运行 npm run fetch");
    }
    const payload = await response.json();
    const combined = buildCombinedInput(payload, templateInput);
    combined.__proxyTrace = payload.proxyTrace;
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
      `<strong>已抓取</strong>：本地爬虫数据（FRED/DefiLlama/Farside/CoinGecko/Binance/Coinglass）。更新时间：${
        payload.generatedAt || "未知"
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
    setHistoryHint("已载入本地快照");
    return;
  }
  etaTimer.start("total", Date.now());
  etaTimer.start("fetch", Date.now());
  setHistoryHint("抓取中...");
  const payload = await fetchHistoryDate(date);
  etaTimer.end("fetch", Date.now());
  updateEtaDisplay();
  if (!payload) {
    etaTimer.end("total", Date.now());
    updateEtaDisplay();
    setHistoryHint("抓取失败");
    return;
  }
  const combined = buildCombinedInput(payload, templateInput);
  const normalized = normalizeInputForRun({ ...combined, date }, history);
  const errors = validateInput(normalized);
  if (errors.length) {
    showError(errors);
    setHistoryHint("数据不完整，无法回放");
    return;
  }
  etaTimer.start("compute", Date.now());
  const output = runPipeline(normalized);
  etaTimer.end("compute", Date.now());
  updateEtaDisplay();
  const record = { date, input: normalized, output };
  const updated = history.filter((item) => item.date !== date);
  updated.push(record);
  saveHistory(updated);
  renderSnapshot(updated, date);
  etaTimer.start("ai", Date.now());
  await runAi(record);
  etaTimer.end("ai", Date.now());
  etaTimer.end("total", Date.now());
  updateEtaDisplay();
  setHistoryHint("已抓取并写入历史");
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

elements.runBtn.addEventListener("click", () => runToday({ mode: "auto" }));
elements.clearBtn.addEventListener("click", clearHistory);
elements.applyInputBtn.addEventListener("click", applyCustomInput);
elements.resetInputBtn.addEventListener("click", resetCustomInput);
elements.exportJsonBtn.addEventListener("click", () => exportJson(loadHistory()));
elements.exportCsvBtn.addEventListener("click", () => exportCsv(loadHistory()));
elements.templateBtn.addEventListener("click", () => {
  elements.inputJson.value = JSON.stringify(templateInput, null, 2);
});
elements.validateBtn.addEventListener("click", () => {
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
elements.fetchBtn.addEventListener("click", autoFetch);
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

syncHistoryWindow();

const history = loadHistory().length ? loadHistory() : (loadCachedHistory() || []);
if (history.length) {
  renderSnapshot(history, null);
} else {
  renderTimeline([], null);
}

syncControls();
initWorkflow();
renderAiPanel(elements.aiPanel, loadAiCache());
renderAiStatus(elements.aiStatus, localStorage.getItem(aiStatusKey) || "AI 未连接");

if (shouldAutoRun(history, dateKey())) {
  setTimeout(() => {
    runToday({ mode: "auto" });
  }, 300);
}
