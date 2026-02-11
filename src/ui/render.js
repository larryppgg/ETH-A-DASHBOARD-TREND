import { formatNumber } from "../utils.js";
import { fieldMeta, coverageGroups } from "./fieldMeta.js";
import { buildSeries } from "./timeline.js";
import {
  buildActionSummary,
  buildCounterfactuals,
  buildEvidenceHints,
  buildHealthSummary,
  buildMissingImpact,
  toPlainText,
} from "./summary.js";
import { classifyFieldFreshness } from "../inputPolicy.js";
import { renderPredictionEvaluation } from "./eval.js";

const stateLabels = {
  A: "A / 进攻档",
  B: "B / 防守档",
  C: "C / 避险档",
};

function normalizeGateIdForJump(gateId = "") {
  if (!gateId) return "";
  const first = gateId.split("/")[0].trim();
  if (first === "Tri") return "3域";
  return first;
}

export function renderKanban(elements, state, output) {
  const { kanbanA, kanbanB, kanbanC } = elements;
  kanbanA.innerHTML = "";
  kanbanB.innerHTML = "";
  kanbanC.innerHTML = "";
  document.querySelectorAll(".kanban-col").forEach((col) => col.classList.remove("active"));
  const card = document.createElement("div");
  card.className = "kanban-card";
  card.innerHTML = `
    <div>${output.phaseLabel} · β ${formatNumber(output.beta)}</div>
    <div>置信度 ${formatNumber(output.confidence)}</div>
    <div>${toPlainText(output.reasonsTop3[0]?.text || "—")}</div>
  `;
  if (state === "A") {
    kanbanA.appendChild(card);
  } else if (state === "B") {
    kanbanB.appendChild(card);
  } else {
    kanbanC.appendChild(card);
  }
  document.querySelector(`.kanban-col[data-state="${state}"]`).classList.add("active");
}

function fieldLabel(key) {
  return fieldMeta[key]?.label || key;
}

function formatAuditValue(value) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return formatNumber(value, 3);
  if (value === null || value === undefined || value === "") return "--";
  return String(value);
}

function formatEvidenceValue(key, value) {
  const unit = fieldMeta[key]?.unit || "";
  if (value === null || value === undefined) return "--";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    if (unit === "USD") {
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
    }
    if (unit === "%" || unit === "bp") return `${formatNumber(value, 2)} ${unit}`;
    return `${formatNumber(value, 3)}${unit ? ` ${unit}` : ""}`;
  }
  return String(value);
}

function buildKeyEvidence(output, input) {
  const reasonGateIds = (output?.reasonsTop3 || [])
    .map((item) => item.gateId)
    .filter(Boolean);
  const gates = (output?.gates || []).filter((gate) => reasonGateIds.includes(gate.id));
  const result = [];
  const seen = new Set();
  gates.forEach((gate) => {
    const inputs = gate.details?.inputs || {};
    const timings = gate.details?.timings || {};
    Object.keys(inputs).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const timing = timings[key] || {};
      const freshness = timing.freshness || input.__fieldFreshness?.[key] || {};
      result.push({
        key,
        label: fieldMeta[key]?.label || key,
        value: input[key],
        freshnessLevel: freshness.level || "unknown",
        freshnessLabel: freshness.label || "未知",
        observedAt: timing.observedAt || input.__fieldObservedAt?.[key] || input.__fieldUpdatedAt?.[key] || input.__generatedAt,
        fetchedAt: timing.fetchedAt || input.__fieldFetchedAt?.[key] || input.__generatedAt,
        source: gate.details?.sources?.[key] || input.__sources?.[key] || "来源缺失",
      });
    });
  });
  return result;
}

function renderKeyValueBlock(title, data = {}) {
  const rows = Object.entries(data)
    .map(([key, value]) => {
      const text = typeof value === "object" ? JSON.stringify(value) : formatAuditValue(value);
      return `
        <div class="detail-row">
          <span>${fieldLabel(key)}</span>
          <strong>${text}</strong>
        </div>
      `;
    })
    .join("");
  return `
    <div class="inspector-block">
      <h4>${title}</h4>
      ${rows || "无"}
    </div>
  `;
}

