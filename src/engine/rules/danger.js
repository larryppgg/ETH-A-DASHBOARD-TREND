export function evalDanger(macro, liquidity, etf, supply) {
  const tripleHit = macro.closed && liquidity.red && etf.fiveDayRed;
  const riskSignals = [];
  if (supply.bubbleWarning) riskSignals.push("市值虚高泡沫结构");
  if (supply.floatThin) riskSignals.push("极端敏感结构");
  if (liquidity.red) riskSignals.push("流动性缺血");
  const riskWeight = riskSignals.length;
  return { tripleHit, riskSignals, riskWeight };
}
