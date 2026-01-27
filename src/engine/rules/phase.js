export function evalPhase(input) {
  if (input.trendMomentum > 0.65 && input.divergence < 0.45) {
    return { label: "Up-Mid", note: "趋势稳定推进" };
  }
  if (input.divergence > 0.65) {
    return { label: "Late-Div", note: "背离扩散阶段" };
  }
  return { label: "BTD→BTR", note: "反转确认候选" };
}