function renderInspector(container, gate) {
  if (!gate) {
    container.innerHTML = '<div class="inspector-empty">点击任意闸门，查看输入、来源与计算过程。</div>';
    return;
  }
  const details = gate.details || {};
  const steps = details.steps && details.steps.length ? details.steps : ["读取输入", "计算阈值/得分", "应用规则"];
  const rules =
    details.rules && details.rules.length
      ? details.rules.map((rule) => toPlainText(rule)).join(" / ")
      : "无";
  const timings = details.timings || {};
  const inputs = details.inputs || {};
  const sources = details.sources || {};
  const inputRows = Object.entries(inputs)
    .map(([key, value]) => {
      const timing = timings[key] || {};
      const observedAt = formatDataTime(timing.observedAt);
      const fetchedAt = formatDataTime(timing.fetchedAt);
      const freshness = timing.freshness?.label || "未知";
      const source = sources[key] || "来源缺失";
      return `
        <div class="inspector-row">
          <div class="inspector-k">${fieldLabel(key)}</div>
          <div class="inspector-v">${formatAuditValue(value)}</div>
          <div class="inspector-s">${freshness} · 观测 ${observedAt} · 抓取 ${fetchedAt}</div>
          <div class="inspector-src">${source}</div>
        </div>
      `;
    })
    .join("");
  container.innerHTML = `
    <div class="inspector-title">${gate.id} · ${gate.name}</div>
    <div class="inspector-grid">
      ${renderKeyValueBlock("计算", details.calc)}
      <div class="inspector-block">
        <h4>输入与来源（可审计）</h4>
        <div class="inspector-table">
          <div class="inspector-row head">
            <div class="inspector-k">字段</div>
            <div class="inspector-v">值</div>
            <div class="inspector-s">时效</div>
            <div class="inspector-src">来源</div>
          </div>
          ${inputRows || '<div class="inspector-empty">无输入</div>'}
        </div>
        <div class="coverage-ai coverage-ai-gate" data-gate-ai-inline="${gate.id}" data-state="pending">
          <span class="coverage-ai-tag">AI 解读</span>
          <span class="coverage-ai-text">等待生成...</span>
          <button class="coverage-ai-toggle" type="button" hidden>展开</button>
        </div>
      </div>
      <div class="inspector-block">
        <h4>步骤</h4>
        ${steps.map((step) => `<div>${step}</div>`).join("")}
      </div>
      <div class="inspector-block">
        <h4>规则命中</h4>
        <div>${rules}</div>
      </div>
    </div>
  `;
}

export function renderGates(container, inspector, gates, onSelect) {
  container.innerHTML = "";
  let currentGate = gates[0];
  const nodes = [];
  gates.forEach((gate) => {
    const inputs = gate.details?.inputs || {};
    const timings = gate.details?.timings || {};
    let missingCount = 0;
    let staleCount = 0;
    let agingCount = 0;
    Object.entries(inputs).forEach(([key, value]) => {
      if (value === null || value === undefined) missingCount += 1;
      const level = timings?.[key]?.freshness?.level;
      if (level === "stale") staleCount += 1;
      else if (level === "aging") agingCount += 1;
    });
    const item = document.createElement("div");
    item.className = "gate-item";
    item.dataset.gateId = gate.id;
    item.innerHTML = `
      <div class="gate-left">
        <div class="gate-tag">${gate.id}</div>
        <div class="gate-name">${gate.name}</div>
      </div>
      <div class="gate-note">${gate.note}</div>
      <div class="gate-meta">${missingCount ? `缺失 ${missingCount}` : "缺失 0"} · ${
      staleCount ? `过期 ${staleCount}` : agingCount ? `衰减 ${agingCount}` : "时效 OK"
    }</div>
      <div class="gate-status ${gate.status}">${gate.status.toUpperCase()}</div>
    `;
    item.addEventListener("click", () => {
      nodes.forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      renderInspector(inspector, gate);
      if (typeof onSelect === "function") {
        onSelect(gate);
      }
    });
    container.appendChild(item);
    nodes.push(item);
  });
  if (nodes[0]) nodes[0].classList.add("active");
  renderInspector(inspector, currentGate);
  if (typeof onSelect === "function") {
    onSelect(currentGate);
  }
}

export function renderGateChain(container, gates, selectedId, onSelect) {
  if (!container) return;
  if (!gates || !gates.length) {
    container.innerHTML = '<div class="inspector-empty">暂无闸门链路</div>';
    return;
  }
  const statusCount = gates.reduce(
    (acc, gate) => {
      const level = gate?.status || "open";
      if (level === "closed") acc.closed += 1;
      else if (level === "warn") acc.warn += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, warn: 0, closed: 0 }
  );
  container.innerHTML = `
    <div class="gate-chain-head">
      <span class="chain-kpi">总闸门 ${gates.length}</span>
      <span class="chain-kpi open">OPEN ${statusCount.open}</span>
      <span class="chain-kpi warn">WARN ${statusCount.warn}</span>
      <span class="chain-kpi closed">CLOSED ${statusCount.closed}</span>
    </div>
    <div class="gate-chain-grid">
      ${gates
        .map((gate, index) => {
          const active = gate.id === selectedId ? "active" : "";
          const inputs = gate.details?.inputs || {};
          const timings = gate.details?.timings || {};
          let missingCount = 0;
          let staleCount = 0;
          let agingCount = 0;
          Object.entries(inputs).forEach(([key, value]) => {
            if (value === null || value === undefined) missingCount += 1;
            const level = timings?.[key]?.freshness?.level;
            if (level === "stale") staleCount += 1;
            else if (level === "aging") agingCount += 1;
          });
          const badges = [
            missingCount ? `<span class="mini-badge missing">缺失 ${missingCount}</span>` : "",
            staleCount ? `<span class="mini-badge stale">过期 ${staleCount}</span>` : "",
            !staleCount && agingCount ? `<span class="mini-badge aging">衰减 ${agingCount}</span>` : "",
          ]
            .filter(Boolean)
            .join("");
          return `
            <button type="button" class="gate-chain-card ${gate.status} ${active}" data-gate="${gate.id}">
              <span class="gate-chain-step">${String(index + 1).padStart(2, "0")}</span>
              <span class="gate-chain-node ${gate.status}">
                <span class="gate-chain-dot"></span>
                <span class="gate-chain-id">${gate.id}</span>
                <span class="gate-chain-name">${gate.name}</span>
                <span class="gate-chain-badges">${badges || `<span class="mini-badge ok">OK</span>`}</span>
                <span class="gate-chain-note">${toPlainText(gate.note || "")}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
  if (typeof onSelect === "function") {
    container.querySelectorAll("[data-gate]").forEach((node) => {
      node.addEventListener("click", () => {
        const gateId = node.getAttribute("data-gate");
        const gate = gates.find((item) => item.id === gateId);
        if (gate) {
          onSelect(gate);
        }
      });
    });
  }
}

