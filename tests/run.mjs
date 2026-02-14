import { readFileSync } from "node:fs";
import { evalMacro } from "../src/engine/rules/macro.js";
import { evalLeverage } from "../src/engine/rules/leverage.js";
import { evalETF } from "../src/engine/rules/etf.js";
import { evalSVC } from "../src/engine/rules/svc.js";
import { evalLiquidity } from "../src/engine/rules/liquidity.js";
import { evalDanger } from "../src/engine/rules/danger.js";
import { runPipeline } from "../src/engine/pipeline.js";
import { renderCoverage, renderOutput, renderTimelineOverview, renderGateChain, renderAuditVisual } from "../src/ui/render.js";
import {
  buildActionSummary,
  buildHealthSummary,
  buildMissingImpact,
  deriveQualityGate,
  deriveTrustLevel,
  toPlainText,
} from "../src/ui/summary.js";
import { buildSeries, buildTimelineIndex, nearestDate } from "../src/ui/timeline.js";
import { cacheHistory, loadCachedHistory, resetCachedHistory } from "../src/ui/cache.js";
import { buildDateWindow } from "../src/ui/historyWindow.js";
import { formatUsd, buildTooltipText } from "../src/ui/formatters.js";
import { deriveFieldTrend } from "../src/ui/fieldTrend.js";
import { buildCombinedInput, refreshMissingFields } from "../src/ui/inputBuilder.js";
import { createEtaTimer } from "../src/ui/etaTimer.js";
import { parseDeepLink } from "../src/ui/deepLink.js";
import { buildOverallPrompt, PROMPT_VERSION } from "../src/ai/prompts.js";
import { buildAiPayload } from "../src/ai/payload.js";
import { computePredictionEvaluation, deriveDriftSignal, renderPredictionEvaluation } from "../src/ui/eval.js";
import { shouldAutoRun } from "../src/autoRun.js";
import {
  needsAutoFetch,
  resolveHalfLifeDays,
  classifyFieldFreshness,
  pickHistoryBackfillCandidate,
  applyHalfLifeGate,
  mergeInputsPreferFresh,
} from "../src/inputPolicy.js";

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

function testAuditVisualIncludesTrends() {
  const container = createNode();
  const history = [
    { date: "2026-02-01", input: { us2yWeekBp: -12 } },
    { date: "2026-02-13", input: { us2yWeekBp: 5 } },
  ];
  const gate = {
    id: "G0",
    name: "宏观总闸门",
    status: "closed",
    note: "宏观紧缩关门",
    details: {
      inputs: { us2yWeekBp: 5 },
      sources: { us2yWeekBp: "FRED: DGS2" },
      timings: {
        us2yWeekBp: {
          observedAt: "2026-02-13T00:00:00Z",
          fetchedAt: "2026-02-13T01:00:00Z",
          freshness: { level: "fresh", label: "新鲜" },
        },
      },
      calc: {},
      rules: ["2Y 收益率上行"],
    },
  };
  renderAuditVisual(container, gate, { history, currentDate: "2026-02-13" });
  assert(container.innerHTML.includes("audit-trend"), "审计输入应展示趋势行");
  assert(container.innerHTML.includes("coverage-sparkline-svg"), "审计输入应渲染 mini sparkline");
}

function testRenderCoverageMissing() {
  const container = createNode();
  const input = {
    dxy5d: null,
    dxy3dUp: false,
    __missing: ["dxy5d"],
    __sources: { dxy3dUp: "FRED" },
    __generatedAt: "2026-02-08T06:00:00Z",
    __fieldObservedAt: { dxy3dUp: "2026-02-07T00:00:00Z" },
    __fieldFetchedAt: { dxy3dUp: "2026-02-08T06:00:00Z" },
  };
  renderCoverage(container, input);
  assert(container.innerHTML.includes("缺失"), "覆盖矩阵应标记缺失字段");
  assert(container.innerHTML.includes("观测 2026-02-07 00:00"), "覆盖矩阵应展示字段级观测时间");
  assert(container.innerHTML.includes("抓取 2026-02-08 06:00"), "覆盖矩阵应展示字段级抓取时间");
  assert(container.innerHTML.includes('data-field-ai="dxy3dUp"'), "覆盖矩阵应提供字段级 AI 解读槽位");
}

