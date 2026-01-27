export function evalATAF(input) {
  const tighteningSignals = [];
  const easingSignals = [];

  if (input.rrpChange > 0) tighteningSignals.push("RRP 回收增强");
  if (input.tgaChange > 0) tighteningSignals.push("TGA 回笼增强");
  if (input.us2yWeekBp >= 10) tighteningSignals.push("2Y 上行");
  if (input.dxy5d >= 1 || input.dxy3dUp) tighteningSignals.push("DXY 偏强");
  if (input.fciUpWeeks >= 2) tighteningSignals.push("FCI 上行");

  if (input.srfChange > 0) easingSignals.push("SRF 释放增强");
  if (input.ism >= 50) easingSignals.push("ISM 扩张区间");

  const bias =
    tighteningSignals.length > easingSignals.length + 1
      ? "偏紧"
      : easingSignals.length > tighteningSignals.length + 1
        ? "偏松"
        : "中性";

  return {
    bias,
    tighteningSignals,
    easingSignals,
  };
}
