import { clamp } from "../../utils.js";

export function evalSVC(input) {
  const score = (input.rsdScore + input.lstcScore) / 2;
  const betaCapShift = score >= 7 ? 1 : score <= 3 ? -1 : 0;
  const confidenceMultiplier = clamp(0.85 + score / 20, 0.85, 1.15);
  const redLights = [];
  if (input.mappingRatioDown) redLights.push("映射/分发比走坏");
  if (input.netIssuanceHigh) redLights.push("净通胀偏高且费用低位");
  return { score, betaCapShift, confidenceMultiplier, redLights };
}
