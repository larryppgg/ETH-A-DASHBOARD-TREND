import { readFileSync } from "node:fs";
import { evalMacro } from "../src/engine/rules/macro.js";
import { evalLeverage } from "../src/engine/rules/leverage.js";
import { evalETF } from "../src/engine/rules/etf.js";
import { evalSVC } from "../src/engine/rules/svc.js";
import { evalLiquidity } from "../src/engine/rules/liquidity.js";
import { evalDanger } from "../src/engine/rules/danger.js";
import { runPipeline } from "../src/engine/pipeline.js";
import { renderCoverage, renderOutput, renderTimelineOverview, renderGateChain } from "../src/ui/render.js";
import {
  buildActionSummary,
  buildHealthSummary,
  buildMissingImpact,
  deriveTrustLevel,
} from "../src/ui/summary.js";
import { buildSeries, buildTimelineIndex, nearestDate } from "../src/ui/timeline.js";
import { cacheHistory, loadCachedHistory, resetCachedHistory } from "../src/ui/cache.js";
import { buildDateWindow } from "../src/ui/historyWindow.js";
import { formatUsd, buildTooltipText } from "../src/ui/formatters.js";
import { buildCombinedInput, refreshMissingFields } from "../src/ui/inputBuilder.js";
import { createEtaTimer } from "../src/ui/etaTimer.js";
import { buildOverallPrompt } from "../src/ai/prompts.js";
import { buildAiPayload } from "../src/ai/payload.js";
import { shouldAutoRun } from "../src/autoRun.js";
import { needsAutoFetch } from "../src/inputPolicy.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseInput(overrides = {}) {
  return {
    dxy5d: 0,
    dxy3dUp: false,
    us2yWeekBp: 0,
    fciUpWeeks: 0,
    etf10d: 100,
    etf5d: 50,
    etf1d: 10,
    stablecoin30d: 2,
    exchStableDelta: 1,
    policyWindow: false,
    preMeeting2y: 4.6,
    current2y: 4.5,
    preMeetingDxy: 102,
    currentDxy: 101,
    crowdingIndex: 60,
    liquidationUsd: 400_000_000,
    longWicks: false,
    reverseFishing: false,
    shortFailure: false,
    exchBalanceTrend: -0.2,
    floatDensity: 0.5,
    mcapElasticity: 0.4,
    mcapGrowth: 0.1,
    volumeConfirm: true,
    rsdScore: 6,
    lstcScore: 6,
    mappingRatioDown: false,
    netIssuanceHigh: false,
    cognitivePotential: 0.6,
    liquidityPotential: 0.6,
    onchainReflexivity: 0.6,
    sentimentThreshold: 0.4,
    topo: 0.6,
    spectral: 0.6,
    roughPath: 0.6,
    deltaES: 0.6,
    trendMomentum: 0.6,
    divergence: 0.5,
    distributionGateCount: 0,
    rrpChange: 0,
    tgaChange: 0,
    srfChange: 0,
    ism: 49,
    ...overrides,
  };
}

function testMacroGate() {
  const macro = evalMacro(baseInput({ dxy5d: 1.2 }));
  assert(macro.closed === true, "G0: DXY 触发应关门");
  const macro2 = evalMacro(baseInput({ dxy5d: 1.2, us2yWeekBp: 12 }));
  assert(macro2.forceC === true, "G0: 双信号应触发直切 C");
}

function testLeverageLiquidation() {
  const leverage = evalLeverage(baseInput({ liquidationUsd: 1_200_000_000 }), 100);
  assert(leverage.betaPenaltyHalf === true, "V3: 清算>10亿应降 β 1/2");
}

function testETFBreakout() {
  const etf = evalETF(baseInput({ etf1d: 60, volumeConfirm: true }));
  assert(etf.breakoutValidated === true, "V5: 突破验证应通过");
  const etf2 = evalETF(baseInput({ etf1d: 60, volumeConfirm: false }));
  assert(etf2.breakoutValidated === false, "V5: 缺成交量不应通过");
}

