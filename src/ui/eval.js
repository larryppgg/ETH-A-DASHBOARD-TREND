import { deriveQualityGate } from "./summary.js";

function parseIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(dateStr, days) {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) return null;
  const next = new Date(parsed.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function pickFutureRecord(sorted, startIndex, targetDate, toleranceDays = 2, asOfDate = null) {
  if (!targetDate) return null;
  const latestAllowed = addDays(targetDate, toleranceDays);
  for (let i = startIndex; i < sorted.length; i += 1) {
    const date = sorted[i]?.date;
    if (!date) continue;
    if (asOfDate && date > asOfDate) return null;
    if (date < targetDate) continue;
    if (latestAllowed && date > latestAllowed) return null;
    return sorted[i];
  }
  return null;
}

function predictionExpectation(state) {
  if (state === "A") return "up";
  if (state === "C") return "down";
  return "range";
}

function scoreVerdict(expectation, returnPct, thresholdPct) {
  if (typeof returnPct !== "number" || !Number.isFinite(returnPct)) return { verdict: "pending", hit: null };
  if (expectation === "up") return { verdict: returnPct >= thresholdPct ? "hit" : "miss", hit: returnPct >= thresholdPct };
  if (expectation === "down")
    return { verdict: returnPct <= -thresholdPct ? "hit" : "miss", hit: returnPct <= -thresholdPct };
  return { verdict: Math.abs(returnPct) <= thresholdPct ? "hit" : "miss", hit: Math.abs(returnPct) <= thresholdPct };
}

export function computePredictionEvaluation(history = [], options = {}) {
  const horizons = Array.isArray(options.horizons) && options.horizons.length ? options.horizons : [7, 14];
  const thresholds = options.thresholds || { 7: 5, 14: 8 };
  const toleranceDays = Number.isFinite(options.toleranceDays) ? options.toleranceDays : 2;
  const sorted = [...(history || [])]
    .filter((item) => item && typeof item.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
  const asOfDate =
    typeof options.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate)
      ? options.asOfDate
      : sorted[sorted.length - 1]?.date || null;

  const rows = sorted.map((record, idx) => {
    const price = record?.input?.ethSpotPrice;
    const state = record?.output?.state || "-";
    const confidence = record?.output?.confidence ?? null;
    const beta = record?.output?.beta ?? null;
    const expectation = predictionExpectation(state);
    const row = {
      date: record.date,
      state,
      expectation,
      beta,
      confidence,
      price: typeof price === "number" ? price : null,
      horizons: {},
    };
    horizons.forEach((horizonDays) => {
      const target = addDays(record.date, horizonDays);
      const blockedByAsOf = Boolean(
        asOfDate && (record.date > asOfDate || (target && target > asOfDate))
      );
      const future = blockedByAsOf
        ? null
        : pickFutureRecord(sorted, idx + 1, target, toleranceDays, asOfDate);
      const futurePrice = future?.input?.ethSpotPrice;
      const returnPct =
        typeof price === "number" && typeof futurePrice === "number" && price !== 0
          ? ((futurePrice / price) - 1) * 100
          : null;
      const thresholdPct = thresholds[horizonDays] ?? 5;
      const scored = scoreVerdict(expectation, returnPct, thresholdPct);
      row.horizons[String(horizonDays)] = {
        targetDate: target,
        futureDate: future?.date || null,
        futurePrice: typeof futurePrice === "number" ? futurePrice : null,
        returnPct,
        thresholdPct,
        verdict: blockedByAsOf ? "pending" : scored.verdict,
        hit: blockedByAsOf ? null : scored.hit,
        blockedByAsOf,
      };
    });
    return row;
  });

  const summary = { byHorizon: {} };
  horizons.forEach((horizonDays) => {
    const key = String(horizonDays);
    const byState = { A: { total: 0, hit: 0 }, B: { total: 0, hit: 0 }, C: { total: 0, hit: 0 } };
    let total = 0;
    let hit = 0;
    rows.forEach((row) => {
      const cell = row.horizons[key];
      if (!cell || cell.hit === null) return;
      total += 1;
      if (cell.hit) hit += 1;
      if (row.state in byState) {
        byState[row.state].total += 1;
        if (cell.hit) byState[row.state].hit += 1;
      }
    });
    summary.byHorizon[key] = {
      total,
      hit,
      accuracy: total ? hit / total : null,
      byState,
      thresholdPct: thresholds[horizonDays] ?? 5,
    };
  });

  return { rows, summary, asOfDate };
}

export function deriveDriftSignal(history = [], options = {}) {
  const horizonDays = Number.isFinite(options.horizon) ? options.horizon : 7;
  const horizonKey = String(horizonDays);
  const lookback = Number.isFinite(options.lookback) ? options.lookback : 18;
  const minSamples = Number.isFinite(options.minSamples) ? options.minSamples : 6;
  const baseline = Number.isFinite(options.baseline) ? options.baseline : 0.55;
  const warningGap = Number.isFinite(options.warningGap) ? options.warningGap : 0.08;
  const dangerGap = Number.isFinite(options.dangerGap) ? options.dangerGap : 0.18;
  const evaluation = computePredictionEvaluation(history, {
    horizons: [horizonDays],
    thresholds: options.thresholds,
    toleranceDays: options.toleranceDays,
    asOfDate: options.asOfDate,
  });
  const maturedRows = evaluation.rows.filter((row) => row.horizons[horizonKey]?.hit !== null);
  const recentRows = maturedRows.slice(-lookback);
  const sampleSize = recentRows.length;
  if (sampleSize < minSamples) {
    return {
      level: "unknown",
      label: "样本不足",
      horizon: horizonDays,
      accuracy: null,
      baseline,
      sampleSize,
      betaMultiplier: 1,
      note: `${horizonDays}D 样本不足（${sampleSize}/${minSamples}）`,
    };
  }
  const hitCount = recentRows.reduce(
    (acc, row) => acc + (row.horizons[horizonKey]?.hit ? 1 : 0),
    0
  );
  const accuracy = hitCount / sampleSize;
  const gap = baseline - accuracy;
  let level = "ok";
  let label = "稳定";
  let betaMultiplier = 1;
  if (gap >= dangerGap) {
    level = "danger";
    label = "高漂移";
    betaMultiplier = 0.72;
  } else if (gap >= warningGap) {
    level = "warn";
    label = "中漂移";
    betaMultiplier = 0.86;
  }
  const pct = `${(accuracy * 100).toFixed(1)}%`;
  const baselinePct = `${(baseline * 100).toFixed(1)}%`;
  const note =
    level === "ok"
      ? `${horizonDays}D 命中率 ${pct}，在基线 ${baselinePct} 之上`
      : `${horizonDays}D 命中率 ${pct}，低于基线 ${baselinePct}`;
  return {
    level,
    label,
    horizon: horizonDays,
    accuracy,
    baseline,
    sampleSize,
    hitCount,
    betaMultiplier,
    note,
  };
}

function formatPct(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function pillClass(verdict) {
  if (verdict === "hit") return "hit";
  if (verdict === "miss") return "miss";
  return "pending";
}

export function renderPredictionEvaluation(container, history = [], focusRecord = null, meta = {}) {
  if (!container) return;
  const horizons = [7, 14];
  const thresholds = { 7: 5, 14: 8 };
  const asOfDate = focusRecord?.date || null;
  const evaluation = computePredictionEvaluation(history, { horizons, thresholds, asOfDate });
  const drift = deriveDriftSignal(history, {
    horizon: 7,
    asOfDate,
    thresholds,
    toleranceDays: 2,
  });
  const qualityMeta = {
    ...meta,
    driftLevel: meta.driftLevel || drift.level,
    driftNote: meta.driftNote || drift.note,
    executionLevel: meta.executionLevel || focusRecord?.output?.execution?.level || "ok",
  };
  const quality = deriveQualityGate ? deriveQualityGate(focusRecord?.input || {}, qualityMeta) : null;

  const qualityLabel = quality?.label || "--";
  const qualityReasons = quality?.reasons || [];

  const cards = horizons
    .map((days) => {
      const key = String(days);
      const info = evaluation.summary.byHorizon[key] || {};
      const accuracy = info.accuracy === null ? "--" : formatPct(info.accuracy * 100, 1);
      const total = info.total ?? 0;
      const hit = info.hit ?? 0;
      return `
        <div class="eval-card">
          <div class="k">${days}D 命中率</div>
          <div class="v">${accuracy}</div>
          <div class="s">阈值 ±${info.thresholdPct ?? thresholds[days]}% · ${hit}/${total}</div>
        </div>
      `;
    })
    .join("");
  const driftText =
    drift.accuracy === null
      ? drift.note
      : `${drift.note} · 样本 ${drift.hitCount}/${drift.sampleSize}`;

  const horizonKeys = horizons.map((days) => String(days));
  const maturedRows = evaluation.rows.filter((row) =>
    horizonKeys.some((key) => row.horizons[key]?.hit !== null)
  );
  const pendingRows = evaluation.rows.filter(
    (row) => !horizonKeys.some((key) => row.horizons[key]?.hit !== null)
  );
  const totalRows = evaluation.rows.length;
  const maturityRatio = totalRows ? ((maturedRows.length / totalRows) * 100).toFixed(1) : "0.0";
  const recent = maturedRows.slice(-10).reverse();
  const tableRows = recent
    .map((row) => {
      const cell7 = row.horizons["7"] || {};
      const cell14 = row.horizons["14"] || {};
      const v7 = cell7.verdict || "pending";
      const v14 = cell14.verdict || "pending";
      return `
        <tr>
          <td>${row.date}</td>
          <td>${row.state}</td>
          <td>${row.expectation}</td>
          <td>${formatUsd(row.price)}</td>
          <td><span class="eval-pill ${pillClass(v7)}">${v7}</span> ${formatPct(cell7.returnPct, 1)}</td>
          <td><span class="eval-pill ${pillClass(v14)}">${v14}</span> ${formatPct(cell14.returnPct, 1)}</td>
        </tr>
      `;
    })
    .join("");
  const pendingPreview = pendingRows
    .slice(-6)
    .reverse()
    .map((row) => {
      const target7 = row.horizons["7"]?.targetDate || "--";
      const target14 = row.horizons["14"]?.targetDate || "--";
      return `<li>${row.date}（7D→${target7} / 14D→${target14}）</li>`;
    })
    .join("");

  const footnote =
    qualityReasons.length
      ? `门禁理由：${qualityReasons.join(" / ")}`
      : "门禁理由：门禁通过（可发布）";

  container.innerHTML = `
    <div class="eval-summary">
      <div class="eval-card">
        <div class="k">是否可执行</div>
        <div class="v">${qualityLabel}</div>
        <div class="s">${footnote}</div>
      </div>
      <div class="eval-card">
        <div class="k">漂移监控</div>
        <div class="v">${drift.label}</div>
        <div class="s">${driftText}</div>
      </div>
      <div class="eval-card">
        <div class="k">待验证样本</div>
        <div class="v">${pendingRows.length}</div>
        <div class="s">这些日期尚未到达 7D/14D 验证窗口</div>
      </div>
      <div class="eval-card">
        <div class="k">样本充分度</div>
        <div class="v">${maturedRows.length}/${totalRows}</div>
        <div class="s">成熟占比 ${maturityRatio}% · 缺口 ${pendingRows.length}</div>
      </div>
      ${cards}
    </div>
    <table class="eval-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>State</th>
          <th>Expect</th>
          <th>ETH</th>
          <th>7D</th>
          <th>14D</th>
        </tr>
      </thead>
      <tbody>
        ${
          tableRows ||
          '<tr><td colspan="6" class="eval-empty">暂无可验证样本（请等待后续日期自然成熟）</td></tr>'
        }
      </tbody>
    </table>
    <div class="eval-pending">
      <div class="eval-pending-title">待验证日期（不会参与当前命中率）</div>
      <ul>${pendingPreview || "<li>无</li>"}</ul>
    </div>
    <div class="eval-footnote">说明：A 预期上涨，C 预期下跌，B 预期区间；用 ETH 现货价格做事后验证；as-of=${evaluation.asOfDate || "--"}。</div>
  `;
}
