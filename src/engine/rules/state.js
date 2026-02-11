import { clamp } from "../../utils.js";

export function calculateStateBias(macro, liquidity, riskOn, bpi, leverage, danger, input) {
  let score = 50;
  score += (liquidity.score - 50) * 0.35;
  score += input.etf10d > 0 ? 8 : -8;
  score += riskOn ? 10 : 0;
  score += (bpi.strength - 0.5) * 25;
  score -= macro.closed ? 12 : 0;
  score -= leverage.betaPenaltyHalf ? 10 : 0;
  score -= danger.riskWeight * 6;
  return clamp(score, 0, 100);
}

export function deriveState(baseScore, macro, danger) {
  if (macro.forceC || danger.tripleHit) return "C";
  if (baseScore >= 65) return "A";
  if (baseScore <= 35) return "C";
  return "B";
}

export function applyStateCaps(state, macro) {
  if (macro.closed && state === "A") {
    return "B";
  }
  return state;
}

export function applyDriftDegrade(state, driftLevel = "ok") {
  if (driftLevel === "danger") {
    if (state === "A") return "B";
    if (state === "B") return "C";
    return "C";
  }
  if (driftLevel === "warn" && state === "A") {
    return "B";
  }
  return state;
}

export function computeBeta(state, penalties, betaCap) {
  const base = state === "A" ? 0.75 : state === "B" ? 0.45 : 0.2;
  let value = base;
  if (penalties.third) value *= 0.67;
  if (penalties.half) value *= 0.5;
  if (penalties.extra) value *= 0.8;
  return clamp(Math.min(value, betaCap), 0, 1);
}
