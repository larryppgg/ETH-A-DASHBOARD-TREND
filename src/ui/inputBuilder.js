export function buildCombinedInput(payload, templateInput) {
  if (!payload) return null;
  const combined = {
    ...(templateInput || {}),
    ...(payload.data || {}),
    __sources: payload.sources || {},
    __fieldObservedAt: payload.fieldObservedAt || {},
    __fieldFetchedAt: payload.fieldFetchedAt || {},
    __fieldUpdatedAt: payload.fieldUpdatedAt || {},
    __missing: payload.missing || [],
    __errors: payload.errors || [],
    __generatedAt: payload.generatedAt,
    __targetDate: payload.targetDate,
  };
  return combined;
}

export function refreshMissingFields(input, schemaKeys = []) {
  if (!input || !Array.isArray(schemaKeys)) return [];
  const missing = schemaKeys.filter((key) => input[key] === null || input[key] === undefined);
  input.__missing = missing;
  return missing;
}
