export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

export function formatSigned(value, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, digits)}`;
}

export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalize(value, min, max) {
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}
