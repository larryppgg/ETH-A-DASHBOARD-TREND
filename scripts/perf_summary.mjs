import { computePredictionEvaluation, deriveDriftSignal } from "../src/ui/eval.js";

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pickAsOfDate(history, fallback = null) {
  if (isIsoDate(fallback)) return fallback;
  const sorted = [...(history || [])].filter((r) => r?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return sorted.length ? sorted[sorted.length - 1].date : null;
}

export function buildPerfSummary(history = [], options = {}) {
  const horizons = Array.isArray(options.horizons) && options.horizons.length ? options.horizons : [7, 14];
  const thresholds = options.thresholds || { 7: 5, 14: 8 };
  const toleranceDays = Number.isFinite(options.toleranceDays) ? options.toleranceDays : 2;
  const priceByDate = options.priceByDate && typeof options.priceByDate === "object" ? options.priceByDate : null;
  const asOfDate = pickAsOfDate(history, options.asOfDate);

  const evaluation = computePredictionEvaluation(history, { horizons, thresholds, toleranceDays, asOfDate, priceByDate });
  const horizonKeys = horizons.map((h) => String(h));
  const maturedRows = evaluation.rows.filter((row) => horizonKeys.some((key) => row.horizons[key]?.hit !== null));
  const pendingRows = evaluation.rows.filter((row) => !horizonKeys.some((key) => row.horizons[key]?.hit !== null));

  const drift7 = deriveDriftSignal(history, {
    horizon: 7,
    asOfDate,
    thresholds,
    toleranceDays,
    priceByDate,
  });
  const drift14 = horizons.includes(14)
    ? deriveDriftSignal(history, { horizon: 14, asOfDate, thresholds, toleranceDays, priceByDate })
    : null;

  const recent = maturedRows.slice(-20).reverse().map((row) => {
    const horizonsOut = {};
    horizonKeys.forEach((key) => {
      const cell = row.horizons[key] || {};
      horizonsOut[key] = {
        verdict: cell.verdict || "pending",
        returnPct: typeof cell.returnPct === "number" ? cell.returnPct : null,
        futureDate: cell.futureDate || null,
      };
    });
    return {
      date: row.date,
      state: row.state,
      expectation: row.expectation,
      price: row.price ?? null,
      horizons: horizonsOut,
    };
  });

  const total = evaluation.rows.length;
  const matured = maturedRows.length;
  const pending = pendingRows.length;

  return {
    generatedAt: new Date().toISOString(),
    asOfDate,
    maturity: {
      total,
      matured,
      pending,
      ratio: total ? matured / total : 0,
    },
    byHorizon: evaluation.summary.byHorizon || {},
    drift: {
      "7": drift7,
      "14": drift14,
    },
    recent,
  };
}

