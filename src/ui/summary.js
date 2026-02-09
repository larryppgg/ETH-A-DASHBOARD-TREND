import { fieldMeta } from "./fieldMeta.js";

function formatShort(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return value ?? "--";
  const fixed = value.toFixed(2);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
}

function formatTimestamp(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatRelativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

const plainTermMap = [
  ["SVC 结构强势加成", "链上价值捕获与资金结构偏强（加分）"],
  ["SVC 结构偏弱", "链上价值捕获偏弱（减分）"],
  ["突破未验证", "价格上冲未获成交量与资金确认"],
  ["宏观紧缩关门", "宏观流动性偏紧，先降低风险敞口"],
  ["杠杆拥挤 + ETF 弱势", "杠杆交易拥挤且 ETF 资金偏弱"],
  ["流动性缺血红灯", "增量资金不足，继续追涨风险高"],
  ["映射/分发比走坏", "资金映射效率下降，结构在走弱"],
  ["历史反转孕育区", "接近可能反转区，但仍需右侧确认"],
  ["买家缺席", "买盘持续性不足"],
  ["买家试探", "有试探性买盘，但力度一般"],
  ["买家主导", "买盘主导，短线更主动"],
  ["反转确认候选", "存在反转条件，但未完全确认"],
  ["BTD→BTR", "从抄底尝试转向反转确认阶段"],
  ["ΔES", "尾部风险波动指标"],
  ["FoF", "资金环境综合得分"],
  ["Risk-ON", "风险偏好开启条件"],
  ["BCM", "牛熊条件概率矩阵"],
  ["BPI", "买家参与强度指标"],
];

export function toPlainText(text = "", mode = null) {
  if (!text) return "";
  let resolvedMode = mode;
  if (
    !resolvedMode &&
    typeof document !== "undefined" &&
    document &&
    document.body &&
    document.body.dataset &&
    document.body.dataset.viewMode
  ) {
    resolvedMode = document.body.dataset.viewMode;
  }
  if (resolvedMode === "expert") return text;
  let output = text;
  plainTermMap.forEach(([term, plain]) => {
    const enriched = `${term}（${plain}）`;
    if (output.includes(term) && !output.includes(enriched)) {
      output = output.replaceAll(term, enriched);
    }
  });
  return output;
}

export function deriveTimelinessLevel(input = {}, keys = null) {
  const freshness = input.__fieldFreshness || {};
  const hasMap = freshness && typeof freshness === "object" && Object.keys(freshness).length > 0;
  if (!hasMap) {
    return { level: "unknown", label: "--", staleKeys: [], agingKeys: [], unknownKeys: [] };
  }
  const candidate = (keys && Array.isArray(keys) ? keys : Object.keys(fieldMeta)).filter((key) => key in input);
  const staleKeys = [];
  const agingKeys = [];
  const unknownKeys = [];
  candidate.forEach((key) => {
    if (input[key] === null || input[key] === undefined) return;
    const item = freshness[key];
    const level = item?.level || "unknown";
    if (level === "stale") staleKeys.push(key);
    else if (level === "aging") agingKeys.push(key);
    else if (level === "unknown") unknownKeys.push(key);
  });
  if (staleKeys.length) return { level: "danger", label: "FAIL", staleKeys, agingKeys, unknownKeys };
  if (agingKeys.length || unknownKeys.length) return { level: "warn", label: "WARN", staleKeys, agingKeys, unknownKeys };
  return { level: "ok", label: "OK", staleKeys, agingKeys, unknownKeys };
}

export function deriveTrustLevel(input = {}) {
  const missing = input.__missing || [];
  const errors = input.__errors || [];
  const softOnly =
    errors.length > 0 &&
    errors.every((err) => /fallback|blocked|cloudflare|rate limit|历史日期回抓|仅支持最新数据/i.test(err));
  const base =
    errors.length && !softOnly ? { level: "danger", label: "FAIL" } : missing.length || softOnly ? { level: "warn", label: "WARN" } : { level: "ok", label: "OK" };
  const timeliness = deriveTimelinessLevel(input);
  if (timeliness.level === "danger") return { level: "danger", label: "FAIL" };
  if (base.level === "danger") return base;
  if (base.level === "warn") return base;
  if (timeliness.level === "warn") return { level: "warn", label: "WARN" };
  return base;
}

export function deriveQualityGate(input = {}, meta = {}) {
  const trust = deriveTrustLevel(input);
  const timeliness = deriveTimelinessLevel(input);
  const aiStatus = meta.aiStatus || "";
  const explainLevel = aiStatus.includes("生成中") ? "warn" : "ok";
  const reasons = [];
  if (trust.level === "danger") reasons.push("可信度 FAIL（缺失/硬错误/过期字段）");
  else if (trust.level === "warn") reasons.push("可信度 WARN（软错误/衰减字段）");
  if (timeliness.level === "danger") reasons.push(`时效 FAIL（过期 ${timeliness.staleKeys.length}）`);
  else if (timeliness.level === "warn")
    reasons.push(`时效 WARN（衰减 ${timeliness.agingKeys.length} / 未知 ${timeliness.unknownKeys.length}）`);
  if (explainLevel === "warn") reasons.push("解释未完成（AI 仍在生成）");
  const level =
    trust.level === "danger" || timeliness.level === "danger"
      ? "danger"
      : trust.level === "warn" || timeliness.level === "warn" || explainLevel === "warn"
      ? "warn"
      : "ok";
  const label = level === "danger" ? "FAIL" : level === "warn" ? "WARN" : "OK";
  return { level, label, reasons: reasons.length ? reasons : ["门禁通过（可发布）"] };
}

export function buildHealthSummary(input = {}, meta = {}) {
  const generatedAt = input.__generatedAt || input.generatedAt;
  const proxyTrace = input.__proxyTrace || input.proxyTrace || [];
  const trust = deriveTrustLevel(input);
  const timeliness = deriveTimelinessLevel(input);
  const quality = deriveQualityGate(input, meta);

  let proxyText = "未知";
  if (proxyTrace.length) {
    const allOk = proxyTrace.every((item) => item.ok);
    proxyText = allOk
      ? `OK (${proxyTrace.map((item) => item.proxy).join("/")})`
      : `WARN (${proxyTrace.map((item) => item.proxy).join("/")})`;
  }

  return {
    level: trust.level,
    timelinessLevel: timeliness.level,
    qualityLevel: quality.level,
    missingCount: (input.__missing || []).length,
    errorsCount: (input.__errors || []).length,
    missingList: input.__missing || [],
    errorsList: input.__errors || [],
    timeliness,
    quality,
    freshnessText: generatedAt
      ? `更新 ${formatTimestamp(generatedAt)}（距今 ${formatRelativeTime(generatedAt)}）`
      : "更新 未知",
    missingText: (input.__missing || []).length ? `${(input.__missing || []).length} 项` : "无",
    proxyText,
    aiText: meta.aiStatus || "未连接",
    timelinessText:
      timeliness.level === "unknown"
        ? "--"
        : timeliness.level === "danger"
        ? `FAIL（过期 ${timeliness.staleKeys.length}）`
        : timeliness.level === "warn"
        ? `WARN（衰减 ${timeliness.agingKeys.length} / 未知 ${timeliness.unknownKeys.length}）`
        : "OK",
    qualityText: quality.label,
  };
}

export function buildActionSummary(output = {}) {
  const action = `${output.state || "-"} / β ${formatShort(output.beta)} / β_cap ${formatShort(output.betaCap)}`;
  const detail = `对冲 ${output.hedge ? "ON" : "OFF"} · 置信度 ${formatShort(output.confidence)}`;
  const drivers = (output.reasonsTop3 || []).map((item) => item.text);
  const blocks = output.riskNotes || [];
  let humanAdvice = "维持当前仓位，等待更多确认信号。";
  if (output.state === "A") {
    humanAdvice = "偏进攻：可小步加仓，前提是资金流和成交量继续同步走强。";
  } else if (output.state === "B") {
    humanAdvice = "偏防守：控制总仓位，先保留现金弹性，等确认信号再提风险。";
  } else if (output.state === "C") {
    humanAdvice = "偏避险：优先降风险敞口，避免追涨，先看风险信号是否钝化。";
  }
  return {
    action,
    detail,
    humanAdvice,
    drivers,
    blocks,
  };
}

export function buildCounterfactuals(output = {}) {
  const gates = output.gates || [];
  return gates
    .filter((gate) => gate.id !== "ACT" && (gate.status === "closed" || gate.status === "warn"))
    .map((gate) => `${gate.id} ${gate.name} · ${gate.note}`);
}

export function buildMissingImpact(input = {}) {
  const missing = input.__missing || [];
  if (!missing.length) return ["无缺失字段"]; 
  const byGate = new Map();
  missing.forEach((key) => {
    const meta = fieldMeta[key];
    if (!meta) return;
    const gates = meta.gate.split("/");
    gates.forEach((gate) => {
      const trimmed = gate.trim();
      if (!byGate.has(trimmed)) byGate.set(trimmed, []);
      byGate.get(trimmed).push(meta.label || key);
    });
  });
  if (!byGate.size) return missing.map((key) => `未识别字段：${key}`);
  return Array.from(byGate.entries()).map(
    ([gate, labels]) => `${gate} 受影响：${labels.join("、")}`
  );
}

export function buildEvidenceHints(output = {}) {
  const hints = [];
  if (output.distributionGate >= 2) hints.push("TradFi 分发闸门加成已开启");
  if (output.extremeAllowed) hints.push("极限重仓许可已开放");
  if (!output.extremeAllowed) hints.push("极限重仓许可未开放");
  if (output.hedge) hints.push("对冲 SOP 已启用");
  const normalized = hints.length ? hints : ["无额外提示"];
  return normalized.map((item) => toPlainText(item));
}
