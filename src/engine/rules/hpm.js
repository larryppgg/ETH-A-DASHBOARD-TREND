export function evalHPM(state, phase, tri) {
  if (state === "C" && phase.label === "Late-Div") {
    return "历史防御区间";
  }
  if (state === "A" && tri.allow) {
    return "历史强势加速区间";
  }
  if (state === "B" && phase.label === "BTD→BTR") {
    return "历史反转孕育区";
  }
  return "历史过渡区间";
}
