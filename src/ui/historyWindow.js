export function buildDateWindow(today = new Date(), days = 365) {
  const result = [];
  const base = today instanceof Date ? new Date(today.getTime()) : new Date(today);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(key);
  }
  return { dates: result, latest: result[result.length - 1] || null };
}
