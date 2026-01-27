export function evalETF(input) {
  const fiveDayRed = input.etf5d <= -400;
  const extremeOutflow = input.etf1d <= -180;
  const breakoutValidated = (input.etf1d > 0 || input.etf5d > 0) && input.volumeConfirm;
  const breakoutNote = breakoutValidated ? "突破验证通过" : "突破未验证/可能死猫反弹";
  return { fiveDayRed, extremeOutflow, breakoutValidated, breakoutNote };
}
