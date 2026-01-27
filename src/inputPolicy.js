export function hasNullFields(input, keys) {
  return keys.some((key) => input[key] === null || input[key] === undefined);
}

export function needsAutoFetch(input, keys) {
  if (!input) return true;
  if (!input.__sources) return true;
  if (keys.some((key) => !(key in input))) return true;
  return hasNullFields(input, keys);
}