function testRenderCoverageDerivedGroups() {
  const container = createNode();
  const input = { __missing: [], __sources: {} };
  const output = {
    gates: [
      { id: "V7", note: "买家试探 / 强度 0.52", status: "warn" },
      { id: "V8", note: "牛 0.25 / 熊 0.25", status: "warn" },
      { id: "HPM", note: "历史反转孕育区", status: "open" },
    ],
  };
  renderCoverage(container, input, output);
  assert(container.innerHTML.includes("买家试探"), "V7 分区应展示输出解释");
  assert(container.innerHTML.includes("牛 0.25 / 熊 0.25"), "V8 分区应展示矩阵解释");
  assert(container.innerHTML.includes("历史反转孕育区"), "HPM 分区应展示相位映射解释");
  assert(container.innerHTML.includes('data-gate-ai="V7"'), "衍生分区应提供闸门级 AI 解读槽位");
}

function testBuildAiPayload() {
  const output = runPipeline(baseInput());
  const record = {
    date: "2025-01-01",
    input: {
      ...baseInput(),
      __sources: { dxy5d: "FRED: DTWEXBGS" },
      __fieldObservedAt: { dxy5d: "2025-01-01T00:00:00Z" },
      __fieldFetchedAt: { dxy5d: "2025-01-01T03:00:00Z" },
    },
    output,
  };
  const payload = buildAiPayload(record);
  assert(payload.promptVersion === PROMPT_VERSION, "AI payload 应携带 promptVersion，便于长期对账与迭代");
  assert(payload.summary.prompt.includes("仪表盘"), "AI 总结应生成提示词");
  assert(payload.gates.length === output.gates.length, "AI 闸门提示应与闸门数量一致");
  assert(Array.isArray(payload.fields) && payload.fields.length > 20, "AI payload 应包含逐指标字段解读任务");
  assert(payload.fields.some((item) => item.key === "dxy5d"), "字段任务应包含 dxy5d");
  assert(payload.fields[0].prompt.includes("单一指标"), "字段提示词应是逐指标解释");
  const dxyTask = payload.fields.find((item) => item.key === "dxy5d");
  assert((dxyTask?.prompt || "").includes("字段趋势"), "字段提示词应包含趋势上下文");
}

