import { normalize } from "../../utils.js";

export function evalLiquidity(input) {
  const etfScore = normalize(input.etf10d, -800, 800);
  const supplyScore = normalize(input.stablecoin30d, -8, 8);
  const exchScore = normalize(input.exchStableDelta, -6, 6);
  const score = 0.4 * etfScore + 0.35 * supplyScore + 0.25 * exchScore;
  const red = score < 35;
  const label = red ? "缺血" : score < 50 ? "偏紧" : "正常";
  return { score, red, label };
}