export function renderAuditVisual(container, gate) {
  if (!container) return;
  if (!gate) {
    container.innerHTML = '<div class="inspector-empty">暂无审计信息</div>';
    return;
  }
  const details = gate.details || {};
  const inputs = details.inputs || {};
  const sources = details.sources || {};
  const calc = details.calc || {};
  const rules = details.rules || [];
  const inputRows = Object.entries(inputs)
    .map(([key, value]) => {
      const source = sources[key] || "来源缺失";
      const timing = details.timings?.[key] || {};
      const observedAt = formatDataTime(timing.observedAt);
      const fetchedAt = formatDataTime(timing.fetchedAt);
      const freshness = timing.freshness?.label || "未知";
      const label = fieldLabel(key);
      const display = formatAuditValue(value);
      const barWidth =
        typeof value === "boolean"
          ? value
            ? 92
            : 28
          : typeof value === "number"
          ? Math.max(8, Math.min(96, Math.log10(Math.abs(value) + 1) * 24))
          : 40;
      return `
        <div class="audit-row">
          <div class="audit-key">${label}</div>
          <div class="audit-metric">
            <div class="audit-bar">
              <span style="width:${barWidth}%"></span>
            </div>
            <div class="audit-value">${display}</div>
          </div>
          <div class="audit-source">${source}<div class="audit-time">${freshness} · 观测 ${observedAt} · 抓取 ${fetchedAt}</div></div>
        </div>
      `;
    })
    .join("");
  const ruleChips = rules.length
    ? rules
        .map((rule) => `<span class="audit-chip hit">${toPlainText(rule)}</span>`)
        .join("")
    : '<span class="audit-chip">无命中规则</span>';
  const calcRows = Object.entries(calc)
    .map(([key, value]) => {
      const display = formatAuditValue(value);
      return `<div class="audit-kv"><span>${fieldLabel(key)}</span><strong>${display}</strong></div>`;
    })
    .join("");
  container.innerHTML = `
    <div class="audit-head">${gate.id} · ${gate.name}</div>
    <div class="audit-verdict">
      <span>当前结论</span>
      <strong>${toPlainText(gate.note || "暂无结论")}</strong>
    </div>
    <div class="coverage-ai coverage-ai-gate" data-gate-ai-inline="${gate.id}" data-state="pending">
      <span class="coverage-ai-tag">AI 解读</span>
      <span class="coverage-ai-text">等待生成...</span>
      <button class="coverage-ai-toggle" type="button" hidden>展开</button>
    </div>
    <div class="audit-section">
      <div class="audit-title">输入与来源</div>
      <div class="audit-list">${inputRows || '<div class="inspector-empty">无输入</div>'}</div>
    </div>
    <div class="audit-section">
      <div class="audit-title">规则命中</div>
      <div class="audit-chips">${ruleChips}</div>
    </div>
    <div class="audit-section">
      <div class="audit-title">计算</div>
      <div class="audit-kv-list">${calcRows || '<div class="inspector-empty">无计算</div>'}</div>
    </div>
  `;
}

export function renderReasons(listContainer, notesContainer, reasons, notes, gateMap, gateList, inspector, onSelect) {
  listContainer.innerHTML = "";
  reasons.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = toPlainText(item.text);
    if (item.gateId) {
      li.dataset.gateId = item.gateId;
      li.classList.add("reason-link");
    }
    listContainer.appendChild(li);
  });
  notesContainer.innerHTML = notes.length ? notes.map((note) => `<div>${toPlainText(note)}</div>`).join("") : "无";

  listContainer.querySelectorAll(".reason-link").forEach((item) => {
    item.addEventListener("click", () => {
      const gate = gateMap.get(item.dataset.gateId);
      if (gate) {
        const gateNode = gateList.querySelector(`[data-gate-id="${item.dataset.gateId}"]`);
        gateNode?.scrollIntoView({ behavior: "smooth", block: "center" });
        renderInspector(inspector, gate);
        if (typeof onSelect === "function") {
          onSelect(gate);
        }
      }
    });
  });
}

