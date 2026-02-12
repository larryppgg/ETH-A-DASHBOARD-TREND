import { resolveHalfLifeDays } from "../inputPolicy.js";

const WINDOW_OVERRIDES = {
  dxy5d: [5, 21],
  dxy3dUp: [5, 21],
  us2yWeekBp: [7, 30],
  fciUpWeeks: [30, 90],
  etf1d: [3, 10],
  etf5d: [7, 21],
  etf10d: [10, 30],
  stablecoin30d: [30, 90],
  exchStableDelta: [7, 30],
  exchBalanceTrend: [14, 45],
  liquidationUsd: [3, 14],
  crowdingIndex: [7, 30],
  longWicks: [7, 21],
  reverseFishing: [7, 21],
  shortFailure: [7, 21],
  mcapGrowth: [7, 30],
  mcapElasticity: [7, 30],
  floatDensity: [30, 90],
  rsdScore: [30, 90],
  mappingRatioDown: [30, 90],
  lstcScore: [14, 60],
  netIssuanceHigh: [14, 60],
  trendMomentum: [7, 30],
  divergence: [7, 30],
  topo: [14, 45],
  spectral: [14, 45],
  roughPath: [14, 45],
  deltaES: [7, 30],
  rrpChange: [14, 45],
  tgaChange: [14, 45],
  srfChange: [14, 45],
  ism: [45, 120],
  distributionGateCount: [30, 90],
  ethSpotPrice: [7, 30],
  cexTvl: [14, 45],
};

function parseIsoDate(dateKey) {
  if (!dateKey || typeof dateKey !== "string") return null;
  const dt = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toIsoDate(dt) {
  if (!(dt instanceof Date)) return null;
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function diffDays(later, earlier) {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86400000));
}