function testSVC() {
  const svc = evalSVC(baseInput({ rsdScore: 2, lstcScore: 2, mappingRatioDown: true, netIssuanceHigh: true }));
  assert(svc.betaCapShift === -1, "V6.2: 结构弱应下调 β_cap");
  assert(svc.redLights.length === 2, "V6.2: 两条结构红灯应记录");
}

function testTripleHitCutsToC() {
  const input = baseInput({
    dxy5d: 1.2,
    etf10d: -700,
    etf5d: -500,
    stablecoin30d: -8,
    exchStableDelta: -6,
  });
  const macro = evalMacro(input);
  const liquidity = evalLiquidity(input);
  const etf = evalETF(input);
  const danger = evalDanger(macro, liquidity, etf, { bubbleWarning: false, floatThin: false });
  assert(danger.tripleHit === true, "V6: 三连击应触发");
  const output = runPipeline(input);
  assert(output.state === "C", "三连击应直切 C");
  assert(output.hedge === true, "三连击应默认对冲");
}

function testMacroEtfPenalty() {
  const input = baseInput({ dxy5d: 1.1, etf10d: -100 });
  const output = runPipeline(input);
  assert(output.beta <= output.betaCap, "宏观关门下 beta 应受限制");
}

function testDistributionBoost() {
  const output = runPipeline(baseInput({ distributionGateCount: 3 }));
  assert(output.confidence >= 0.2, "分发闸门加成应保持置信度范围");
}

function createNode(tag = "div") {
  return {
    tag,
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    style: {},
    dataset: {},
    __handlers: {},
    children: [],
    classList: {
      _set: new Set(),
      add(cls) {
        this._set.add(cls);
      },
      remove(cls) {
        this._set.delete(cls);
      },
      contains(cls) {
        return this._set.has(cls);
      },
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector.startsWith('[data-gate-id="')) {
        const gateId = selector.split('"')[1];
        return this.children.find((child) => child.dataset.gateId === gateId) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".reason-link") {
        return this.children.filter((child) => child.classList?.contains("reason-link"));
      }
      return [];
    },
    addEventListener(type, handler) {
      this.__handlers[type] = handler;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    },
    closest() {
      return this;
    },
  };
}

function testRenderOutputInspector() {
  const kanbanCol = createNode("div");
  global.document = {
    body: { classList: { add() {}, remove() {} } },
    querySelectorAll() {
      return [kanbanCol, kanbanCol, kanbanCol];
    },
    querySelector() {
      return kanbanCol;
    },
    createElement(tag) {
      return createNode(tag);
    },
  };
  const elements = {
    statusBadge: createNode(),
    statusTitle: createNode(),
    statusSub: createNode(),
    betaValue: createNode(),
    hedgeValue: createNode(),
    phaseValue: createNode(),
    confidenceValue: createNode(),
    extremeValue: createNode(),
    distributionValue: createNode(),
    lastRun: createNode(),
    gateList: createNode(),
    gateInspector: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
  };
  const output = runPipeline(baseInput());
  output.gates = [
    { id: "G0", name: "宏观总闸门", status: "pass", note: "ok", details: { inputs: { dxy5d: 0 }, sources: {}, calc: {} } },
  ];
  output.reasonsTop3 = [{ text: "宏观稳定", gateId: "G0" }];
  const record = { date: "2025-01-01", input: baseInput(), output };
  renderOutput(elements, record, [record]);
  const reasonNode = elements.topReasons.children[0];
  reasonNode.__handlers.click?.();
  assert(elements.gateInspector.innerHTML.includes("G0"), "审计面板应显示默认闸门详情");
}

