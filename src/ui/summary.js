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

export function deriveTrustLevel(input = {}) {
  const missing = input.__missing || [];
  const errors = input.__errors || [];
  const softOnly =
    errors.length > 0 &&
    errors.every((err) => /fallback|blocked|cloudflare|rate limit/i.test(err));
  if (errors.length && !softOnly) return { level: "danger", label: "FAIL" };
  if (missing.length || softOnly) return { level: "warn", label: "WARN" };
  return { level: "ok", label: "OK" };
}

export function buildHealthSummary(input = {}, meta = {}) {
  const generatedAt = input.__generatedAt || input.generatedAt;
  const proxyTrace = input.__proxyTrace || input.proxyTrace || [];
  const trust = deriveTrustLevel(input);

  let proxyText = "未知";
  if (proxyTrace.length) {
    const allOk = proxyTrace.every((item) => item.ok);
    proxyText = allOk
      ? `OK (${proxyTrace.map((item) => item.proxy).join("/")})`
      : `WARN (${proxyTrace.map((item) => item.proxy).join("/")})`;
  }

  return {
    level: trust.level,
    missingCount: (input.__missing || []).length,
    errorsCount: (input.__errors || []).length,
    missingList: input.__missing || [],
    errorsList: input.__errors || [],
    freshnessText: generatedAt
      ? `更新 ${formatTimestamp(generatedAt)}（距今 ${formatRelativeTime(generatedAt)}）`
      : "更新 未知",
    missingText: (input.__missing || []).length ? `${(input.__missing || []).length} 项` : "无",
    proxyText,
    aiText: meta.aiStatus || "未连接",
  };
}

export function buildActionSummary(output = {}) {
  const action = `${output.state || "-"} / β ${formatShort(output.beta)} / β_cap ${formatShort(output.betaCap)}`;
  const detail = `对冲 ${output.hedge ? "ON" : "OFF"} · 置信度 ${formatShort(output.confidence)}`;
  const drivers = (output.reasonsTop3 || []).map((item) => item.text);
  const blocks = output.riskNotes || [];
  return {
    action,
    detail,
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
  return hints.length ? hints : ["无额外提示"];
}