function testFieldTrendDerivation() {
  const history = [
    { date: "2026-01-01", input: { etf10d: -400, dxy3dUp: false } },
    { date: "2026-01-08", input: { etf10d: -250, dxy3dUp: false } },
    { date: "2026-01-16", input: { etf10d: -150, dxy3dUp: true } },
    { date: "2026-01-24", input: { etf10d: -90, dxy3dUp: true } },
  ];
  const numberTrend = deriveFieldTrend(history, "2026-01-24", "etf10d");
  assert(numberTrend.kind === "number", "数值字段应产生数值趋势");
  assert(numberTrend.direction === "up", "etf10d 从-400到-90应为上行趋势");
  assert((numberTrend.text || "").includes("趋势"), "数值趋势应输出可读文案");

  const boolTrend = deriveFieldTrend(history, "2026-01-24", "dxy3dUp");
  assert(boolTrend.kind === "boolean", "布尔字段应产生布尔趋势");
  assert((boolTrend.text || "").includes("趋势"), "布尔趋势应输出可读文案");
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

function testHalfLifePolicyAndBackfillCandidate() {
  const recentHistory = [
    {
      date: "2026-02-07",
      input: {
        etf1d: -20,
        __fieldObservedAt: { etf1d: "2026-02-07T00:00:00Z" },
        __fieldFetchedAt: { etf1d: "2026-02-08T01:00:00Z" },
        __generatedAt: "2026-02-08T01:00:00Z",
      },
    },
    {
      date: "2026-01-20",
      input: {
        etf1d: -10,
        __fieldObservedAt: { etf1d: "2026-01-20T00:00:00Z" },
        __generatedAt: "2026-01-21T00:00:00Z",
      },
    },
  ];
  const staleHistory = [
    {
      date: "2025-12-01",
      input: {
        etf1d: -5,
        __fieldObservedAt: { etf1d: "2025-12-01T00:00:00Z" },
        __generatedAt: "2025-12-01T12:00:00Z",
      },
    },
  ];
  assert(resolveHalfLifeDays("etf1d") <= 7, "ETF 短周期字段半衰期应较短");
  const fresh = classifyFieldFreshness("2026-02-07T00:00:00Z", "2026-02-08", "etf1d");
  assert(fresh.level === "fresh", "近一天数据应判定为新鲜");
  const stale = classifyFieldFreshness("2025-12-01T00:00:00Z", "2026-02-08", "etf1d");
  assert(stale.level === "stale", "超半衰期应判定为过期");
  const candidate = pickHistoryBackfillCandidate(recentHistory, "etf1d", "2026-02-08");
  assert(candidate && candidate.value === -20, "应优先回填最近且未过期的本地历史值");
  const expired = pickHistoryBackfillCandidate(staleHistory, "etf1d", "2026-02-08");
  assert(expired === null, "超半衰期历史值不应参与回填");
}

function testHalfLifeGateClearsStale() {
  const input = {
    etf1d: 12,
    __fieldObservedAt: { etf1d: "2025-12-01T00:00:00Z" },
    __fieldFetchedAt: { etf1d: "2025-12-01T01:00:00Z" },
    __fieldFreshness: {},
    __errors: [],
  };
  const staleKeys = applyHalfLifeGate(input, ["etf1d"], "2026-02-08");
  assert(staleKeys.includes("etf1d"), "半衰期门控应识别过期字段");
  assert(input.etf1d === null, "过期字段应被置空以阻止继续运行");
  assert(
    (input.__errors || []).some((item) => String(item).includes("半衰期拦截")),
    "半衰期拦截应写入 __errors"
  );
}

function testMergeInputsPreferFresh() {
  const base = {
    etf1d: 10,
    __sources: { etf1d: "History" },
    __fieldObservedAt: { etf1d: "2026-02-07T00:00:00Z" },
    __fieldFetchedAt: { etf1d: "2026-02-07T12:00:00Z" },
  };
  const incomingNull = {
    etf1d: null,
    __sources: { etf1d: "Remote" },
    __fieldObservedAt: { etf1d: "2026-02-08T00:00:00Z" },
    __fieldFetchedAt: { etf1d: "2026-02-08T00:00:00Z" },
  };
  const merged1 = mergeInputsPreferFresh(base, incomingNull, ["etf1d"], "2026-02-08");
  assert(merged1.etf1d === 10, "远端缺失时应保留本地可用值");
  assert(
    merged1.__sources?.etf1d === "History",
    "合并后来源应保留被采用的那条记录"
  );

  const incomingStale = {
    etf1d: 99,
    __sources: { etf1d: "Remote" },
    __fieldObservedAt: { etf1d: "2025-12-01T00:00:00Z" },
    __fieldFetchedAt: { etf1d: "2026-02-08T00:00:00Z" },
  };
  const merged2 = mergeInputsPreferFresh(base, incomingStale, ["etf1d"], "2026-02-08");
  assert(merged2.etf1d === 10, "远端过期值不应覆盖本地新鲜值");
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
    "healthTimeliness",
    "healthQuality",
    "healthDrift",
    "healthExecution",
    "decisionPanel",
    "decisionConclusion",
    "decisionExecutable",
    "decisionWhy",
    "decisionNext",
    "predictionSummaryCard",
    "predictionSummaryValue",
    "predictionSummaryEvalBtn",
    "predictionSummaryIterBtn",
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
    "runMetaDailyStatus",
    "runMetaDailyAt",
    "historyRange",
    "historyDate",
    "historyHint",
    "gateChain",
    "auditVisual",
    "statusOverview",
    "viewPlainBtn",
    "viewExpertBtn",
    "evalPanel",
    "iterationPanelSection",
    "iterationMeta",
    "iterationBody",
    "backfill90Btn",
    "backfill180Btn",
    "backfill365Btn",
    "evalBackfillStatus",
    "mobileTabbar",
    "runFloatingBtn",
    "runFloatingEta",
    "rawJsonFold",
    "coverageFold",
  ];
  ids.forEach((id) => {
    assert(html.includes(`id=\"${id}\"`), `布局应包含 ${id}`);
  });
  assert(html.includes("自动模式"), "数据台应明确自动模式优先");
}

