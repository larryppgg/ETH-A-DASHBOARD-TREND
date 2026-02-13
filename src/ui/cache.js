const historyCacheKey = "eth_a_dashboard_history_cache";
const historyCacheTTL = 1000 * 60 * 60 * 24 * 30;

export function cacheHistory(history) {
  const payload = {
    savedAt: Date.now(),
    history,
  };
  try {
    localStorage.setItem(historyCacheKey, JSON.stringify(payload));
  } catch {
    // History seeds can be large (365d backfill). Don't let quota errors break boot.
  }
}

export function loadCachedHistory() {
  const raw = localStorage.getItem(historyCacheKey);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload.savedAt || !payload.history) return null;
    if (Date.now() - payload.savedAt > historyCacheTTL) return null;
    return payload.history;
  } catch {
    return null;
  }
}

export function resetCachedHistory() {
  try {
    localStorage.removeItem(historyCacheKey);
  } catch {
    // ignore
  }
}
