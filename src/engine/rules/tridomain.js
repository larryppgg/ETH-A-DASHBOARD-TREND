export function evalTriDomain(input) {
  const allow = input.topo > 0.6 && input.spectral > 0.6 && input.roughPath > 0.6 && input.deltaES <= 0.6;
  return { allow };
}