export function renderChart(container, series, color) {
  container.innerHTML = "";
  if (!series.length) return;
  const width = 260;
  const height = 100;
  const padding = 10;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const spread = max - min || 1;
  const points = series.map((value, index) => {
    const x = padding + (index / (series.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / spread) * (height - padding * 2);
    return `${x},${y}`;
  });
  const path = `M ${points.join(" L ")}`;
  const lastPoint = points[points.length - 1].split(",");
  container.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grad-${color}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.8" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.1" />
        </linearGradient>
      </defs>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" />
      <path d="${path} L ${width - padding},${height - padding} L ${padding},${height - padding} Z"
        fill="url(#grad-${color})" />
      <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="3.5" fill="${color}" />
    </svg>
  `;
}

function buildPoints(values, width, height, padding, min, max) {
  const spread = max - min || 1;
  return values.map((value, index) => {
    const x = padding + (index / (values.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / spread) * (height - padding * 2);
    return { x, y };
  });
}

function buildVolatilityBars(series) {
  const bars = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const curr = series[i];
    if (typeof prev !== "number" || typeof curr !== "number") {
      bars.push(0);
    } else {
      bars.push(Math.abs(curr - prev));
    }
  }
  return bars;
}

function buildEvents(history) {
  const events = [];
  for (let i = 1; i < history.length; i += 1) {
    const prev = history[i - 1];
    const curr = history[i];
    if (prev.output.state !== curr.output.state) {
      events.push({ idx: i, type: "state" });
    }
    if (curr.output.extremeAllowed) {
      events.push({ idx: i, type: "extreme" });
    }
    if (curr.output.distributionGate >= 2) {
      events.push({ idx: i, type: "distribution" });
    }
    if ((curr.output.riskNotes || []).some((note) => note.includes("红灯"))) {
      events.push({ idx: i, type: "risk" });
    }
  }
  return events;
}

export function renderTimelineOverview(container, legendContainer, history, selectedDate) {
  if (!container) return;
  if (!history.length) {
    container.innerHTML = '<div class="inspector-empty">暂无历史记录</div>';
    if (legendContainer) legendContainer.innerHTML = "";
    return;
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const betaSeries = buildSeries(sorted, (item) => item.output.beta).map((item) => item.value);
  const confidenceSeries = buildSeries(sorted, (item) => item.output.confidence).map((item) => item.value);
  const priceSeries = buildSeries(sorted, (item) => item.input?.ethSpotPrice).map((item) => item.value);
  const volSeries = buildVolatilityBars(betaSeries);
  const allValues = [...betaSeries, ...confidenceSeries].filter(
    (value) => typeof value === "number"
  );
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const width = 520;
  const height = 170;
  const padding = 12;
  const betaPoints = buildPoints(betaSeries, width, height, padding, min, max);
  const confPoints = buildPoints(confidenceSeries, width, height, padding, min, max);
  const priceValues = priceSeries.filter((value) => typeof value === "number");
  const priceMin = priceValues.length ? Math.min(...priceValues) : 0;
  const priceMax = priceValues.length ? Math.max(...priceValues) : 1;
  const priceFilled = priceSeries.map((value, idx) => {
    if (typeof value === "number") return value;
    for (let j = idx + 1; j < priceSeries.length; j += 1) {
      if (typeof priceSeries[j] === "number") return priceSeries[j];
    }
    return priceValues[0];
  });
  const pricePoints = priceValues.length
    ? buildPoints(priceFilled, width, height, padding, priceMin, priceMax)
    : [];
  const selectedIndex = Math.max(
    0,
    sorted.findIndex((item) => item.date === selectedDate)
  );
  const activeIndex = selectedIndex === -1 ? sorted.length - 1 : selectedIndex;
  const lineX = betaPoints[activeIndex]?.x ?? padding;
  const events = buildEvents(sorted);
  const bandHeight = (height - padding * 2) / 3;
  const bandY1 = padding;
  const bandY2 = padding + bandHeight;
  const bandY3 = padding + bandHeight * 2;

  const toPath = (points) => points.map((point) => `${point.x},${point.y}`).join(" ");
  const volMax = Math.max(...volSeries, 0.01);
  const volBars = volSeries
    .map((value, index) => {
      const x = betaPoints[index + 1]?.x ?? padding;
      const barHeight = (value / volMax) * 28;
      const y = height - padding - barHeight;
      return `<rect x="${x - 2}" y="${y}" width="4" height="${barHeight}" fill="rgba(255,255,255,0.15)" />`;
    })
    .join("");
  const eventMarks = events
    .map((event) => {
      const x = betaPoints[event.idx]?.x ?? padding;
      const color =
        event.type === "state"
          ? "#e0b65b"
          : event.type === "risk"
          ? "#e35654"
          : event.type === "distribution"
          ? "#60d6c2"
          : "#f3a545";
      return `<circle cx="${x}" cy="${padding - 2}" r="4" fill="${color}" />`;
    })
    .join("");
  container.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="timeline-beta" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e0b65b" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#e0b65b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="${padding}" y="${bandY1}" width="${width - padding * 2}" height="${bandHeight}" fill="rgba(89,212,143,0.08)" />
      <rect x="${padding}" y="${bandY2}" width="${width - padding * 2}" height="${bandHeight}" fill="rgba(243,165,69,0.08)" />
      <rect x="${padding}" y="${bandY3}" width="${width - padding * 2}" height="${bandHeight}" fill="rgba(227,86,84,0.08)" />
      <line x1="${lineX}" y1="10" x2="${lineX}" y2="${height - 10}" stroke="rgba(255,255,255,0.2)" stroke-dasharray="4 4" />
      <polyline points="${toPath(betaPoints)}" fill="none" stroke="#e0b65b" stroke-width="2" />
      <polyline points="${toPath(confPoints)}" fill="none" stroke="#60d6c2" stroke-width="2" />
      ${pricePoints.length ? `<polyline points="${toPath(pricePoints)}" fill="none" stroke="#8cb4ff" stroke-width="1.8" />` : ""}
      ${volBars}
      <circle cx="${betaPoints[activeIndex].x}" cy="${betaPoints[activeIndex].y}" r="3.5" fill="#e0b65b" />
      <circle cx="${confPoints[activeIndex].x}" cy="${confPoints[activeIndex].y}" r="3.5" fill="#60d6c2" />
      ${pricePoints.length ? `<circle cx="${pricePoints[activeIndex].x}" cy="${pricePoints[activeIndex].y}" r="3" fill="#8cb4ff" />` : ""}
      ${eventMarks}
    </svg>
  `;
  if (legendContainer) {
    legendContainer.innerHTML = `
      <span><i class="dot" style="background:#e0b65b"></i>β</span>
      <span><i class="dot" style="background:#60d6c2"></i>置信度</span>
      <span><i class="dot" style="background:#8cb4ff"></i>ETH 现货</span>
      <span><i class="dot" style="background:#e35654"></i>风险事件</span>
      <span><i class="dot" style="background:#f3a545"></i>极限许可</span>
      <span><i class="dot" style="background:#60d6c2"></i>分发闸门</span>
    `;
  }
}

function formatCoverageValue(value) {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return value ?? "—";
}

function formatDataTime(value) {
  if (!value) return "--";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function findGateForCoverage(output, groupId) {
  const idMap = {
    Tri: "3域",
  };
  const gateId = idMap[groupId] || groupId;
  return (output?.gates || []).find((gate) => gate.id === gateId);
}

export function renderCoverage(container, input, output = null) {
  if (!container) return;
  const sources = input.__sources || {};
  const fieldObservedAt = input.__fieldObservedAt || {};
  const fieldFetchedAt = input.__fieldFetchedAt || {};
  const fieldUpdatedAt = input.__fieldUpdatedAt || {};
  const fieldFreshness = input.__fieldFreshness || {};
  const missing = new Set(input.__missing || []);
  const fallbackUpdatedAt = formatDataTime(input.__generatedAt || input.generatedAt);
  const keyEvidence = new Set();
  const reasonGateIds = (output?.reasonsTop3 || [])
    .map((item) => item.gateId)
    .filter(Boolean);
  (output?.gates || []).forEach((gate) => {
    if (!gate?.id || !reasonGateIds.includes(gate.id)) return;
    const inputs = gate.details?.inputs || {};
    Object.keys(inputs).forEach((key) => keyEvidence.add(key));
  });
  container.innerHTML = coverageGroups
    .map((group) => {
      if (!group.keys.length) {
        const gate = findGateForCoverage(output, group.id);
        const gateId = gate?.id || group.id;
        const gateStatus = gate?.status ? gate.status.toUpperCase() : "--";
        const rawNote = gate?.note || "暂无输出";
        const plainNote = toPlainText(rawNote);
        const gateNote = plainNote !== rawNote ? `${rawNote}（解读：${plainNote}）` : rawNote;
        const rules = (gate?.details?.rules || []).map((item) => toPlainText(item)).join(" / ") || "暂无";
        const calc = gate?.details?.calc || {};
        const calcHint = Object.keys(calc).length
          ? Object.entries(calc)
              .map(([k, v]) => `${fieldLabel(k)}=${formatAuditValue(v)}`)
              .join(" / ")
          : "暂无";
        return `
          <div class="coverage-section">
            <div class="coverage-title">${group.label}</div>
            <div class="coverage-derived">
              <div class="coverage-derived-row">
                <span>阶段结论</span>
                <strong>${gateNote}</strong>
              </div>
              <div class="coverage-derived-row">
                <span>状态</span>
                <strong>${gateStatus}</strong>
              </div>
              <div class="coverage-derived-row">
                <span>规则依据</span>
                <strong>${rules}</strong>
              </div>
              <div class="coverage-derived-row">
                <span>计算摘要</span>
                <strong>${calcHint}</strong>
              </div>
            </div>
            <div class="coverage-ai coverage-ai-gate" data-gate-ai="${gateId}" data-state="pending">
              <span class="coverage-ai-tag">AI 解读</span>
              <span class="coverage-ai-text">等待生成...</span>
              <button class="coverage-ai-toggle" type="button" hidden>展开</button>
            </div>
          </div>
        `;
      }
      const rows = group.keys
        .map((key) => {
          const meta = fieldMeta[key] || { label: key, unit: "", desc: "" };
          const value = input[key];
          const isMissing = missing.has(key) || value === null || value === undefined;
          const isKeyEvidence = keyEvidence.has(key);
          const source = sources[key] || "来源缺失";
          const observedAt = formatDataTime(
            fieldObservedAt[key] || fieldUpdatedAt[key] || fallbackUpdatedAt
          );
          const fetchedAt = formatDataTime(fieldFetchedAt[key] || fallbackUpdatedAt);
          const freshness =
            fieldFreshness[key] ||
            classifyFieldFreshness(
              fieldObservedAt[key] || fieldUpdatedAt[key] || input.__generatedAt,
              input.date || input.__targetDate || new Date(),
              key
            );
          const freshnessLabel = freshness?.label || "未知";
          const freshnessClass = freshness?.level || "unknown";
          const gateTarget = normalizeGateIdForJump(meta.gate || "");
          return `
            <div class="coverage-row ${isMissing ? "missing" : "ok"} ${freshnessClass} ${
              isKeyEvidence ? "key-evidence" : ""
            }" data-field-key="${key}">
              <div class="coverage-main">
                <div class="coverage-cell key">
                  <div class="coverage-label">${meta.label}</div>
                  <div class="coverage-desc">${meta.desc || ""}</div>
                </div>
                <div class="coverage-cell value">
                  ${isMissing ? "缺失" : formatCoverageValue(value)}
                  <span class="coverage-unit">${meta.unit || ""}</span>
                </div>
                <div class="coverage-cell source">${source}</div>
                <div class="coverage-cell status">
                  ${isMissing ? "缺失" : "可用"} · ${freshnessLabel} · 观测 ${observedAt} · 抓取 ${fetchedAt}
                  ${
                    gateTarget
                      ? `<button class="coverage-jump" type="button" data-gate-target="${gateTarget}">定位 ${gateTarget}</button>`
                      : ""
                  }
                </div>
              </div>
              <div class="coverage-ai" data-field-ai="${key}" data-state="pending">
                <span class="coverage-ai-tag">AI 解读</span>
                <span class="coverage-ai-text">${isMissing ? "字段缺失，等待补齐后解读" : "等待生成..."}</span>
                <button class="coverage-ai-toggle" type="button" hidden>展开</button>
              </div>
            </div>
          `;
        })
        .join("");
      return `
        <div class="coverage-section">
          <div class="coverage-title">${group.label}</div>
          ${rows}
        </div>
      `;
    })
    .join("");
}

export function renderOutput(elements, record, history) {
  const output = record.output;
  const state = output.state;
  document.body.classList.remove("state-A", "state-B", "state-C");
  document.body.classList.add(`state-${state}`);

  elements.statusBadge.textContent = state;
  elements.statusTitle.textContent = stateLabels[state];
  elements.statusSub.textContent =
    output.reasonsTop3.map((item) => toPlainText(item.text)).join(" · ") || "—";
  elements.betaValue.textContent = `${formatNumber(output.beta)} / ${formatNumber(output.betaCap)}`;
  elements.hedgeValue.textContent = output.hedge ? "ON" : "OFF";
  elements.phaseValue.textContent = output.phaseLabel;
  elements.confidenceValue.textContent = formatNumber(output.confidence);
  elements.extremeValue.textContent = output.extremeAllowed ? "是" : "否";
  elements.distributionValue.textContent = `${output.distributionGate} / 30D`;
  elements.lastRun.textContent = record.date;

  const actionSummary = buildActionSummary(output);
  const topReasonText = (output.reasonsTop3 || [])
    .map((item) => toPlainText(item.text))
    .join(" / ");

  if (elements.statusOverview) {
    const stateIndex = state === "A" ? 0 : state === "B" ? 1 : 2;
    elements.statusOverview.innerHTML = `
      <div class="status-overview-bar">
        <span class="slot ${stateIndex === 0 ? "active" : ""}">A</span>
        <span class="slot ${stateIndex === 1 ? "active" : ""}">B</span>
        <span class="slot ${stateIndex === 2 ? "active" : ""}">C</span>
      </div>
    `;
  }

  if (elements.timelineLabel && history.length) {
    const sortedDates = [...history].sort((a, b) => a.date.localeCompare(b.date)).map((item) => item.date);
    const idx = sortedDates.indexOf(record.date);
    const safeIndex = idx >= 0 ? idx : sortedDates.length - 1;
    elements.timelineLabel.textContent = `快照 ${record.date} · ${safeIndex + 1}/${sortedDates.length}`;
    if (elements.timelineRange) {
      elements.timelineRange.max = sortedDates.length === 1 ? 1 : Math.max(0, sortedDates.length - 1);
      elements.timelineRange.value = sortedDates.length === 1 ? 1 : safeIndex;
    }
    if (elements.timelineOverview) {
      renderTimelineOverview(elements.timelineOverview, elements.timelineLegend, history, record.date);
    }
  }

  const aiStatus =
    typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
      ? localStorage.getItem("eth_a_dashboard_ai_status_v1") || "AI 未联机，已使用本地解读"
      : "AI 未联机，已使用本地解读";
  const qualityMeta = {
    aiStatus,
    driftLevel: output.modelRisk?.level || "ok",
    driftNote: output.modelRisk?.note || "",
    executionLevel: output.execution?.level || "ok",
  };
  const health = buildHealthSummary(record.input, qualityMeta);
  if (typeof document !== "undefined" && document?.body?.dataset) {
    document.body.dataset.statusLevel = health.qualityLevel || health.level || "ok";
  }
  if (elements.healthFreshness) elements.healthFreshness.textContent = health.freshnessText;
  if (elements.healthMissing) elements.healthMissing.textContent = health.missingText;
  if (elements.healthProxy) elements.healthProxy.textContent = health.proxyText;
  if (elements.healthAi) elements.healthAi.textContent = health.aiText;
  if (elements.healthTimeliness) elements.healthTimeliness.textContent = health.timelinessText;
  if (elements.healthQuality) elements.healthQuality.textContent = health.qualityText;
  if (elements.healthDrift) elements.healthDrift.textContent = health.driftText || "--";
  if (elements.healthExecution) elements.healthExecution.textContent = health.executionText || "--";
  if (elements.decisionConclusion) {
    elements.decisionConclusion.textContent = `${stateLabels[state] || state} · ${actionSummary.action}`;
  }
  if (elements.decisionExecutable) {
    elements.decisionExecutable.textContent =
      health.qualityText === "OK" ? "可执行" : health.qualityText === "WARN" ? "谨慎执行" : "暂不执行";
    elements.decisionExecutable.className =
      health.qualityText === "OK"
        ? "decision-value ok"
        : health.qualityText === "WARN"
        ? "decision-value warn"
        : "decision-value danger";
  }
  if (elements.decisionWhy) {
    elements.decisionWhy.textContent = topReasonText || "暂无核心驱动";
  }
  if (elements.decisionNext) {
    const next = (actionSummary.watch || []).slice(0, 2);
    elements.decisionNext.textContent = next.length ? next.join(" / ") : "暂无关键观察项";
  }
  if (elements.runMetaTrust) {
    elements.runMetaTrust.textContent = health.level === "danger" ? "FAIL" : health.level === "warn" ? "WARN" : "OK";
    elements.runMetaTrust.className = health.level === "danger" ? "danger" : health.level === "warn" ? "warn" : "ok";
  }

  if (elements.runAdviceBody) {
    const reasons = (health.quality?.reasons || []).slice(0, 6);
    const lines = [];
    lines.push(`门禁：${health.qualityText} · 时效：${health.timelinessText} · 可信度：${health.level.toUpperCase()}`);
    if (reasons.length) {
      lines.push(`原因：${reasons.join(" / ")}`);
    }
    if (health.level === "danger" || health.qualityLevel === "danger") {
      lines.push("建议：优先点击“强制抓取（外部刷新）”，再重试运行；若仍失败，说明关键字段缺失或过期。");
    } else if (health.level === "warn" || health.qualityLevel === "warn") {
      lines.push("建议：当前可参考但不宜重仓；优先观察关键字段是否从“衰减”回到“新鲜”。");
    } else {
      lines.push("建议：数据与时效通过，可按行动映射执行，并用反证条件做风控。");
    }
    elements.runAdviceBody.textContent = lines.join("\n");
  }

  if (elements.actionSummary) elements.actionSummary.textContent = actionSummary.humanAdvice;
  if (elements.actionDetail) {
    elements.actionDetail.textContent = `量化建议：${actionSummary.action} · ${actionSummary.detail}`;
  }
  if (elements.actionAvoid) {
    const items = (actionSummary.avoid || []).length ? actionSummary.avoid : ["无明确禁忌项（仍需遵守反证条件）。"];
    elements.actionAvoid.innerHTML = items.map((item) => `<div>${toPlainText(item)}</div>`).join("");
  }
  if (elements.actionWatch) {
    const items = (actionSummary.watch || []).length ? actionSummary.watch : ["暂无明确验证点。"];
    elements.actionWatch.innerHTML = items.map((item) => `<div>${toPlainText(item)}</div>`).join("");
  }
  if (elements.counterfactuals)
    elements.counterfactuals.innerHTML = buildCounterfactuals(output).map((item) => `<div>${item}</div>`).join("");
  if (elements.missingImpact)
    elements.missingImpact.innerHTML = buildMissingImpact(record.input).map((item) => `<div>${item}</div>`).join("");

  renderKanban(elements, state, output);
  renderGates(elements.gateList, elements.gateInspector, output.gates, (gate) => {
    renderGateChain(elements.gateChain, output.gates, gate.id);
    renderAuditVisual(elements.auditVisual, gate);
  });
  const gateMap = new Map(output.gates.map((gate) => [gate.id, gate]));
  renderReasons(
    elements.topReasons,
    elements.riskNotes,
    output.reasonsTop3,
    output.riskNotes,
    gateMap,
    elements.gateList,
    elements.gateInspector,
    (gate) => {
      renderGateChain(elements.gateChain, output.gates, gate.id);
      renderAuditVisual(elements.auditVisual, gate);
    }
  );
  renderGateChain(elements.gateChain, output.gates, output.gates[0]?.id, (gate) => {
    const gateNode = elements.gateList?.querySelector(`[data-gate-id="${gate.id}"]`);
    gateNode?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (gateNode) {
      elements.gateList?.querySelectorAll(".gate-item")?.forEach((node) => node.classList.remove("active"));
      gateNode.classList.add("active");
    }
    renderAuditVisual(elements.auditVisual, gate);
    renderInspector(elements.gateInspector, gate);
  });
  if (elements.evidenceHints) {
    const hints = buildEvidenceHints(output);
    elements.evidenceHints.innerHTML = hints.map((item) => `<div>${item}</div>`).join("");
  }
  renderCoverage(elements.coverageList, record.input, output);
  if (elements.coverageList) {
    elements.coverageList.querySelectorAll("[data-gate-target]").forEach((node) => {
      node.addEventListener("click", () => {
        const gateId = node.getAttribute("data-gate-target");
        const gate = (output.gates || []).find((item) => item.id === gateId);
        if (!gate) return;
        const gateNode = elements.gateList?.querySelector(`[data-gate-id="${gateId}"]`);
        gateNode?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (gateNode) {
          elements.gateList?.querySelectorAll(".gate-item")?.forEach((item) => item.classList.remove("active"));
          gateNode.classList.add("active");
        }
        renderInspector(elements.gateInspector, gate);
        renderAuditVisual(elements.auditVisual, gate);
        renderGateChain(elements.gateChain, output.gates, gate.id, (selectedGate) => {
          renderInspector(elements.gateInspector, selectedGate);
          renderAuditVisual(elements.auditVisual, selectedGate);
        });
      });
    });
  }

  if (elements.keyEvidence) {
    const list = buildKeyEvidence(output, record.input);
    const nonEmpty = list.filter((item) => item.key in fieldMeta).slice(0, 9);
    const chips = nonEmpty
      .map((item) => {
        const badgeClass =
          item.freshnessLevel === "fresh"
            ? "fresh"
            : item.freshnessLevel === "aging"
            ? "aging"
            : item.freshnessLevel === "stale"
            ? "stale"
            : "unknown";
        const observed = formatDataTime(item.observedAt);
        const fetched = formatDataTime(item.fetchedAt);
        return `
          <button class="evidence-chip" type="button" data-scroll-to-field="${item.key}">
            <div class="k">
              <span>${item.label}</span>
              <span class="evidence-badge ${badgeClass}">${item.freshnessLabel}</span>
            </div>
            <div class="v">${formatEvidenceValue(item.key, item.value)}</div>
            <div class="s">观测 ${observed} · 抓取 ${fetched}</div>
            <div class="evidence-ai" data-field-ai-inline="${item.key}" data-state="pending">AI：等待生成...</div>
          </button>
        `;
      })
      .join("");
    elements.keyEvidence.innerHTML = `
      <div class="key-evidence-head">
        <div class="key-evidence-title">关键证据（本次 Top3 驱动）</div>
        <div class="key-evidence-sub">点击任意卡片跳转到覆盖矩阵</div>
      </div>
      <div class="key-evidence-grid">${chips || '<div class="coverage-empty">暂无可展示字段</div>'}</div>
    `;
    elements.keyEvidence.querySelectorAll("[data-scroll-to-field]").forEach((node) => {
      node.addEventListener("click", () => {
        const key = node.getAttribute("data-scroll-to-field");
        const target = elements.coverageList?.querySelector(`[data-field-key=\"${key}\"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("flash");
          setTimeout(() => target.classList.remove("flash"), 900);
        }
      });
    });
  }

  const historySorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const betaSeries = historySorted.map((item) => item.output.beta);
  const confidenceSeries = historySorted.map((item) => item.output.confidence);
  const fofSeries = historySorted.map((item) => item.output.fofScore / 100);

  renderChart(elements.betaChart, betaSeries, "#e0b65b");
  renderChart(elements.confidenceChart, confidenceSeries, "#60d6c2");
  renderChart(elements.fofChart, fofSeries, "#59d48f");

  if (elements.betaTrendMeta) {
    const delta = betaSeries.length > 1 ? betaSeries[betaSeries.length - 1] - betaSeries[0] : 0;
    elements.betaTrendMeta.textContent = `含义：仓位进攻/防守倾向
方向：近 ${historySorted.length} 期 ${delta >= 0 ? "上行" : "下行"} ${formatNumber(Math.abs(delta))}
观察：若 β 上行但成交量未确认，优先按防守档执行`;
  }
  if (elements.confidenceTrendMeta) {
    const delta =
      confidenceSeries.length > 1
        ? confidenceSeries[confidenceSeries.length - 1] - confidenceSeries[0]
        : 0;
    elements.confidenceTrendMeta.textContent = `含义：信号一致性与稳定性
方向：近 ${historySorted.length} 期 ${delta >= 0 ? "增强" : "走弱"} ${formatNumber(Math.abs(delta))}
观察：置信度走弱时，按“谨慎执行”并提高反证权重`;
  }
  if (elements.fofTrendMeta) {
    const latest = historySorted[historySorted.length - 1]?.output?.fofScore ?? 0;
    elements.fofTrendMeta.textContent = `含义：资金环境综合温度
方向：当前 FoF ${formatNumber(latest)}（>60 偏宽松，<40 偏紧）
观察：FoF 低位时避免高杠杆追涨，优先等流动性回暖`;
  }

  if (elements.evalPanel) {
    renderPredictionEvaluation(elements.evalPanel, historySorted, record, qualityMeta);
  }

  if (elements.workflowReplay) elements.workflowReplay.textContent = "可回放";
  if (elements.workflowRun) elements.workflowRun.textContent = "完成";
  if (elements.workflowValidate) elements.workflowValidate.textContent = "通过";
}
