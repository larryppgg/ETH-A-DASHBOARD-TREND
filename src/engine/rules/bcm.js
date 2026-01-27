export function evalBCM(input, liquidity, macro, etf, phase) {
  const bullConditions = [
    !macro.closed,
    liquidity.score > 50,
    input.etf10d > 0,
    phase.label === "Up-Mid",
  ];
  const bearConditions = [
    macro.closed,
    etf.fiveDayRed,
    liquidity.red,
    input.liquidationUsd > 1_000_000_000,
  ];
  const bullScore = bullConditions.filter(Boolean).length / bullConditions.length;
  const bearScore = bearConditions.filter(Boolean).length / bearConditions.length;
  const conflicts = [];
  if (bullScore > 0.5 && bearScore > 0.5) conflicts.push("多空条件同时偏强");
  if (macro.closed && input.etf10d > 0) conflicts.push("宏观关门但买墙仍在");
  if (!macro.closed && etf.fiveDayRed) conflicts.push("宏观开门但 ETF 负流");
  if (liquidity.red && input.etf10d > 0) conflicts.push("流动性缺血但 ETF 仍正流");
  if (input.liquidationUsd > 1_000_000_000 && bullScore > 0.5) conflicts.push("清算极值与多头信号冲突");
  return { bullScore, bearScore, conflicts };
}