function testPredictionSummaryCardWiresToEval() {
  const kanbanCol = createNode("div");
  const evalPanelSection = createNode("section");
  evalPanelSection.hidden = true;
  const called = [];
  global.window = {
    __ethSetMobileTab(tab) {
      called.push(tab);
      if (tab === "explain") {
        evalPanelSection.hidden = false;
      }
    },
  };
  global.document = {
    body: { classList: { add() {}, remove() {} }, dataset: {} },
    querySelectorAll() {
      return [kanbanCol, kanbanCol, kanbanCol];
    },
    querySelector() {
      return kanbanCol;
    },
    createElement(tag) {
      return createNode(tag);
    },
    getElementById(id) {
      if (id === "evalPanelSection") return evalPanelSection;
      return null;
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
    evidenceHints: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    predictionSummaryValue: createNode(),
    predictionSummaryEvalBtn: createNode("button"),
    predictionSummaryIterBtn: createNode("button"),
  };
  const record = {
    date: "2026-02-13",
    input: { ...baseInput(), ethSpotPrice: 2300 },
    output: runPipeline(baseInput()),
  };
  renderOutput(
    elements,
    record,
    [record],
    {
      perfSummary: {
        asOfDate: "2026-02-13",
        maturity: { matured: 8, total: 10, ratio: 0.8 },
        byHorizon: {
          "7": { total: 8, hit: 4, accuracy: 0.5, thresholdPct: 5, byState: {} },
          "14": { total: 5, hit: 3, accuracy: 0.6, thresholdPct: 8, byState: {} },
        },
        drift: { "7": { level: "warn", note: "样本略少" }, "14": { level: "ok", note: "" } },
      },
    }
  );
  assert(
    (elements.predictionSummaryValue.textContent || "").includes("成熟"),
    "预测闭环摘要应渲染成熟度信息"
  );
  elements.predictionSummaryEvalBtn.__handlers.click?.();
  assert(called.includes("explain"), "点击查看评估应切换到 explain Tab");
  assert(evalPanelSection.hidden === false, "点击查看评估后评估区应可见");
}

function testCacheBustingAssets() {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf-8");
  assert(html.includes("styles.css?v=20260213-2"), "样式应带最新 cache bust 参数");
  assert(html.includes("app.js?v=20260213-4"), "脚本应带最新 cache bust 参数");
}

function testNoInlineRunOnclick() {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf-8");
  assert(
    !html.includes('id="runBtn" class="cta" onclick='),
    "runBtn 不应使用内联 onclick，避免双重触发"
  );
}

function testAppAutoFetchEndpoint() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    source.includes("\"/data/refresh\""),
    "autoFetch 应支持 /data/refresh 实时重抓"
  );
  assert(
    source.includes("/data/auto.json?ts="),
    "autoFetch 应支持读取本地 auto.json（本地历史优先）"
  );
  assert(
    source.includes('"/data/history"'),
    "autoFetch 选择历史日期时应调用 /data/history"
  );
}

function testAppLoadsEthPriceSeed() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    source.includes("/data/eth.price.seed.json"),
    "启动应加载 eth.price.seed.json 以减少评估 PENDING 并稳定漂移门"
  );
}

function testAppLoadsPerfSummary() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    source.includes("/data/perf-summary"),
    "启动应加载 perf-summary（run/perf_summary.json）用于展示每日性能摘要"
  );
}