function testStatusOverviewRenders() {
  const kanbanCol = createNode("div");
  const elements = {
    statusBadge: createNode(),
    statusTitle: createNode(),
    statusSub: createNode(),
    betaValue: createNode(),
    hedgeValue: createNode(),
    phaseValue: createNode(),
    confidenceValue: createNode(),
    extremeValue: createNode(),
    distributionValue: createNode(),
    lastRun: createNode(),
    gateList: createNode(),
    gateInspector: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    statusOverview: createNode(),
  };
  global.document = {
    body: { classList: { add() {}, remove() {} } },
    querySelectorAll() {
      return [kanbanCol, kanbanCol, kanbanCol];
    },
    querySelector() {
      return kanbanCol;
    },
    createElement(tag) {
      return createNode(tag);
    },
  };
  const output = runPipeline(baseInput());
  const record = { date: "2026-01-01", input: baseInput(), output };
  renderOutput(elements, record, [record]);
  assert(elements.statusOverview.innerHTML.includes("status-overview-bar"), "状态总览应渲染");
}

function testRenderCoverageMissing() {
  const container = createNode();
  const input = {
    dxy5d: null,
    dxy3dUp: false,
    __missing: ["dxy5d"],
    __sources: { dxy3dUp: "FRED" },
  };
  renderCoverage(container, input);
  assert(container.innerHTML.includes("缺失"), "覆盖矩阵应标记缺失字段");
}

function testBuildAiPayload() {
  const output = runPipeline(baseInput());
  const record = { date: "2025-01-01", input: baseInput(), output };
  const payload = buildAiPayload(record);
  assert(payload.summary.prompt.includes("仪表盘"), "AI 总结应生成提示词");
  assert(payload.gates.length === output.gates.length, "AI 闸门提示应与闸门数量一致");
}

function testShouldAutoRun() {
  const today = "2026-01-25";
  assert(shouldAutoRun([], today) === true, "无历史时应自动运行");
  assert(
    shouldAutoRun([{ date: today }], today) === false,
    "当天已有记录时不应自动运行"
  );
  assert(
    shouldAutoRun([{ date: "2026-01-24" }], today) === true,
    "历史不是当天应自动运行"
  );
}

function testNeedsAutoFetch() {
  const keys = ["a", "b"];
  assert(needsAutoFetch(null, keys) === true, "无输入应抓取");
  assert(needsAutoFetch({ a: 1, b: 2, __sources: {} }, keys) === false, "完整输入不应抓取");
  assert(needsAutoFetch({ a: 1, b: null, __sources: {} }, keys) === true, "空字段应抓取");
  assert(needsAutoFetch({ a: 1, __sources: {} }, keys) === true, "缺字段应抓取");
  assert(needsAutoFetch({ a: 1, b: 2 }, keys) === true, "缺来源应抓取");
}

function testLayoutSkeleton() {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf-8");
  const ids = [
    "runBar",
    "runStageFetch",
    "runStageValidate",
    "runStageCompute",
    "runStageReplay",
    "runStageAi",
    "runMetaId",
    "runMetaTime",
    "runMetaDataTime",
    "runMetaSource",
    "runMetaTrust",
    "runMetaLeft",
    "runMetaRight",
    "healthFreshness",
    "timelineOverview",
    "timelineRange",
    "timelineLabel",
    "timelineLatestBtn",
    "timelineLegend",
    "actionSummary",
    "counterfactuals",
    "missingImpact",
    "workflowFetch",
    "workflowValidate",
    "workflowRun",
    "workflowReplay",
    "historyRange",
    "historyDate",
    "historyHint",
    "gateChain",
    "auditVisual",
    "statusOverview",
  ];
  ids.forEach((id) => {
    assert(html.includes(`id=\"${id}\"`), `布局应包含 ${id}`);
  });
}

function testCacheBustingAssets() {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf-8");
  assert(html.includes("styles.css?v=20260202-5"), "样式应带最新 cache bust 参数");
  assert(html.includes("app.js?v=20260202-5"), "脚本应带最新 cache bust 参数");
}

function testStyleTokens() {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf-8");
  const tokens = [
    ".health-panel",
    ".health-grid",
    ".timeline-panel",
    ".timeline-track",
    ".overview-card",
    ".action-panel",
    ".workflow",
  ];
  tokens.forEach((token) => {
    assert(css.includes(token), `样式应包含 ${token}`);
  });
}

