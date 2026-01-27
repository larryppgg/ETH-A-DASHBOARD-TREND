export function evalRiskOn(input) {
  if (!input.policyWindow) {
    return { riskOn: false, note: "观察外" };
  }
  const riskOn = input.current2y < input.preMeeting2y && input.currentDxy < input.preMeetingDxy;
  return { riskOn, note: riskOn ? "Risk-ON" : "未确认" };
}
