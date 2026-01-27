export function buildTimelineIndex(history = []) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const dates = sorted.map((item) => item.date);
  const map = new Map(sorted.map((item) => [item.date, item]));
  return {
    dates,
    map,
    latestDate: dates[dates.length - 1] || null,
    earliestDate: dates[0] || null,
  };
}

export function pickRecordByDate(history = [], date) {
  if (!date) return null;
  return history.find((item) => item.date === date) || null;
}

export function nearestDate(dates = [], targetDate) {
  if (!dates.length || !targetDate) return null;
  const target = new Date(targetDate).getTime();
  let best = dates[0];
  let bestDelta = Math.abs(new Date(best).getTime() - target);
  for (const date of dates) {
    const delta = Math.abs(new Date(date).getTime() - target);
    if (delta < bestDelta) {
      best = date;
      bestDelta = delta;
    }
  }
  return best;
}

export function buildSeries(history = [], accessor) {
  return [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      date: item.date,
      value: typeof accessor === "function" ? accessor(item) : null,
    }));
}