function buildFieldSeries(history, currentDate, key) {
  const current = parseIsoDate(currentDate);
  if (!Array.isArray(history) || !current) return [];
  return history
    .filter((record) => record?.date && parseIsoDate(record.date))
    .filter((record) => {
      const dt = parseIsoDate(record.date);
      return dt && dt.getTime() <= current.getTime();
    })
    .map((record) => ({ date: record.date, value: record?.input?.[key] }))
    .filter((item) => item.value !== null && item.value !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function resolveWindows(key) {
  const override = WINDOW_OVERRIDES[key];
  if (override) return override;
  const hl = resolveHalfLifeDays(key);
  const shortWindow = Math.max(3, Math.round(hl));
  const longWindow = Math.max(shortWindow + 3, Math.round(hl * 3));
  return [shortWindow, longWindow];
}

function pickBaselineByWindow(series, currentDate, windowDays) {
  const current = parseIsoDate(currentDate);
  if (!current || series.length < 2) return null;
  const cutoff = new Date(current.getTime() - windowDays * 86400000);
  for (let idx = series.length - 2; idx >= 0; idx -= 1) {
    const item = series[idx];
    const dt = parseIsoDate(item.date);
    if (dt && dt.getTime() <= cutoff.getTime()) {
      return item;
    }
  }
  return series[0];
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function directionFromDelta(delta, epsilon = 1e-9) {
  if (!Number.isFinite(delta) || Math.abs(delta) <= epsilon) return "flat";
  return delta > 0 ? "up" : "down";
}

function buildNumericTrend(series, currentDate, key) {
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const windows = resolveWindows(key);
  let baseline = null;
  let usedWindow = windows[0];
  for (const windowDays of windows) {
    const candidate = pickBaselineByWindow(series, currentDate, windowDays);
    if (candidate && candidate.date !== latest.date) {
      baseline = candidate;
      usedWindow = windowDays;
      break;
    }
  }
  if (!baseline || baseline.date === latest.date) return null;

  const currentValue = Number(latest.value);
  const baselineValue = Number(baseline.value);
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) return null;
  const delta = currentValue - baselineValue;
  const pct = Math.abs(baselineValue) > 1e-9 ? (delta / Math.abs(baselineValue)) * 100 : null;
  const dir = directionFromDelta(delta, 1e-8);
  const baselineDt = parseIsoDate(baseline.date);
  const currentDt = parseIsoDate(latest.date);
  const actualDays = baselineDt && currentDt ? diffDays(currentDt, baselineDt) : usedWindow;
  const seriesValues = series.map((item) => Number(item.value)).filter((v) => Number.isFinite(v));

  let text = `趋势 ${actualDays}D：`;
  if (dir === "flat") {
    text += "基本持平";
  } else if (pct === null || !Number.isFinite(pct)) {
    text += `${dir === "up" ? "上行" : "下行"} ${formatSigned(delta, 4)}`;
  } else {
    text += `${dir === "up" ? "上行" : "下行"} ${formatSigned(pct, 2)}%`;
  }
  text += `（基准 ${baseline.date}）`;

  return {
    kind: "number",
    key,
    direction: dir,
    windowDays: usedWindow,
    actualDays,
    currentDate: latest.date,
    baselineDate: baseline.date,
    baselineValue,
    currentValue,
    delta,
    deltaPct: pct,
    sampleCount: series.length,
    text,
    series: seriesValues.slice(-24),
  };
}

function buildBooleanTrend(series, currentDate, key) {
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const latestValue = Boolean(latest.value);
  const [windowDays] = resolveWindows(key);
  const baseline = pickBaselineByWindow(series, currentDate, windowDays);
  if (!baseline) return null;

  const baselineValue = Boolean(baseline.value);
  const baselineDt = parseIsoDate(baseline.date);
  const currentDt = parseIsoDate(latest.date);
  const actualDays = baselineDt && currentDt ? diffDays(currentDt, baselineDt) : windowDays;
  const startIdx = series.findIndex((item) => item.date === baseline.date);
  const windowSeries = (startIdx >= 0 ? series.slice(startIdx) : series).map((item) => Boolean(item.value));
  let flips = 0;
  for (let idx = 1; idx < windowSeries.length; idx += 1) {
    if (windowSeries[idx] !== windowSeries[idx - 1]) flips += 1;
  }
  const trueCount = windowSeries.filter(Boolean).length;
  const ratio = windowSeries.length ? (trueCount / windowSeries.length) * 100 : 0;
  const changed = baselineValue !== latestValue;
  const text = changed
    ? `趋势 ${actualDays}D：${baselineValue ? "是" : "否"}→${latestValue ? "是" : "否"}（翻转 ${flips} 次）`
    : `趋势 ${actualDays}D：保持${latestValue ? "是" : "否"}（触发占比 ${ratio.toFixed(0)}%）`;

  return {
    kind: "boolean",
    key,
    direction: changed ? "flip" : latestValue ? "up" : "down",
    windowDays,
    actualDays,
    currentDate: latest.date,
    baselineDate: baseline.date,
    baselineValue,
    currentValue: latestValue,
    flips,
    ratio,
    sampleCount: series.length,
    text,
    series: windowSeries.slice(-24).map((value) => (value ? 1 : 0)),
  };
}

export function deriveFieldTrend(history, currentDate, key) {
  const series = buildFieldSeries(history, currentDate, key);
  if (series.length < 2) {
    return {
      kind: "none",
      key,
      sampleCount: series.length,
      text: "趋势样本不足",
      series: [],
      direction: "flat",
    };
  }
  const latestValue = series[series.length - 1].value;
  if (typeof latestValue === "number" && Number.isFinite(latestValue)) {
    return (
      buildNumericTrend(series, currentDate, key) || {
        kind: "none",
        key,
        sampleCount: series.length,
        text: "趋势样本不足",
        series: [],
        direction: "flat",
      }
    );
  }
  if (typeof latestValue === "boolean") {
    return (
      buildBooleanTrend(series, currentDate, key) || {
        kind: "none",
        key,
        sampleCount: series.length,
        text: "趋势样本不足",
        series: [],
        direction: "flat",
      }
    );
  }
  return {
    kind: "none",
    key,
    sampleCount: series.length,
    text: "趋势不适用",
    series: [],
    direction: "flat",
  };
}

export function buildFieldTrendMap(history, currentDate, keys) {
  const map = {};
  (keys || []).forEach((key) => {
    map[key] = deriveFieldTrend(history, currentDate, key);
  });
  return map;
}

export function summarizeTrendForPrompt(trend) {
  if (!trend || trend.kind === "none") return "趋势样本不足";
  if (trend.kind === "number") {
    const move = Number.isFinite(trend.deltaPct)
      ? `${formatSigned(trend.deltaPct, 2)}%`
      : formatSigned(trend.delta, 4);
    return `${trend.actualDays || trend.windowDays}D ${trend.direction === "up" ? "上行" : trend.direction === "down" ? "下行" : "持平"} ${move}（基准 ${trend.baselineDate || "--"}）`;
  }
  if (trend.kind === "boolean") {
    return `${trend.actualDays || trend.windowDays}D ${trend.text}`;
  }
  return trend.text || "趋势样本不足";
}

export function toDateKey(value) {
  const parsed = parseIsoDate(value);
  return toIsoDate(parsed);
}
