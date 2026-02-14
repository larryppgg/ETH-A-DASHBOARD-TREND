const ALLOWED_TABS = new Set(["decision", "explain", "audit", "data"]);

export function parseDeepLink(search = "", hash = "") {
  const rawSearch = typeof search === "string" ? search : "";
  const rawHash = typeof hash === "string" ? hash : "";
  const params = new URLSearchParams(rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch);
  const dateParam = (params.get("date") || "").trim();
  const tabParam = (params.get("tab") || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const tab = ALLOWED_TABS.has(tabParam) ? tabParam : null;
  const normalizedHash = rawHash && rawHash.startsWith("#") ? rawHash : "";
  return { date, tab, hash: normalizedHash };
}

