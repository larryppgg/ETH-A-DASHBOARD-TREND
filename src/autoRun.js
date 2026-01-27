export function shouldAutoRun(history, todayKey) {
  if (!history || !history.length) return true;
  const latest = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest.date !== todayKey;
}