function testAppMobileTabsIncludeIterationPanel() {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf-8");
  assert(
    source.includes("iterationPanelSection"),
    "移动端 explain Tab 应包含 iterationPanelSection（迭代建议可见）"
  );
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
  const historicalSoftTrust = deriveTrustLevel({
    __missing: [],
    __errors: ["历史日期回抓：部分来源仅支持最新数据，已使用最新值补齐。"],
  });
  assert(historicalSoftTrust.level === "warn", "历史回抓提示应归类为软错误");
  const fresh = buildHealthSummary({
    __missing: [],
    __errors: [],
    __generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  assert(fresh.freshnessText.includes("距今"), "数据新鲜度应包含距今提示");
  const output = runPipeline(baseInput());
  const action = buildActionSummary(output);
  assert(action.action.includes("β"), "行动摘要应包含 beta 信息");
  assert(action.humanAdvice && action.humanAdvice.length > 4, "行动摘要应包含人话建议");
  const impact = buildMissingImpact({ __missing: ["dxy5d", "etf1d"] });
  assert(impact.length >= 1, "缺失影响应返回列表");
}

function testQualityGateIncludesModelRisk() {
  const gate = deriveQualityGate(
    { __missing: [], __errors: [], __fieldFreshness: {} },
    { aiStatus: "AI 已生成", driftLevel: "danger", executionLevel: "high" }
  );
  assert(gate.level === "danger", "漂移 danger 时质量门禁应降级");
  assert(
    gate.reasons.some((item) => item.includes("漂移")) && gate.reasons.some((item) => item.includes("成本")),
    "门禁理由应覆盖漂移与成本"
  );
}

function testPlainTextRespectsViewModeDataset() {
  const previousDocument = global.document;
  global.document = { body: { dataset: { viewMode: "expert" } } };
  const raw = "SVC 结构强势加成";
  const expert = toPlainText(raw);
  global.document.body.dataset.viewMode = "plain";
  const plain = toPlainText(raw);
  global.document = previousDocument;

  assert(expert === raw, "专家视图应输出原始术语，不应插入括号解释");
  assert(plain.includes("（"), "通俗视图应包含括号解释");
}

function testEvalPanelRenders() {
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
    gateChain: createNode(),
    auditVisual: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    evidenceHints: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    coverageList: createNode(),
    statusOverview: createNode(),
    timelineLabel: createNode(),
    timelineRange: createNode("input"),
    timelineOverview: null,
    timelineLegend: null,
    evalPanel: createNode(),
  };
  const recordA = {
    date: "2026-02-01",
    input: { ...baseInput(), ethSpotPrice: 1000 },
    output: runPipeline(baseInput()),
  };
  const recordB = {
    date: "2026-02-08",
    input: { ...baseInput(), ethSpotPrice: 1100 },
    output: runPipeline(baseInput()),
  };
  renderOutput(elements, recordB, [recordA, recordB]);
  assert(elements.evalPanel.innerHTML && elements.evalPanel.innerHTML.length > 10, "预测评估面板应渲染内容");
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

function testDevScriptUsesServer() {
  const dev = readFileSync(new URL("../scripts/dev.sh", import.meta.url), "utf-8");
  assert(dev.includes("scripts/server.py"), "备用启动脚本应使用 server.py，保证 API 可用");
}

function testServerExposesIterationLatest() {
  const server = readFileSync(new URL("../scripts/server.py", import.meta.url), "utf-8");
  assert(server.includes("/data/iteration-latest"), "server 应提供 /data/iteration-latest 以便前端展示迭代建议");
}

function testDailyAutorunUpdatesEthPriceSeed() {
  const daily = readFileSync(new URL("../scripts/daily_autorun.mjs", import.meta.url), "utf-8");
  assert(daily.includes("eth_price_seed.py"), "daily_autorun 应生成 eth.price.seed.json（价格种子）");
  assert(daily.includes("eth.price.seed.json"), "daily_autorun 应写入 eth.price.seed.json 文件名");
  assert(daily.includes("perf_summary.json"), "daily_autorun 应生成 run/perf_summary.json（性能摘要）");
  assert(daily.includes("buildPerfSummary"), "daily_autorun 应复用 buildPerfSummary 生成性能摘要");
  assert(daily.includes("iteration_report.mjs"), "daily_autorun 应生成每日迭代建议报告（iteration_report.mjs）");
  assert(daily.includes("buildIterationReport"), "daily_autorun 应复用 buildIterationReport 生成迭代建议报告");
  assert(daily.includes("discord_notify.mjs"), "daily_autorun 应支持 Discord Webhook 推送（日报/报警）");
}

async function testPerfSummaryBuilder() {
  const mod = await import("../scripts/perf_summary.mjs");
  const buildPerfSummary = mod.buildPerfSummary;
  assert(typeof buildPerfSummary === "function", "应暴露 buildPerfSummary(history, options) 构建性能摘要");

  const history = [];
  for (let day = 1; day <= 12; day += 1) {
    const dd = String(day).padStart(2, "0");
    history.push({ date: `2026-02-${dd}`, input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } });
  }
  const priceByDate = {
    "2026-02-08": { close: 900, volume: 0 },
    "2026-02-09": { close: 900, volume: 0 },
    "2026-02-10": { close: 900, volume: 0 },
    "2026-02-11": { close: 900, volume: 0 },
    "2026-02-12": { close: 900, volume: 0 },
  };
  const summary = buildPerfSummary(history, { asOfDate: "2026-02-12", priceByDate });
  assert(summary.asOfDate === "2026-02-12", "perf summary 应包含 asOfDate");
  assert(summary.maturity?.matured >= 4, "perf summary 应包含成熟样本统计");
  assert(summary.byHorizon?.["7"], "perf summary 应包含 7D 汇总");
}

async function testIterationReportBuilder() {
  const mod = await import("../scripts/iteration_report.mjs");
  const buildIterationReport = mod.buildIterationReport;
  assert(typeof buildIterationReport === "function", "应暴露 buildIterationReport(perfSummary, options) 生成迭代建议报告");
  const report = buildIterationReport(
    {
      asOfDate: "2026-02-12",
      maturity: { total: 12, matured: 5, pending: 7, ratio: 0.41 },
      byHorizon: { "7": { total: 5, hit: 0, accuracy: 0.0, thresholdPct: 5, byState: {} } },
      drift: { "7": { level: "danger", note: "7D 命中率偏离", sampleSize: 5, accuracy: 0.0 } },
      recent: [{ date: "2026-02-01", state: "A", expectation: "up", price: 1000, horizons: { "7": { verdict: "miss", returnPct: -10 } } }],
    },
    { promptVersion: "2026-02-13-1" }
  );
  assert(typeof report === "string" && report.includes("迭代建议"), "迭代报告应输出可读 Markdown 文本");
}

async function testDiscordMessageBuilder() {
  const mod = await import("../scripts/discord_notify.mjs");
  const buildDiscordMessage = mod.buildDiscordMessage;
  assert(typeof buildDiscordMessage === "function", "应暴露 buildDiscordMessage(...) 生成 Discord 文本消息");
  const record = {
    date: "2026-02-13",
    input: { ...baseInput(), __sources: { dxy5d: "FRED" } },
    output: runPipeline(baseInput()),
  };
  const payload = buildDiscordMessage({
    type: "daily",
    baseUrl: "https://etha.mytagclash001.help",
    date: "2026-02-13",
    record,
    perfSummary: {
      asOfDate: "2026-02-13",
      maturity: { matured: 8, total: 10, ratio: 0.8 },
      byHorizon: { "7": { accuracy: 0.5, hit: 4, total: 8 }, "14": { accuracy: 0.6, hit: 3, total: 5 } },
      drift: { "7": { level: "warn" }, "14": { level: "ok" } },
    },
    dailyStatus: { status: "ok" },
    iterationExcerpt: "迭代建议：保持谨慎。",
  });
  assert(
    typeof payload?.content === "string" && payload.content.includes("2026-02-13"),
    "Discord 消息应包含日期"
  );
  assert(payload.content.includes("etha.mytagclash001.help?date=2026-02-13"), "Discord 消息应包含深链");
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

function testParseDeepLink() {
  const parsed = parseDeepLink("?date=2026-02-01&tab=explain", "#evalPanelSection");
  assert(parsed.date === "2026-02-01", "deep link 应解析 date 参数");
  assert(parsed.tab === "explain", "deep link 应解析 tab 参数");
  assert(parsed.hash === "#evalPanelSection", "deep link 应保留 hash");
  const invalid = parseDeepLink("?date=2026-2-1&tab=wat", "");
  assert(invalid.date === null, "非法 date 应返回 null");
  assert(invalid.tab === null, "非法 tab 应返回 null");
}

function testPredictionEvaluationBasic() {
  const history = [
    { date: "2026-02-01", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
    { date: "2026-02-08", input: { ethSpotPrice: 1100 }, output: { state: "B", confidence: 0.5 } },
    { date: "2026-02-15", input: { ethSpotPrice: 990 }, output: { state: "C", confidence: 0.6 } },
  ];
  const evaluation = computePredictionEvaluation(history, { horizons: [7, 14] });
  assert(Array.isArray(evaluation.rows) && evaluation.rows.length === 3, "评估应生成逐日行");
  assert(evaluation.summary.byHorizon["7"], "评估应包含 7D 汇总");
  assert(evaluation.summary.byHorizon["14"], "评估应包含 14D 汇总");
}

function testPredictionEvaluationAsOfGuard() {
  const history = [
    { date: "2026-02-01", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
    { date: "2026-02-08", input: { ethSpotPrice: 1040 }, output: { state: "B", confidence: 0.5 } },
    { date: "2026-02-15", input: { ethSpotPrice: 980 }, output: { state: "C", confidence: 0.6 } },
  ];
  const evaluation = computePredictionEvaluation(history, { horizons: [7], asOfDate: "2026-02-08" });
  const row0201 = evaluation.rows.find((row) => row.date === "2026-02-01");
  const row0208 = evaluation.rows.find((row) => row.date === "2026-02-08");
  assert(row0201.horizons["7"].futureDate === "2026-02-08", "as-of 保护下仅允许使用 asOf 之前的未来样本");
  assert(row0208.horizons["7"].verdict === "pending", "targetDate 超过 asOf 时应保持 pending，避免时间穿越");
}

function testPredictionEvaluationUsesPriceSeed() {
  const history = [
    { date: "2026-02-01", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
    // Intentionally omit the future snapshot record so we must rely on priceByDate.
    { date: "2026-02-02", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
  ];
  const priceByDate = {
    "2026-02-08": { close: 1100, volume: 123 },
  };
  const evaluation = computePredictionEvaluation(history, {
    horizons: [7],
    asOfDate: "2026-02-10",
    priceByDate,
  });
  const row0201 = evaluation.rows.find((row) => row.date === "2026-02-01");
  assert(row0201, "应找到 2026-02-01 行");
  assert(row0201.horizons["7"].verdict === "hit", "提供价格种子时不应依赖未来快照，且应正确判定 HIT/MISS");
  assert(row0201.horizons["7"].futurePrice === 1100, "价格种子应填充 futurePrice");
  assert(row0201.horizons["7"].futureDate === "2026-02-08", "价格种子应填充 futureDate");
}

function testDeriveDriftSignal() {
  const history = [
    { date: "2026-01-01", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.65 } },
    { date: "2026-01-08", input: { ethSpotPrice: 980 }, output: { state: "A", confidence: 0.66 } },
    { date: "2026-01-15", input: { ethSpotPrice: 960 }, output: { state: "A", confidence: 0.67 } },
    { date: "2026-01-22", input: { ethSpotPrice: 940 }, output: { state: "A", confidence: 0.68 } },
    { date: "2026-01-29", input: { ethSpotPrice: 920 }, output: { state: "A", confidence: 0.69 } },
    { date: "2026-02-05", input: { ethSpotPrice: 900 }, output: { state: "A", confidence: 0.7 } },
    { date: "2026-02-12", input: { ethSpotPrice: 880 }, output: { state: "A", confidence: 0.71 } },
    { date: "2026-02-19", input: { ethSpotPrice: 860 }, output: { state: "A", confidence: 0.72 } },
  ];
  const drift = deriveDriftSignal(history, { horizon: 7, asOfDate: "2026-02-19", minSamples: 4 });
  assert(drift.level === "danger" || drift.level === "warn", "命中率显著下行时应触发漂移预警");
  assert(typeof drift.accuracy === "number", "漂移信号应返回可量化 accuracy");
}

function testDeriveDriftSignalUsesPriceSeed() {
  const history = [];
  for (let day = 1; day <= 12; day += 1) {
    const dd = String(day).padStart(2, "0");
    history.push({ date: `2026-02-${dd}`, input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } });
  }
  const priceByDate = {
    "2026-02-08": { close: 900, volume: 0 },
    "2026-02-09": { close: 900, volume: 0 },
    "2026-02-10": { close: 900, volume: 0 },
    "2026-02-11": { close: 900, volume: 0 },
    "2026-02-12": { close: 900, volume: 0 },
  };
  const drift = deriveDriftSignal(history, { horizon: 7, asOfDate: "2026-02-12", minSamples: 4, priceByDate });
  assert(drift.level !== "unknown", "提供价格种子时漂移门不应长期样本不足");
  assert(drift.sampleSize >= 4, "提供价格种子后 sampleSize 应满足 minSamples");
}

function testRenderPredictionEvaluationUsesPriceSeed() {
  const container = createNode();
  const history = [
    { date: "2026-02-01", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
    { date: "2026-02-02", input: { ethSpotPrice: 1000 }, output: { state: "A", confidence: 0.7 } },
    // Keep a later as-of focus record but omit its price to ensure we must use priceByDate.
    { date: "2026-02-10", input: { ethSpotPrice: null }, output: { state: "B", confidence: 0.5 } },
  ];
  const focus = history[2];
  const priceByDate = {
    "2026-02-08": { close: 1100, volume: 0 },
  };
  renderPredictionEvaluation(container, history, focus, { priceByDate });
  assert(
    container.innerHTML.includes("eval-pill hit"),
    "评估渲染应在历史稀疏时使用价格种子生成 HIT/MISS（而不是全 pending）"
  );
}

function testRenderOutputPassesPriceSeedToEval() {
  const kanbanCol = createNode("div");
  global.document = {
    body: { classList: { add() {}, remove() {} }, dataset: {} },
    querySelectorAll() {
      return [kanbanCol, kanbanCol, kanbanCol];
    },
    querySelector() {
      return kanbanCol;
    },
    createElement(tag) {
      return createNode(tag);
    },
    getElementById() {
      return null;
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
    gateChain: createNode(),
    auditVisual: createNode(),
    topReasons: createNode(),
    riskNotes: createNode(),
    evidenceHints: createNode(),
    betaChart: createNode(),
    confidenceChart: createNode(),
    fofChart: createNode(),
    kanbanA: createNode(),
    kanbanB: createNode(),
    kanbanC: createNode(),
    coverageList: createNode(),
    statusOverview: createNode(),
    timelineLabel: null,
    timelineRange: null,
    timelineOverview: null,
    timelineLegend: null,
    evalPanel: createNode(),
    healthFreshness: createNode(),
    healthMissing: createNode(),
    healthProxy: createNode(),
    healthAi: createNode(),
    healthTimeliness: createNode(),
    healthQuality: createNode(),
    healthDrift: createNode(),
    healthExecution: createNode(),
    decisionConclusion: createNode(),
    decisionExecutable: createNode(),
    decisionWhy: createNode(),
    decisionNext: createNode(),
    runMetaTrust: createNode(),
    runAdviceBody: createNode(),
    actionSummary: createNode(),
    actionDetail: createNode(),
    actionAvoid: createNode(),
    actionWatch: createNode(),
    counterfactuals: createNode(),
    missingImpact: createNode(),
    workflowReplay: createNode(),
    workflowRun: createNode(),
    workflowValidate: createNode(),
  };

  const older = {
    date: "2026-02-01",
    input: { ...baseInput(), ethSpotPrice: 1000 },
    output: { ...runPipeline(baseInput()), state: "A", reasonsTop3: [] },
  };
  const focus = {
    date: "2026-02-10",
    input: { ...baseInput(), ethSpotPrice: null },
    output: { ...runPipeline(baseInput()), state: "B", reasonsTop3: [] },
  };
  renderOutput(elements, focus, [older, focus], { priceByDate: { "2026-02-08": { close: 1100, volume: 0 } } });
  assert(
    elements.evalPanel.innerHTML.includes("eval-pill hit"),
    "renderOutput 应将 priceByDate 透传到评估渲染，避免历史稀疏导致全 pending"
  );
}

function testPipelineAppliesDriftAndCostControls() {
  const base = runPipeline(baseInput({ distributionGateCount: 3 }), {
    drift: { level: "ok" },
    previousBeta: 0.1,
    costBps: 10,
  });
  const constrained = runPipeline(baseInput({ distributionGateCount: 3 }), {
    drift: { level: "danger", accuracy: 0.22, baseline: 0.55, sampleSize: 14, note: "7D 命中率偏离" },
    previousBeta: 0.95,
    costBps: 60,
  });
  assert(constrained.beta <= base.beta, "漂移+成本约束后 beta 不应高于无约束基线");
  assert(constrained.modelRisk?.level === "danger", "输出应暴露漂移等级");
  assert(
    constrained.execution?.level === "high" || constrained.execution?.level === "medium",
    "输出应暴露成本等级"
  );
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
    data: {
      ...baseInput(),
      prevEtfExtremeOutflow: false,
      stablecoin30d: null,
      mappingRatioDown: null,
      rsdScore: null,
    },
    sources: {},
    missing: ["stablecoin30d", "mappingRatioDown", "rsdScore"],
    errors: [],
    proxyTrace: [],
  };

  const prevDateRecord = {
    date: "2026-01-31",
    input: { ...baseInput(), prevEtfExtremeOutflow: false },
    output: runPipeline(baseInput()),
  };
  store["eth_a_dashboard_history_v201"] = JSON.stringify([prevDateRecord]);

  let resolveAiStatus;
  const aiStatusPromise = new Promise((resolve) => {
    resolveAiStatus = resolve;
  });

  global.fetch = (url) => {
    if (url === "/data/refresh") {
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
    assert(
      !(nodes.inputError.textContent || "").includes("缺失字段"),
      "历史补齐后不应再提示字段缺失"
    );
    assert(
      (nodes.aiStatus.textContent || "").includes("离线解读") ||
        (nodes.aiStatus.textContent || "").includes("本地解读"),
      "AI 不可用时状态应明确为本地/离线解读"
    );
    assert(
      !(nodes.aiStatus.textContent || "").includes("未启用"),
      "AI 状态文案不应停留在未启用"
    );
    assert(
      (nodes.aiPanel.innerHTML || "").includes("本地离线解读"),
      "AI 未启用时应回退本地离线解读"
    );
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
  testAuditVisualIncludesTrends();
  testRenderCoverageMissing();
  testRenderCoverageDerivedGroups();
  testBuildAiPayload();
  testFieldTrendDerivation();
  testShouldAutoRun();
  testNeedsAutoFetch();
  testHalfLifePolicyAndBackfillCandidate();
  testHalfLifeGateClearsStale();
  testMergeInputsPreferFresh();
  testLayoutSkeleton();
  testPredictionSummaryCardWiresToEval();
  testCacheBustingAssets();
  testNoInlineRunOnclick();
  testAppAutoFetchEndpoint();
  testAppLoadsEthPriceSeed();
  testAppLoadsPerfSummary();
  testAppMobileTabsIncludeIterationPanel();
  testStyleTokens();
  testRenderOutputActionVariableNaming();
  testAppDoesNotImportRefreshMissingFields();
  testAppDoesNotImportDeriveTrustLevel();
  testSummaryBuilders();
  testQualityGateIncludesModelRisk();
  testPlainTextRespectsViewModeDataset();
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
  testDevScriptUsesServer();
  testServerExposesIterationLatest();
  testDailyAutorunUpdatesEthPriceSeed();
  await testPerfSummaryBuilder();
  await testIterationReportBuilder();
  await testDiscordMessageBuilder();
  testEtaTimerTotals();
  testParseDeepLink();
  testPredictionEvaluationBasic();
  testPredictionEvaluationAsOfGuard();
  testPredictionEvaluationUsesPriceSeed();
  testDeriveDriftSignal();
  testDeriveDriftSignalUsesPriceSeed();
  testRenderPredictionEvaluationUsesPriceSeed();
  testRenderOutputPassesPriceSeedToEval();
  testPipelineAppliesDriftAndCostControls();
  testEvalPanelRenders();
  await testRunTodayCompletesBeforeAi();
  console.log("All tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
