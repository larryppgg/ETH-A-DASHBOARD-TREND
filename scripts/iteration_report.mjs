function pct(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function safe(value, fallback = "--") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function horizonLine(byHorizon, key) {
  const info = byHorizon?.[key] || {};
  const total = info.total ?? 0;
  const hit = info.hit ?? 0;
  const accuracy = typeof info.accuracy === "number" ? pct(info.accuracy, 1) : "--";
  const threshold = info.thresholdPct ?? "--";
  return `- ${key}D：命中率 ${accuracy}（${hit}/${total}，阈值 ±${threshold}%）`;
}

export function buildIterationReport(perfSummary = {}, options = {}) {
  const asOfDate = perfSummary.asOfDate || "unknown";
  const promptVersion = options.promptVersion || perfSummary.promptVersion || "--";
  const maturity = perfSummary.maturity || {};
  const byHorizon = perfSummary.byHorizon || {};
  const drift7 = perfSummary.drift?.["7"] || {};

  const lines = [];
  lines.push(`# 迭代建议 · ${asOfDate}`);
  lines.push("");
  lines.push(`- Prompt 版本：${promptVersion}`);
  lines.push(`- 生成时间：${safe(perfSummary.generatedAt)}`);
  lines.push("");

  lines.push("## 本日性能");
  lines.push(
    `- 样本成熟度：${maturity.matured ?? 0}/${maturity.total ?? 0}（成熟率 ${pct(maturity.ratio, 1)}，PENDING ${maturity.pending ?? 0}）`
  );
  lines.push(horizonLine(byHorizon, "7"));
  if (byHorizon["14"]) lines.push(horizonLine(byHorizon, "14"));
  lines.push("");

  lines.push("## 稳定性（漂移门）");
  lines.push(`- 7D：${safe(drift7.label || drift7.level)} · ${safe(drift7.note)}`);
  lines.push("");

  lines.push("## 最近错因样本（Top 10）");
  const recent = Array.isArray(perfSummary.recent) ? perfSummary.recent.slice(0, 10) : [];
  if (!recent.length) {
    lines.push("- 暂无（样本不足或未成熟）");
  } else {
    recent.forEach((row) => {
      const cell7 = row.horizons?.["7"] || {};
      const verdict = cell7.verdict || "pending";
      const ret = typeof cell7.returnPct === "number" ? `${cell7.returnPct.toFixed(1)}%` : "--";
      lines.push(`- ${row.date} · ${row.state} · 7D ${verdict.toUpperCase()} ${ret}`);
    });
  }
  lines.push("");

  lines.push("## 迭代建议（仅建议，不自动改策略）");
  const suggestions = [];
  if (typeof maturity.ratio === "number" && maturity.ratio < 0.6) {
    suggestions.push("先补齐历史：执行一次 365 天日级 backfill，提升成熟样本比例，避免漂移门长期“样本不足”。");
  }
  if (drift7.level === "danger") {
    suggestions.push("模型稳定性偏弱：建议下一周期按防守档/减小有效 β，优先等待关键反证指标转好再加仓。");
  } else if (drift7.level === "warn") {
    suggestions.push("存在中度漂移：建议降低单次动作幅度，强化反证条件触发的止损/对冲。");
  }
  const acc7 = byHorizon?.["7"]?.accuracy;
  if (typeof acc7 === "number" && acc7 < 0.4) {
    suggestions.push("7D 命中率偏低：建议复盘近 10 次 MISS 的共同特征（宏观/ETF/流动性），再考虑是否需要调整阈值或加大惩罚系数。");
  }
  if (!suggestions.length) {
    suggestions.push("暂无强制改动建议：继续按当前门禁执行，并保持每日对账与记录即可。");
  }
  suggestions.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
  lines.push("");
  lines.push("## 回滚方式");
  lines.push("- 本报告不改变任何策略参数；若后续手动改动阈值/提示词，请通过 Git 版本回退。");
  lines.push("");

  return lines.join("\n");
}

