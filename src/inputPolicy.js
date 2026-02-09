export function hasNullFields(input, keys) {
  return keys.some((key) => input[key] === null || input[key] === undefined);
}

export function needsAutoFetch(input, keys) {
  if (!input) return true;
  if (!input.__sources) return true;
  if (keys.some((key) => !(key in input))) return true;
  return hasNullFields(input, keys);
}

const HALF_LIFE_DAYS = {
  dxy5d: 3,
  dxy3dUp: 3,
  us2yWeekBp: 3,
  fciUpWeeks: 14,
  etf1d: 2,
  etf5d: 4,
  etf10d: 7,
  stablecoin30d: 10,
  exchStableDelta: 5,
  exchBalanceTrend: 7,
  liquidationUsd: 2,
  crowdingIndex: 4,
  longWicks: 4,
  reverseFishing: 4,
  shortFailure: 4,
  mcapGrowth: 4,
  mcapElasticity: 5,
  floatDensity: 30,
  rsdScore: 20,
  mappingRatioDown: 20,
  lstcScore: 14,
  netIssuanceHigh: 14,
  trendMomentum: 3,
  divergence: 3,
  topo: 5,
  spectral: 5,
  roughPath: 5,
  deltaES: 3,
  rrpChange: 5,
  tgaChange: 5,
  srfChange: 7,
  ism: 45,
  distributionGateCount: 30,
  ethSpotPrice: 2,
};

function parseDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T23:59:59Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function observedAtFromRecord(record, key) {
  const input = record?.input || {};
  return (
    input.__fieldObservedAt?.[key] ||
    input.__fieldUpdatedAt?.[key] ||
    input.__generatedAt ||
    (record?.date ? `${record.date}T23:59:59Z` : null)
  );
}

function fetchedAtFromRecord(record, key) {
  const input = record?.input || {};
  return input.__fieldFetchedAt?.[key] || input.__generatedAt || observedAtFromRecord(record, key);
}

export function resolveHalfLifeDays(key) {
  return HALF_LIFE_DAYS[key] || 7;
}

export function classifyFieldFreshness(observedAt, asOfDate, key) {
  const observed = parseDateLike(observedAt);
  const asOf = parseDateLike(asOfDate) || new Date();
  const halfLifeDays = resolveHalfLifeDays(key);
  if (!observed) {
    return {
      level: "unknown",
      label: "未知",
      halfLifeDays,
      ageDays: null,
      expiresInDays: null,
    };
  }
  const ageDays = Math.max(0, (asOf.getTime() - observed.getTime()) / 86400000);
  if (ageDays <= halfLifeDays) {
    return {
      level: "fresh",
      label: "新鲜",
      halfLifeDays,
      ageDays,
      expiresInDays: Math.max(0, halfLifeDays - ageDays),
    };
  }
  if (ageDays <= halfLifeDays * 2) {
    return {
      level: "aging",
      label: "衰减",
      halfLifeDays,
      ageDays,
      expiresInDays: 0,
    };
  }
  return {
    level: "stale",
    label: "过期",
    halfLifeDays,
    ageDays,
    expiresInDays: -Math.abs(ageDays - halfLifeDays),
  };
}

