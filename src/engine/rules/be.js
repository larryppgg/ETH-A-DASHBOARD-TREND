export function evalBE(input) {
  const potential = input.cognitivePotential * input.liquidityPotential * input.onchainReflexivity;
  const pass = potential > input.sentimentThreshold;
  return { potential, pass };
}