function testRenderOutputActionVariableNaming() {
  const renderSource = readFileSync(new URL("../src/ui/render.js", import.meta.url), "utf-8");
  assert(
    renderSource.includes("const actionSummary = buildActionSummary"),
    "renderOutput 应使用 actionSummary 命名以避免 TDZ"
  );
}

function testAppDoesNotImportRefreshMissingFields() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    !source.includes("refreshMissingFields } from \"./ui/inputBuilder.js\""),
    "app.js 不应从 inputBuilder 导入 refreshMissingFields"
  );
}

function testAppDoesNotImportDeriveTrustLevel() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    !source.includes("deriveTrustLevel"),
    "app.js 不应导入 deriveTrustLevel，避免浏览器缓存不一致"
  );
}

function testSummaryBuilders() {
  const health = buildHealthSummary({ __missing: ["dxy5d"], __errors: [] });
  assert(health.level === "warn", "健康摘要应识别缺失字段");
  const softTrust = deriveTrustLevel({ __missing: [], __errors: ["fallback to jina"] });
  assert(softTrust.level === "warn", "仅软错误时可信度应为 WARN");
  const fresh = buildHealthSummary({
    __missing: [],
    __errors: [],
    __generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  assert(fresh.freshnessText.includes("距今"), "数据新鲜度应包含距今提示");
  const output = runPipeline(baseInput());
  const action = buildActionSummary(output);
  assert(action.action.includes("β"), "行动摘要应包含 beta 信息");
  const impact = buildMissingImpact({ __missing: ["dxy5d", "etf1d"] });
  assert(impact.length >= 1, "缺失影响应返回列表");
}

function testOverallPrompt() {
  const output = runPipeline(baseInput());
  const prompt = buildOverallPrompt(output, baseInput());
  assert(prompt.includes("AI仪表盘 2.0.1"), "整体提示词应包含版本信息");
  assert(prompt.includes("预测"), "整体提示词应包含预测要求");
}

function testTimelineIndex() {
  const history = [{ date: "2026-01-02" }, { date: "2026-01-01" }];
  const idx = buildTimelineIndex(history);
  assert(idx.dates[0] === "2026-01-01", "日期应排序");
  assert(idx.latestDate === "2026-01-02", "应识别最新日期");
  assert(nearestDate(idx.dates, "2026-01-03") === "2026-01-02", "应返回最近日期");
  const series = buildSeries(history, (item) => (item.date === "2026-01-01" ? 1 : 2));
  assert(series.length === 2, "序列长度应匹配历史");
}

function testHistoryWindowDateRange() {
  const now = new Date("2026-01-28T00:00:00Z");
  const { dates, latest } = buildDateWindow(now, 365);
  assert(dates.length === 365, "历史窗口应为 365 天");
  assert(latest === "2026-01-28", "窗口最新日期应为 today");
  assert(dates[0] === "2025-01-29", "窗口最早日期应为 today-364");
}

function testTimelineIncludesEthPriceSeries() {
  const container = createNode();
  const legend = createNode();
  const history = [
    {
      date: "2026-01-01",
      input: { ethSpotPrice: 2000 },
      output: { beta: 0.3, confidence: 0.4, fofScore: 60, state: "B", extremeAllowed: false, distributionGate: 0, riskNotes: [] },
    },
  ];
  renderTimelineOverview(container, legend, history, "2026-01-01");
  assert(legend.innerHTML.includes("ETH 现货"), "时间轴图例应包含 ETH 现货");
  assert(!legend.innerHTML.includes("FoF"), "时间轴图例默认不显示 FoF");
}

function testEthTooltipFormat() {
  assert(formatUsd(3456.78) === "$3,456.78", "USD 格式应带千分位与两位小数");
}

function testTooltipIncludesDateAndPrice() {
  const record = {
    date: "2026-01-01",
    input: { ethSpotPrice: 3456.78 },
  };
  const text = buildTooltipText(record);
  assert(text.includes("2026-01-01"), "应包含日期");
  assert(text.includes("$3,456.78"), "应包含格式化价格");
}

function testGateChainHasNodes() {
  const container = createNode();
  renderGateChain(container, [{ id: "G0", status: "open", name: "宏观总闸门" }], "G0");
  assert(container.innerHTML.includes("G0"), "闸门链路应渲染节点");
}

function testEtaTimerTotals() {
  const timer = createEtaTimer();
  timer.start("fetch", 0);
  timer.end("fetch", 1000);
  timer.start("compute", 1000);
  timer.end("compute", 2500);
  const total = timer.totalMs();
  assert(total === 2500, "总耗时应为各阶段累加");
}

function testBuildCombinedInputPrefersPayloadMissing() {
  const payload = {
    data: { stablecoin30d: 1, mappingRatioDown: true, rsdScore: 5 },
    sources: {},
    missing: [],
    errors: [],
    generatedAt: "2026-01-30T00:00:00Z",
  };
  const template = { stablecoin30d: null, mappingRatioDown: null, rsdScore: null };
  const combined = buildCombinedInput(payload, template);
  assert(combined.stablecoin30d === 1, "应合并 payload 数据");
  assert(Array.isArray(combined.__missing) && combined.__missing.length === 0, "应使用 payload.missing");
}

function testRefreshMissingFieldsOverridesStaleMissing() {
  const input = {
    ism: 233,
    mappingRatioDown: true,
    rsdScore: 6,
    stablecoin30d: -0.5,
    __missing: ["ism", "mappingRatioDown", "rsdScore", "stablecoin30d"],
  };
  const missing = refreshMissingFields(input, ["ism", "mappingRatioDown", "rsdScore", "stablecoin30d"]);
  assert(missing.length === 0, "应清理已补齐字段的缺失标记");
  assert(Array.isArray(input.__missing) && input.__missing.length === 0, "输入应更新 __missing");
}

function testTimelineRangeLatestAtRight() {
  const timelineRange = createNode("input");
  timelineRange.value = "0";
  timelineRange.max = "0";
  const recordA = { date: "2026-01-26", input: baseInput(), output: runPipeline(baseInput()) };
  const recordB = { date: "2026-01-27", input: baseInput(), output: runPipeline(baseInput()) };
  const elements = {
    statusBadge: createNode(),
    statusTitle: createNode(),
    statusSub: createNode(),
    betaValue: createNode(),
    hedgeValue: createNode(),
    phaseValue: createNode(),
    confidenceValue: createNode(),
    extremeValue: createNode(),
    distributionValue: createNode(),
    lastRun: createNode(),
    gateList: createNode(),
    gateInspector: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    timelineLabel: createNode(),
    timelineRange,
    timelineOverview: null,
    timelineLegend: null,
  };
  renderOutput(elements, recordB, [recordA, recordB]);
  assert(Number(timelineRange.max) === 1, "Timeline: max should be latest index");
  assert(Number(timelineRange.value) === 1, "Timeline: latest should map to rightmost value");
}

function testTimelineSingleRecordRightmost() {
  const timelineRange = createNode("input");
  const record = { date: "2026-01-27", input: baseInput(), output: runPipeline(baseInput()) };
  const elements = {
    statusBadge: createNode(),
    statusTitle: createNode(),
    statusSub: createNode(),
    betaValue: createNode(),
    hedgeValue: createNode(),
    phaseValue: createNode(),
    confidenceValue: createNode(),
    extremeValue: createNode(),
    distributionValue: createNode(),
    lastRun: createNode(),
    gateList: createNode(),
    gateInspector: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    timelineLabel: createNode(),
    timelineRange,
    timelineOverview: null,
    timelineLegend: null,
  };
  renderOutput(elements, record, [record]);
  assert(Number(timelineRange.max) === 1, "单条记录应将 max 扩展为 1");
  assert(Number(timelineRange.value) === 1, "单条记录应显示在最右侧");
}

function testCacheTTLThirtyDays() {
  const originalNow = Date.now;
  const now = Date.now();
  let store = {};
  global.localStorage = {
    getItem(key) {
      return store[key] ?? null;
    },
    setItem(key, value) {
      store[key] = value;
    },
    removeItem(key) {
      delete store[key];
    },
  };
  const history = [{ date: "2026-01-27" }];
  Date.now = () => now;
  cacheHistory(history);
  Date.now = () => now + 1000 * 60 * 60 * 24 * 31;
  const loaded = loadCachedHistory();
  resetCachedHistory();
  Date.now = originalNow;
  assert(loaded === null, "Cache TTL should expire after 30 days");
}

function createAppDom() {
  const nodes = {};
  const kanbanCol = createNode("div");
  const getNode = (id) => {
    if (!nodes[id]) nodes[id] = createNode("div");
    return nodes[id];
  };
  const doc = {
    body: { classList: { add() {}, remove() {} } },
    getElementById(id) {
      return getNode(id);
    },
    querySelectorAll() {
      return [kanbanCol, kanbanCol, kanbanCol];
    },
    querySelector() {
      return kanbanCol;
    },
    createElement(tag) {
      return createNode(tag);
    },
  };
  return { doc, nodes };
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testRunTodayCompletesBeforeAi() {
  const { doc, nodes } = createAppDom();
  global.document = doc;
  global.window = {};
  let store = {};
  global.localStorage = {
    getItem(key) {
      return store[key] ?? null;
    },
    setItem(key, value) {
      store[key] = value;
    },
    removeItem(key) {
      delete store[key];
    },
  };

  doc.getElementById("runDate").value = "2026-02-01";

  const payload = {
    generatedAt: "2026-02-01T00:00:00Z",
    data: { ...baseInput(), prevEtfExtremeOutflow: false },
    sources: {},
    missing: [],
    errors: [],
    proxyTrace: [],
  };

  let resolveAiStatus;
  const aiStatusPromise = new Promise((resolve) => {
    resolveAiStatus = resolve;
  });

  global.fetch = (url) => {
    if (typeof url === "string" && url.startsWith("/data/auto.json")) {
      return Promise.resolve({
        ok: true,
        json: async () => payload,
      });
    }
    if (url === "/ai/status") {
      return aiStatusPromise;
    }
    if (typeof url === "string" && url.startsWith("/ai/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ summary: "ok" }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  };

  await import("../src/app.js");
  const runPromise = global.window.__runToday__();
  await wait(0);

  try {
    assert(nodes.runStatus.textContent === "完成", "今日运行不应阻塞于 AI 请求");
  } finally {
    resolveAiStatus({
      ok: true,
      json: async () => ({ enabled: false }),
    });
    await runPromise;
  }
}
async function run() {
  testMacroGate();
  testLeverageLiquidation();
  testETFBreakout();
  testSVC();
  testTripleHitCutsToC();
  testMacroEtfPenalty();
  testDistributionBoost();
  testRenderOutputInspector();
  testStatusOverviewRenders();
  testRenderCoverageMissing();
  testBuildAiPayload();
  testShouldAutoRun();
  testNeedsAutoFetch();
  testLayoutSkeleton();
  testCacheBustingAssets();
  testStyleTokens();
  testRenderOutputActionVariableNaming();
  testAppDoesNotImportRefreshMissingFields();
  testAppDoesNotImportDeriveTrustLevel();
  testSummaryBuilders();
  testOverallPrompt();
  testTimelineIndex();
  testTimelineRangeLatestAtRight();
  testTimelineSingleRecordRightmost();
  testCacheTTLThirtyDays();
  testHistoryWindowDateRange();
  testTimelineIncludesEthPriceSeries();
  testEthTooltipFormat();
  testTooltipIncludesDateAndPrice();
  testBuildCombinedInputPrefersPayloadMissing();
  testRefreshMissingFieldsOverridesStaleMissing();
  testGateChainHasNodes();
  testEtaTimerTotals();
  await testRunTodayCompletesBeforeAi();
  console.log("All tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