export function pickHistoryBackfillCandidate(history, key, targetDate, options = {}) {
  if (!Array.isArray(history) || !history.length) return null;
  const allowStale = Boolean(options.allowStale);
  const target = parseDateLike(targetDate);
  const sorted = [...history]
    .filter((record) => {
      if (!record?.input || record.input[key] === null || record.input[key] === undefined) {
        return false;
      }
      if (!target) return true;
      if (!record.date) return false;
      return record.date <= targetDate;
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  for (const record of sorted) {
    const observedAt = observedAtFromRecord(record, key);
    const fetchedAt = fetchedAtFromRecord(record, key);
    const freshness = classifyFieldFreshness(observedAt, target || new Date(), key);
    if (!allowStale && freshness.level === "stale") {
      continue;
    }
    return {
      key,
      value: record.input[key],
      date: record.date,
      observedAt,
      fetchedAt,
      freshness,
      source: record.input.__sources?.[key] || `History cache: ${record.date}`,
    };
  }
  return null;
}

export function applyHalfLifeGate(input, keys, asOfDate) {
  if (!input) return [];
  const candidateKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(HALF_LIFE_DAYS);
  input.__fieldFreshness = input.__fieldFreshness || {};
  const staleKeys = [];
  candidateKeys.forEach((key) => {
    if (!(key in input)) return;
    const observedAt =
      input.__fieldObservedAt?.[key] ||
      input.__fieldUpdatedAt?.[key] ||
      input.__generatedAt ||
      null;
    const freshness = classifyFieldFreshness(observedAt, asOfDate, key);
    input.__fieldFreshness[key] = freshness;
    if (freshness.level === "stale" && input[key] !== null && input[key] !== undefined) {
      // Hard gate: stale fields are treated as missing.
      input[key] = null;
      staleKeys.push(key);
    }
  });
  if (staleKeys.length) {
    input.__errors = Array.isArray(input.__errors) ? input.__errors : [];
    input.__errors.push(`半衰期拦截：字段观测时间过期，已置空 ${staleKeys.join(", ")}`);
  }
  return staleKeys;
}

export function mergeInputsPreferFresh(base, incoming, keys, asOfDate) {
  const baseSafe = base || {};
  const incomingSafe = incoming || {};
  const result = { ...baseSafe, ...incomingSafe };

  const baseSources = baseSafe.__sources || {};
  const incomingSources = incomingSafe.__sources || {};
  const baseObserved = baseSafe.__fieldObservedAt || {};
  const incomingObserved = incomingSafe.__fieldObservedAt || {};
  const baseFetched = baseSafe.__fieldFetchedAt || {};
  const incomingFetched = incomingSafe.__fieldFetchedAt || {};
  const baseUpdated = baseSafe.__fieldUpdatedAt || {};
  const incomingUpdated = incomingSafe.__fieldUpdatedAt || {};

  result.__sources = { ...baseSources, ...incomingSources };
  result.__fieldObservedAt = { ...baseObserved, ...incomingObserved };
  result.__fieldFetchedAt = { ...baseFetched, ...incomingFetched };
  result.__fieldUpdatedAt = { ...baseUpdated, ...incomingUpdated };
  result.__errors = [
    ...((Array.isArray(baseSafe.__errors) ? baseSafe.__errors : []) || []),
    ...((Array.isArray(incomingSafe.__errors) ? incomingSafe.__errors : []) || []),
  ];

  const candidateKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(HALF_LIFE_DAYS);
  candidateKeys.forEach((key) => {
    const incomingVal = incomingSafe[key];
    const baseVal = baseSafe[key];

    const incomingObs =
      incomingObserved[key] || incomingUpdated[key] || incomingSafe.__generatedAt || null;
    const baseObs = baseObserved[key] || baseUpdated[key] || baseSafe.__generatedAt || null;

    const incomingFresh = classifyFieldFreshness(incomingObs, asOfDate, key);
    const baseFresh = classifyFieldFreshness(baseObs, asOfDate, key);

    const incomingUsable =
      incomingVal !== null && incomingVal !== undefined && incomingFresh.level !== "stale";
    const baseUsable = baseVal !== null && baseVal !== undefined && baseFresh.level !== "stale";

    if (incomingUsable) {
      result[key] = incomingVal;
      if (incomingSources[key] || baseSources[key]) {
        result.__sources[key] = incomingSources[key] || baseSources[key];
      }
      result.__fieldObservedAt[key] = incomingObs;
      result.__fieldFetchedAt[key] = incomingFetched[key] || incomingSafe.__generatedAt || incomingObs;
      result.__fieldUpdatedAt[key] = incomingUpdated[key] || incomingObs;
      return;
    }

    if (baseUsable) {
      result[key] = baseVal;
      if (baseSources[key]) {
        result.__sources[key] = baseSources[key];
      }
      result.__fieldObservedAt[key] = baseObs;
      result.__fieldFetchedAt[key] = baseFetched[key] || baseSafe.__generatedAt || baseObs;
      result.__fieldUpdatedAt[key] = baseUpdated[key] || baseObs;
      return;
    }

    // Neither usable: keep value as null so upstream validation can block.
    result[key] = null;
  });

  return result;
}
