export function evalSupply(input) {
  const sellWallThin = input.exchBalanceTrend < -0.3;
  const floatThin = input.floatDensity < 0.35;
  const mcapElasticityHigh = input.mcapElasticity > 0.75;
  const bubbleWarning = mcapElasticityHigh && input.mcapGrowth > 0.4 && input.exchBalanceTrend > -0.1;
  const notes = [];
  if (sellWallThin) notes.push("卖墙变薄");
  if (floatThin) notes.push("浮筹稀薄");
  if (mcapElasticityHigh) notes.push("市值-价格弹性偏高");
  if (bubbleWarning) notes.push("泡沫结构预警");
  return { sellWallThin, floatThin, mcapElasticityHigh, bubbleWarning, notes };
}
