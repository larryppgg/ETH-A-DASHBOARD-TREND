import { readFileSync } from "node:fs";
import { evalMacro } from "../src/engine/rules/macro.js";
import { evalLeverage } from "../src/engine/rules/leverage.js";
import { evalETF } from "../src/engine/rules/etf.js";
import { evalSVC } from "../src/engine/rules/svc.js";
import { evalLiquidity } from "../src/engine/rules/liquidity.js";
import { evalDanger } from "../src/engine/rules/danger.js";
import { runPipeline } from "../src/engine/pipeline.js";
import { renderCoverage, renderOutput } from "../src/ui/render.js";
import { buildActionSummary, buildHealthSummary, buildMissingImpact } from "../src/ui/summary.js";
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
    "healthBar",
    "healthFreshness",
    "overviewAction",
    "overviewDrivers",
    "overviewBlocks",
    "actionSummary",
    "counterfactuals",
    "missingImpact",
    "workflowFetch",
    "workflowValidate",
    "workflowRun",
    "workflowReplay",
  ];
  ids.forEach((id) => {
    assert(html.includes(`id=\"${id}\"`), `布局应包含 ${id}`);
  });
}

function testStyleTokens() {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf-8");
  const tokens = [".health-panel", ".health-grid", ".overview-card", ".action-panel", ".workflow"];
  tokens.forEach((token) => {
    assert(css.includes(token), `样式应包含 ${token}`);
  });
}

function testSummaryBuilders() {
  const health = buildHealthSummary({ __missing: ["dxy5d"], __errors: [] });
  assert(health.level === "warn", "健康摘要应识别缺失字段");
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

function run() {
  testMacroGate();
  testLeverageLiquidation();
  testETFBreakout();
  testSVC();
  testTripleHitCutsToC();
  testMacroEtfPenalty();
  testDistributionBoost();
  testRenderOutputInspector();
  testRenderCoverageMissing();
  testBuildAiPayload();
  testShouldAutoRun();
  testNeedsAutoFetch();
  testLayoutSkeleton();
  testStyleTokens();
  testSummaryBuilders();
  testOverallPrompt();
  console.log("All tests passed.");
}

run();
