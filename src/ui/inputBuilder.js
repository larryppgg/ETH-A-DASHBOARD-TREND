export function buildCombinedInput(payload, templateInput) {
  if (!payload) return null;
  const combined = {
    ...(templateInput || {}),
    ...(payload.data || {}),
    __sources: payload.sources || {},
    __missing: payload.missing || [],
    __errors: payload.errors || [],
    __generatedAt: payload.generatedAt,
    __targetDate: payload.targetDate,
  };
  return combined;
}
