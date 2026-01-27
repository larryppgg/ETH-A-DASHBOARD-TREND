export function evalMacro(input) {
  const triggers = [];
  if (input.dxy5d >= 1 || input.dxy3dUp) {
    triggers.push("DXY 走强");
  }
  if (input.us2yWeekBp >= 10) {
    triggers.push("2Y 收益率上行");
  }
  if (input.fciUpWeeks >= 2) {
    triggers.push("FCI 连续上行");
  }
  const closed = triggers.length >= 1;
  const forceC = triggers.length >= 2;
  return { closed, forceC, triggers };
}
