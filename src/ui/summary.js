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

export function buildHealthSummary(input = {}, meta = {}) {
  const missing = input.__missing || [];
  const errors = input.__errors || [];
  const generatedAt = input.__generatedAt || input.generatedAt;
  const proxyTrace = input.__proxyTrace || input.proxyTrace || [];
  let level = "ok";
  if (errors.length) level = "danger";
  else if (missing.length) level = "warn";

  let proxyText = "未知";
  if (proxyTrace.length) {
    const allOk = proxyTrace.every((item) => item.ok);
    proxyText = allOk
      ? `OK (${proxyTrace.map((item) => item.proxy).join("/")})`
      : `WARN (${proxyTrace.map((item) => item.proxy).join("/")})`;
  }

  return {
    level,
    missingCount: missing.length,
    errorsCount: errors.length,
    missingList: missing,
    errorsList: errors,
    freshnessText: generatedAt ? `更新 ${formatTimestamp(generatedAt)}` : "更新 未知",
    missingText: missing.length ? `${missing.length} 项` : "无",
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
