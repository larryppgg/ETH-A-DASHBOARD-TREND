import { clamp, formatNumber } from "../../utils.js";

export function evalBPI(input, liquidityScore, supply, leverage) {
  const buyWall = ((input.etf5d + 600) / 1200) * 100;
  const supplyScore = supply.sellWallThin ? 65 : 45;
  const leverageHealth = leverage.highCrowding ? 35 : 60;
  const strength = clamp((buyWall + liquidityScore + supplyScore + leverageHealth) / 400, 0, 1);
  let label = "买家缺席";
  if (strength > 0.7) label = "买家主导";
  else if (strength > 0.45) label = "买家试探";
  const betaHint = strength > 0.7 ? "A" : strength > 0.45 ? "B" : "C";
  return { strength, label, betaHint, strengthText: formatNumber(strength, 2) };
}
