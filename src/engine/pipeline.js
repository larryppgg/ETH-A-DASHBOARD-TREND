import { clamp, formatNumber } from "../utils.js";
import { evalMacro } from "./rules/macro.js";
import { evalLiquidity } from "./rules/liquidity.js";
import { evalRiskOn } from "./rules/riskSwitch.js";
import { evalLeverage } from "./rules/leverage.js";
import { evalSupply } from "./rules/supply.js";
import { evalETF } from "./rules/etf.js";
import { evalDanger } from "./rules/danger.js";
import { evalSVC } from "./rules/svc.js";
import { evalBPI } from "./rules/bpi.js";
import { evalBCM } from "./rules/bcm.js";
import { evalHPM } from "./rules/hpm.js";
import { evalPhase } from "./rules/phase.js";
import { evalBE } from "./rules/be.js";
import { evalTriDomain } from "./rules/tridomain.js";
import { evalATAF } from "./rules/ataf.js";
import {
  calculateStateBias,
  deriveState,
  applyStateCaps,
  applyDriftDegrade,
  computeBeta,
} from "./rules/state.js";

export function runPipeline(input, runtime = {}) {
  const safeInput = input;
  const runtimeSafe = runtime || {};
  const driftInput = runtimeSafe.drift || {};
  const driftLevel =
    driftInput.level === "danger" || driftInput.level === "warn" || driftInput.level === "ok"
      ? driftInput.level
      : "ok";
  const driftMultiplier =
    Number.isFinite(driftInput.betaMultiplier) && driftInput.betaMultiplier > 0
      ? driftInput.betaMultiplier
      : driftLevel === "danger"
      ? 0.72
      : driftLevel === "warn"
      ? 0.86
      : 1;
  const driftNote =
    driftInput.note ||
    (driftLevel === "danger"
      ? "预测命中率偏离基线，执行强降级"
      : driftLevel === "warn"
      ? "预测命中率低于基线，执行温和降级"
      : "预测质量稳定");
  const driftAccuracy = Number.isFinite(driftInput.accuracy) ? driftInput.accuracy : null;
  const driftBaseline = Number.isFinite(driftInput.baseline) ? driftInput.baseline : null;
  const driftSampleSize = Number.isFinite(driftInput.sampleSize) ? driftInput.sampleSize : null;
  const executionCostBps =
    Number.isFinite(runtimeSafe.costBps) && runtimeSafe.costBps > 0 ? runtimeSafe.costBps : 12;
  const sourceMap = safeInput.__sources || {};
  const gates = [];
  const macro = evalMacro(safeInput);
  gates.push({
    id: "G0",
    name: "宏观总闸门",
    status: macro.closed ? "closed" : "open",
    note: macro.triggers.length ? macro.triggers.join(" / ") : "无紧缩信号",
    details: {
      inputs: {
        dxy5d: safeInput.dxy5d,
        dxy3dUp: safeInput.dxy3dUp,
        us2yWeekBp: safeInput.us2yWeekBp,
        fciUpWeeks: safeInput.fciUpWeeks,
      },
      calc: {
        closed: macro.closed,
        forceC: macro.forceC,
      },
      rules: macro.triggers,
    },
  });

  const liquidity = evalLiquidity(safeInput);
  gates.push({
    id: "V1",
    name: "流动性总分（FoF）",
    status: liquidity.red ? "closed" : liquidity.score < 50 ? "warn" : "open",
    note: `FoF ${formatNumber(liquidity.score, 0)} · ${liquidity.label}`,
    details: {
      inputs: {
        etf10d: safeInput.etf10d,
        stablecoin30d: safeInput.stablecoin30d,
        exchStableDelta: safeInput.exchStableDelta,
      },
      calc: {
        score: formatNumber(liquidity.score, 2),
        red: liquidity.red,
      },
      rules: liquidity.red ? ["缺血红灯"] : [],
    },
  });

  const riskSwitch = evalRiskOn(safeInput);
  gates.push({
    id: "V2",
    name: "利率/汇率 Risk-ON",
    status: riskSwitch.riskOn ? "open" : "warn",
    note: riskSwitch.note,
    details: {
      inputs: {
        policyWindow: safeInput.policyWindow,
        preMeeting2y: safeInput.preMeeting2y,
        current2y: safeInput.current2y,
        preMeetingDxy: safeInput.preMeetingDxy,
        currentDxy: safeInput.currentDxy,
      },
      calc: {
        riskOn: riskSwitch.riskOn,
      },
      rules: riskSwitch.riskOn ? ["Risk-ON 打开"] : [],
    },
  });

  const ataf = evalATAF(safeInput);
  gates.push({
    id: "D-ATAF",
    name: "MoneyGate / 商业周期",
    status: ataf.bias === "偏紧" ? "warn" : "open",
    note: `流动性偏向 ${ataf.bias}`,
    details: {
      inputs: {
        rrpChange: safeInput.rrpChange,
        tgaChange: safeInput.tgaChange,
        srfChange: safeInput.srfChange,
        ism: safeInput.ism,
      },
      calc: {
        bias: ataf.bias,
      },
      rules: [...ataf.tighteningSignals, ...ataf.easingSignals],
    },
  });

  const leverage = evalLeverage(safeInput, safeInput.etf10d);
  gates.push({
    id: "V3",
    name: "杠杆结构与清算博弈",
    status: leverage.betaPenaltyHalf ? "closed" : leverage.highCrowding ? "warn" : "open",
    note: leverage.notes.length ? leverage.notes.join(" / ") : "结构中性",
    details: {
      inputs: {
        crowdingIndex: safeInput.crowdingIndex,
        etf10d: safeInput.etf10d,
        liquidationUsd: safeInput.liquidationUsd,
        longWicks: safeInput.longWicks,
        reverseFishing: safeInput.reverseFishing,
        shortFailure: safeInput.shortFailure,
      },
      calc: {
        betaPenaltyThird: leverage.betaPenaltyThird,
        betaPenaltyHalf: leverage.betaPenaltyHalf,
      },
      rules: leverage.notes,
    },
  });

  const supply = evalSupply(safeInput);
  gates.push({
    id: "V4",
    name: "卖墙与浮筹结构",
    status: supply.bubbleWarning ? "warn" : "open",
    note: supply.notes.length ? supply.notes.join(" / ") : "供给结构中性",
    details: {
      inputs: {
        exchBalanceTrend: safeInput.exchBalanceTrend,
        floatDensity: safeInput.floatDensity,
        mcapElasticity: safeInput.mcapElasticity,
        mcapGrowth: safeInput.mcapGrowth,
      },
      calc: {
        sellWallThin: supply.sellWallThin,
        floatThin: supply.floatThin,
        mcapElasticityHigh: supply.mcapElasticityHigh,
        bubbleWarning: supply.bubbleWarning,
      },
      rules: supply.notes,
    },
  });

  const etf = evalETF(safeInput);
  gates.push({
    id: "V5",
    name: "ETF 买墙与连击",
    status: etf.fiveDayRed ? "closed" : "open",
    note: etf.breakoutNote,
    details: {
      inputs: {
        etf10d: safeInput.etf10d,
        etf5d: safeInput.etf5d,
        etf1d: safeInput.etf1d,
        volumeConfirm: safeInput.volumeConfirm,
      },
      calc: {
        fiveDayRed: etf.fiveDayRed,
        extremeOutflow: etf.extremeOutflow,
        breakoutValidated: etf.breakoutValidated,
      },
      rules: [etf.breakoutNote],
    },
  });

  const danger = evalDanger(macro, liquidity, etf, supply);
  gates.push({
    id: "V6",
    name: "风险矩阵",
    status: danger.tripleHit ? "closed" : danger.riskSignals.length ? "warn" : "open",
    note: danger.tripleHit ? "三连击直切 C" : danger.riskSignals.join(" / ") || "无显著危险信号",
    details: {
      inputs: {
        macroClosed: macro.closed,
        liquidityRed: liquidity.red,
        etfFiveDayRed: etf.fiveDayRed,
      },
      calc: {
        tripleHit: danger.tripleHit,
        riskWeight: danger.riskWeight,
      },
      rules: danger.tripleHit ? ["三连击直切 C"] : danger.riskSignals,
    },
  });

  const svc = evalSVC(safeInput);
  gates.push({
    id: "V6.2",
    name: "SVC 结构性价值捕获",
    status: svc.score >= 7 ? "open" : svc.score <= 3 ? "closed" : "warn",
    note: `结构分 ${formatNumber(svc.score, 1)}`,
    details: {
      inputs: {
        rsdScore: safeInput.rsdScore,
        lstcScore: safeInput.lstcScore,
        mappingRatioDown: safeInput.mappingRatioDown,
        netIssuanceHigh: safeInput.netIssuanceHigh,
      },
      calc: {
        score: formatNumber(svc.score, 2),
        betaCapShift: svc.betaCapShift,
        confidenceMultiplier: formatNumber(svc.confidenceMultiplier, 2),
      },
      rules: svc.redLights,
    },
  });

  const phase = evalPhase(safeInput);
  const be = evalBE(safeInput);
  const tri = evalTriDomain(safeInput);

  const reversalBoost =
    phase.label === "BTD→BTR"
      ? (leverage.notes.includes("诱空失败候选") ? 0.03 : 0) +
        (leverage.notes.includes("空头失败雷达") ? 0.03 : 0) -
        (leverage.notes.includes("反向钓鱼布局") ? 0.04 : 0)
      : 0;

  const bpi = evalBPI(safeInput, liquidity.score, supply, leverage);
  const baseScore = calculateStateBias(macro, liquidity, riskSwitch.riskOn, bpi, leverage, danger, safeInput);
  let state = deriveState(baseScore, macro, danger);
  state = applyStateCaps(state, macro);
  state = applyDriftDegrade(state, driftLevel);

  const bcm = evalBCM(safeInput, liquidity, macro, etf, phase);
  const hpm = evalHPM(state, phase, tri);
  gates.push({
    id: "V7",
    name: "买家阶段指标（BPI）",
    status: bpi.strength > 0.7 ? "open" : bpi.strength > 0.45 ? "warn" : "closed",
    note: `${bpi.label} / 强度 ${bpi.strengthText}`,
    details: {
      inputs: {
        etf5d: safeInput.etf5d,
        liquidityScore: formatNumber(liquidity.score, 2),
        sellWallThin: supply.sellWallThin,
        crowdingIndex: safeInput.crowdingIndex,
      },
      calc: {
        strength: bpi.strengthText,
        betaHint: bpi.betaHint,
      },
      rules: [bpi.label],
    },
  });

  gates.push({
    id: "V8",
    name: "牛熊条件矩阵（BCM）",
    status: bcm.bullScore >= 0.75 ? "open" : bcm.bearScore >= 0.75 ? "closed" : "warn",
    note: `牛 ${formatNumber(bcm.bullScore, 2)} / 熊 ${formatNumber(bcm.bearScore, 2)}`,
    details: {
      inputs: {
        macroClosed: macro.closed,
        liquidityScore: formatNumber(liquidity.score, 2),
        etf10d: safeInput.etf10d,
        phase: phase.label,
        liquidationUsd: safeInput.liquidationUsd,
      },
      calc: {
        bullScore: formatNumber(bcm.bullScore, 2),
        bearScore: formatNumber(bcm.bearScore, 2),
      },
      rules: bcm.conflicts.length ? bcm.conflicts.slice(0, 3) : ["无冲突项"],
    },
  });

  gates.push({
    id: "HPM",
    name: "历史相位映射器",
    status: "open",
    note: hpm,
    details: {
      inputs: {
        state,
        phase: phase.label,
        triAllow: tri.allow,
      },
      calc: {
        mapping: hpm,
      },
      rules: [],
    },
  });

  gates.push({
    id: "SC",
    name: "SC-Phase 相位判定",
    status: phase.label === "Late-Div" ? "warn" : "open",
    note: phase.note,
    details: {
      inputs: {
        trendMomentum: safeInput.trendMomentum,
        divergence: safeInput.divergence,
      },
      calc: {
        label: phase.label,
      },
      rules: [phase.note, `D-ATAF 偏向：${ataf.bias}`],
    },
  });

  gates.push({
    id: "BE",
    name: "相变判定",
    status: be.pass ? "open" : "warn",
    note: `势能 ${formatNumber(be.potential, 2)}`,
    details: {
      inputs: {
        cognitivePotential: safeInput.cognitivePotential,
        liquidityPotential: safeInput.liquidityPotential,
        onchainReflexivity: safeInput.onchainReflexivity,
        sentimentThreshold: safeInput.sentimentThreshold,
      },
      calc: {
        potential: formatNumber(be.potential, 3),
        pass: be.pass,
      },
      rules: be.pass ? ["相变候选通过"] : ["相变候选未通过"],
    },
  });

  gates.push({
    id: "3域",
    name: "三域扫描/ΔES",
    status: tri.allow ? "open" : "warn",
    note: `ΔES ${formatNumber(input.deltaES, 2)}`,
    details: {
      inputs: {
        topo: safeInput.topo,
        spectral: safeInput.spectral,
        roughPath: safeInput.roughPath,
        deltaES: safeInput.deltaES,
      },
      calc: {
        allow: tri.allow,
      },
      rules: tri.allow ? ["三域同意"] : ["三域未达标"],
    },
  });

  const betaCapBase = state === "A" ? 0.9 : state === "B" ? 0.6 : 0.35;
  const betaCap = clamp(betaCapBase + svc.betaCapShift * 0.1, 0.2, 1);

  const penalties = {
    third: macro.closed && safeInput.etf10d <= 0 ? true : leverage.betaPenaltyThird,
    half: leverage.betaPenaltyHalf,
    extra: Boolean(safeInput.prevEtfExtremeOutflow),
  };
  const betaRaw = computeBeta(state, penalties, betaCap);
  let beta = clamp(Math.min(betaRaw * driftMultiplier, betaCap), 0, 1);

  const distributionBoost =
    safeInput.distributionGateCount >= 2 ? 0.03 * (safeInput.distributionGateCount - 1) : 0;
  let confidence = 0.52;
  confidence += riskSwitch.riskOn ? 0.08 : 0;
  confidence += etf.breakoutValidated ? 0.05 : -0.02;
  confidence += macro.closed ? -0.08 : 0;
  confidence += danger.riskWeight ? -0.04 : 0;
  confidence = clamp(confidence * svc.confidenceMultiplier + distributionBoost + reversalBoost, 0.2, 0.95);

  const previousBeta = Number.isFinite(runtimeSafe.previousBeta) ? runtimeSafe.previousBeta : beta;
  const turnover = Math.abs(beta - previousBeta);
  const expectedCostPct = (turnover * executionCostBps) / 100;
  const edgePct = Math.max(0.02, Math.max(0, confidence - 0.5) * 1.6);
  const costPressure = expectedCostPct / edgePct;
  let executionLevel = "ok";
  let executionMultiplier = 1;
  if (costPressure >= 0.7) {
    executionLevel = "high";
    executionMultiplier = 0.82;
  } else if (costPressure >= 0.45) {
    executionLevel = "medium";
    executionMultiplier = 0.9;
  }
  beta = clamp(Math.min(beta * executionMultiplier, betaCap), 0, 1);

  const extremeAllowed =
    be.pass &&
    tri.allow &&
    svc.score >= 7 &&
    !macro.closed &&
    !danger.tripleHit &&
    safeInput.deltaES <= 0.6 &&
    driftLevel === "ok" &&
    executionLevel === "ok";

  const hedge = state === "C" || danger.tripleHit || driftLevel === "danger";

  gates.push({
    id: "DG",
    name: "TradFi 分发闸门",
    status: safeInput.distributionGateCount >= 2 ? "open" : "warn",
    note: `30D 命中 ${safeInput.distributionGateCount} 家`,
    details: {
      inputs: {
        distributionGateCount: safeInput.distributionGateCount,
      },
      calc: {
        confidenceBoost: formatNumber(distributionBoost, 3),
      },
      rules: safeInput.distributionGateCount >= 2 ? ["置信度加成"] : ["未达门槛"],
    },
  });

  gates.push({
    id: "QG",
    name: "预测质量/漂移门",
    status: driftLevel === "danger" ? "closed" : driftLevel === "warn" ? "warn" : "open",
    note: driftNote,
    details: {
      inputs: {
        asOfDate: runtimeSafe.asOfDate || null,
        horizon: Number.isFinite(driftInput.horizon) ? driftInput.horizon : 7,
        sampleSize: driftSampleSize,
        accuracy: driftAccuracy !== null ? formatNumber(driftAccuracy * 100, 2) : null,
      },
      calc: {
        level: driftLevel,
        baseline: driftBaseline !== null ? formatNumber(driftBaseline * 100, 2) : null,
        betaMultiplier: formatNumber(driftMultiplier, 2),
      },
      rules: [driftNote],
    },
  });

  const reasons = [];
  if (macro.closed) reasons.push({ text: "宏观紧缩关门", weight: 9, gateId: "G0" });
  if (macro.forceC) reasons.push({ text: "宏观多信号共振", weight: 10, gateId: "G0" });
  if (liquidity.red) reasons.push({ text: "流动性缺血红灯", weight: 8, gateId: "V1" });
  if (etf.fiveDayRed) reasons.push({ text: "ETF 5D 负流红灯", weight: 8, gateId: "V5" });
  if (leverage.betaPenaltyHalf) reasons.push({ text: "清算超阈值，需降 β", weight: 9, gateId: "V3" });
  if (leverage.betaPenaltyThird)
    reasons.push({ text: "杠杆拥挤 + ETF 弱势", weight: 7, gateId: "V3" });
  if (svc.score >= 7) reasons.push({ text: "SVC 结构强势加成", weight: 6, gateId: "V6.2" });
  if (svc.score <= 3) reasons.push({ text: "SVC 结构偏弱", weight: 6, gateId: "V6.2" });
  if (etf.breakoutValidated) reasons.push({ text: "突破验证通过", weight: 5, gateId: "V5" });
  if (!etf.breakoutValidated) reasons.push({ text: "突破未验证", weight: 4, gateId: "V5" });
  if (safeInput.distributionGateCount >= 2) {
    reasons.push({ text: "TradFi 分发闸门打开", weight: 5, gateId: "DG" });
  }
  if (driftLevel === "warn") {
    reasons.push({ text: "预测质量漂移，温和降级", weight: 6, gateId: "QG" });
  }
  if (driftLevel === "danger") {
    reasons.push({ text: "预测质量高漂移，强制降级", weight: 9, gateId: "QG" });
  }
  if (executionLevel === "medium") {
    reasons.push({ text: "交易摩擦偏高，压低 β", weight: 5, gateId: "ACT" });
  }
  if (executionLevel === "high") {
    reasons.push({ text: "交易成本过高，显著压低 β", weight: 7, gateId: "ACT" });
  }

  const reasonsTop3 = reasons
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((item) => ({ text: item.text, gateId: item.gateId }));

  const riskNotesList = [
    ...danger.riskSignals,
    ...svc.redLights.map((text) => `结构红灯：${text}`),
    etf.breakoutNote,
    `漂移门：${driftNote}`,
    `执行成本：${executionLevel.toUpperCase()}（换手 ${formatNumber(turnover, 2)} / 成本 ${formatNumber(
      expectedCostPct,
      3
    )}%）`,
    `BPI：${bpi.label}（强度 ${bpi.strengthText} / 建议 ${bpi.betaHint}）`,
    `BCM：牛 ${formatNumber(bcm.bullScore, 2)} / 熊 ${formatNumber(bcm.bearScore, 2)}`,
    bcm.conflicts.length ? `冲突：${bcm.conflicts.join(" / ")}` : "冲突：无",
    `HPM：${hpm}`,
    `D-ATAF 偏向：${ataf.bias}`,
  ];

  gates.forEach((gate) => {
    if (!gate.details || !gate.details.inputs) return;
    const sources = {};
    const timings = {};
    const observedAtMap = safeInput.__fieldObservedAt || {};
    const fetchedAtMap = safeInput.__fieldFetchedAt || {};
    const freshnessMap = safeInput.__fieldFreshness || {};
    Object.keys(gate.details.inputs).forEach((key) => {
      sources[key] = sourceMap[key] || "Derived";
      timings[key] = {
        observedAt: observedAtMap[key] || safeInput.__generatedAt || null,
        fetchedAt: fetchedAtMap[key] || safeInput.__generatedAt || null,
        freshness: freshnessMap[key] || null,
      };
    });
    gate.details.sources = sources;
    gate.details.timings = timings;
  });

  return {
    state,
    beta,
    betaRaw,
    betaCap,
    hedge,
    phaseLabel: phase.label,
    confidence,
    extremeAllowed,
    distributionGate: safeInput.distributionGateCount,
    modelRisk: {
      level: driftLevel,
      note: driftNote,
      accuracy: driftAccuracy,
      baseline: driftBaseline,
      sampleSize: driftSampleSize,
      betaMultiplier: driftMultiplier,
    },
    execution: {
      level: executionLevel,
      previousBeta,
      turnover,
      costBps: executionCostBps,
      expectedCostPct,
      edgePct,
      costPressure,
      betaMultiplier: executionMultiplier,
    },
    reasonsTop3,
    riskNotes: riskNotesList,
    gates: [
      ...gates,
      {
        id: "ACT",
        name: "最终动作映射",
        status: state === "C" ? "closed" : state === "B" ? "warn" : "open",
        note: `${state} / β ${formatNumber(beta, 2)} / β_cap ${formatNumber(betaCap, 2)}`,
        details: {
          inputs: {
            state,
            betaBase: state === "A" ? 0.75 : state === "B" ? 0.45 : 0.2,
            penalties,
            betaCap: formatNumber(betaCap, 2),
            previousBeta: formatNumber(previousBeta, 2),
            costBps: executionCostBps,
          },
          calc: {
            betaRaw: formatNumber(betaRaw, 2),
            beta: formatNumber(beta, 2),
            hedge,
            extremeAllowed,
            confidence: formatNumber(confidence, 2),
            turnover: formatNumber(turnover, 2),
            expectedCostPct: formatNumber(expectedCostPct, 3),
            executionLevel,
          },
          rules: ["对冲 SOP", "β 上限修正", "极限重仓许可链", "交易成本约束", "漂移降级"],
        },
      },
    ],
    fofScore: liquidity.score,
  };
}
