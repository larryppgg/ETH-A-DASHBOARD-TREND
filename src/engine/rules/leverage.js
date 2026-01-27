export function evalLeverage(input, etf10d) {
  const highCrowding = input.crowdingIndex >= 80;
  const betaPenaltyThird = highCrowding && etf10d <= 0;
  const betaPenaltyHalf = input.liquidationUsd > 1_000_000_000;
  const notes = [];
  if (input.longWicks) {
    notes.push("诱空失败候选");
  }
  if (input.reverseFishing) {
    notes.push("反向钓鱼布局");
  }
  if (input.shortFailure) {
    notes.push("空头失败雷达");
  }
  return {
    highCrowding,
    betaPenaltyThird,
    betaPenaltyHalf,
    notes,
  };
}
