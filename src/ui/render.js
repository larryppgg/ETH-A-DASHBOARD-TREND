import { formatNumber } from "../utils.js";
import { fieldMeta, coverageGroups } from "./fieldMeta.js";
import { buildSeries } from "./timeline.js";
import {
  buildActionSummary,
  buildCounterfactuals,
  buildEvidenceHints,
  buildHealthSummary,
  buildMissingImpact,
} from "./summary.js";

const stateLabels = {
  A: "A / 进攻档",
  B: "B / 防守档",
  C: "C / 避险档",
};

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
    <div>${output.reasonsTop3[0]?.text || "—"}</div>
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

function renderKeyValueBlock(title, data = {}) {
  const rows = Object.entries(data)
    .map(([key, value]) => {
      const text = typeof value === "object" ? JSON.stringify(value) : value;
      return `
        <div class="detail-row">
          <span>${key}</span>
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
  const rules = details.rules && details.rules.length ? details.rules.join(" / ") : "无";
  container.innerHTML = `
    <div class="inspector-title">${gate.id} · ${gate.name}</div>
    <div class="inspector-grid">
      ${renderKeyValueBlock("输入", details.inputs)}
      ${renderKeyValueBlock("来源", details.sources)}
      ${renderKeyValueBlock("计算", details.calc)}
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
    const item = document.createElement("div");
    item.className = "gate-item";
    item.dataset.gateId = gate.id;
    item.innerHTML = `
      <div class="gate-left">
        <div class="gate-tag">${gate.id}</div>
        <div class="gate-name">${gate.name}</div>
      </div>
      <div class="gate-note">${gate.note}</div>
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
  const width = 520;
  const height = 200;
  const padding = 24;
  const gap = (width - padding * 2) / Math.max(gates.length - 1, 1);
  const nodeY = height / 2;
  const colors = {
    open: "#59d48f",
    warn: "#f3a545",
    closed: "#e35654",
  };
  const nodes = gates
    .map((gate, idx) => {
      const x = padding + idx * gap;
      const color = colors[gate.status] || "#9aa4b2";
      const active = gate.id === selectedId;
      return `
        <g data-gate="${gate.id}">
          <circle cx="${x}" cy="${nodeY}" r="${active ? 12 : 10}" fill="${color}" />
          <text x="${x}" y="${nodeY - 18}" text-anchor="middle" fill="#cfd6e4" font-size="10">${gate.id}</text>
          <text x="${x}" y="${nodeY + 26}" text-anchor="middle" fill="#8892a6" font-size="9">${gate.name}</text>
        </g>
      `;
    })
    .join("");
  const links = gates
    .map((_gate, idx) => {
      if (idx === 0) return "";
      const x1 = padding + (idx - 1) * gap;
      const x2 = padding + idx * gap;
      return `<line x1="${x1}" y1="${nodeY}" x2="${x2}" y2="${nodeY}" stroke="rgba(255,255,255,0.2)" stroke-dasharray="4 6" />`;
    })
    .join("");
  container.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${links}
      ${nodes}
    </svg>
  `;
  if (typeof onSelect === "function") {
    const svg = container.querySelector("svg");
    svg?.querySelectorAll("g[data-gate]").forEach((node) => {
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
      const label = key;
      const display = typeof value === "number" ? value.toFixed(3) : String(value);
      return `
        <div class="audit-row">
          <div class="audit-key">${label}</div>
          <div class="audit-bar">
            <span style="width:${Math.min(100, Math.abs(Number(value) || 0) * 10)}%"></span>
          </div>
          <div class="audit-value">${display}</div>
          <div class="audit-source">${source}</div>
        </div>
      `;
    })
    .join("");
  const ruleChips = rules.length
    ? rules.map((rule) => `<span class="audit-chip hit">${rule}</span>`).join("")
    : '<span class="audit-chip">无命中规则</span>';
  const calcRows = Object.entries(calc)
    .map(([key, value]) => {
      const display = typeof value === "number" ? value.toFixed(3) : String(value);
      return `<div class="audit-kv"><span>${key}</span><strong>${display}</strong></div>`;
    })
    .join("");
  container.innerHTML = `
    <div class="audit-head">${gate.id} · ${gate.name}</div>
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
    li.textContent = item.text;
    if (item.gateId) {
      li.dataset.gateId = item.gateId;
      li.classList.add("reason-link");
    }
    listContainer.appendChild(li);
  });
  notesContainer.innerHTML = notes.length ? notes.map((note) => `<div>${note}</div>`).join("") : "无";

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
  const fofSeries = buildSeries(sorted, (item) => item.output.fofScore / 100).map((item) => item.value);
  const priceSeries = buildSeries(sorted, (item) => item.input?.ethSpotPrice).map((item) => item.value);
  const volSeries = buildVolatilityBars(betaSeries);
  const allValues = [...betaSeries, ...confidenceSeries, ...fofSeries].filter(
    (value) => typeof value === "number"
  );
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const width = 520;
  const height = 170;
  const padding = 12;
  const betaPoints = buildPoints(betaSeries, width, height, padding, min, max);
  const confPoints = buildPoints(confidenceSeries, width, height, padding, min, max);
  const fofPoints = buildPoints(fofSeries, width, height, padding, min, max);
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
      <polyline points="${toPath(fofPoints)}" fill="none" stroke="#59d48f" stroke-width="2" />
      ${pricePoints.length ? `<polyline points="${toPath(pricePoints)}" fill="none" stroke="#8cb4ff" stroke-width="1.8" />` : ""}
      ${volBars}
      <circle cx="${betaPoints[activeIndex].x}" cy="${betaPoints[activeIndex].y}" r="3.5" fill="#e0b65b" />
      <circle cx="${confPoints[activeIndex].x}" cy="${confPoints[activeIndex].y}" r="3.5" fill="#60d6c2" />
      <circle cx="${fofPoints[activeIndex].x}" cy="${fofPoints[activeIndex].y}" r="3.5" fill="#59d48f" />
      ${pricePoints.length ? `<circle cx="${pricePoints[activeIndex].x}" cy="${pricePoints[activeIndex].y}" r="3" fill="#8cb4ff" />` : ""}
      ${eventMarks}
    </svg>
  `;
  if (legendContainer) {
    legendContainer.innerHTML = `
      <span><i class="dot" style="background:#e0b65b"></i>β</span>
      <span><i class="dot" style="background:#60d6c2"></i>置信度</span>
      <span><i class="dot" style="background:#59d48f"></i>FoF</span>
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

export function renderCoverage(container, input) {
  if (!container) return;
  const sources = input.__sources || {};
  const missing = new Set(input.__missing || []);
  container.innerHTML = coverageGroups
    .map((group) => {
      if (!group.keys.length) {
        return `
          <div class="coverage-section">
            <div class="coverage-title">${group.label}</div>
            <div class="coverage-empty">此分区无原始输入字段，仅输出结果。</div>
          </div>
        `;
      }
      const rows = group.keys
        .map((key) => {
          const meta = fieldMeta[key] || { label: key, unit: "", desc: "" };
          const value = input[key];
          const isMissing = missing.has(key) || value === null || value === undefined;
          const source = sources[key] || "来源缺失";
          return `
            <div class="coverage-row ${isMissing ? "missing" : "ok"}">
              <div class="coverage-cell key">
                <div class="coverage-label">${meta.label}</div>
                <div class="coverage-desc">${meta.desc || ""}</div>
              </div>
              <div class="coverage-cell value">
                ${isMissing ? "缺失" : formatCoverageValue(value)}
                <span class="coverage-unit">${meta.unit || ""}</span>
              </div>
              <div class="coverage-cell source">${source}</div>
              <div class="coverage-cell status">${isMissing ? "缺失" : "可用"}</div>
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
  elements.statusSub.textContent = output.reasonsTop3.map((item) => item.text).join(" · ") || "—";
  elements.betaValue.textContent = `${formatNumber(output.beta)} / ${formatNumber(output.betaCap)}`;
  elements.hedgeValue.textContent = output.hedge ? "ON" : "OFF";
  elements.phaseValue.textContent = output.phaseLabel;
  elements.confidenceValue.textContent = formatNumber(output.confidence);
  elements.extremeValue.textContent = output.extremeAllowed ? "是" : "否";
  elements.distributionValue.textContent = `${output.distributionGate} / 30D`;
  elements.lastRun.textContent = record.date;

  const action = buildActionSummary(output);

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
  const detailA = elements.statusDetailA;
  const detailB = elements.statusDetailB;
  const detailC = elements.statusDetailC;
  if (detailA && detailB && detailC) {
    [detailA, detailB, detailC].forEach((node) => node.classList.remove("active"));
    const current = state === "A" ? detailA : state === "B" ? detailB : detailC;
    current.classList.add("active");
    current.innerHTML = `
      <div class="detail-title">当前状态要点</div>
      <div class="detail-row"><span>建议动作</span><strong>${action.action}</strong></div>
      <div class="detail-row"><span>核心驱动</span><strong>${action.drivers.join(" / ") || "—"}</strong></div>
      <div class="detail-row"><span>风险阻断</span><strong>${action.blocks.join(" / ") || "无"}</strong></div>
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
      ? localStorage.getItem("eth_a_dashboard_ai_status_v1") || "AI 未连接"
      : "AI 未连接";
  const health = buildHealthSummary(record.input, { aiStatus });
  if (elements.healthFreshness) elements.healthFreshness.textContent = health.freshnessText;
  if (elements.healthMissing) elements.healthMissing.textContent = health.missingText;
  if (elements.healthProxy) elements.healthProxy.textContent = health.proxyText;
  if (elements.healthAi) elements.healthAi.textContent = health.aiText;

  if (elements.overviewAction) elements.overviewAction.textContent = action.action;
  if (elements.overviewActionHint) elements.overviewActionHint.textContent = action.detail;
  if (elements.overviewDrivers) elements.overviewDrivers.textContent = action.drivers.join(" · ") || "—";
  if (elements.overviewDriversHint)
    elements.overviewDriversHint.textContent = action.drivers.length ? "Top 驱动已标记" : "—";
  if (elements.overviewBlocks)
    elements.overviewBlocks.textContent = action.blocks.slice(0, 2).join(" · ") || "无";
  if (elements.overviewBlocksHint)
    elements.overviewBlocksHint.textContent = action.blocks.length ? "详见风险注记" : "无阻断";

  if (elements.actionSummary) elements.actionSummary.textContent = action.action;
  if (elements.actionDetail) elements.actionDetail.textContent = action.detail;
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
    if (elements.gateInspector) {
      const details = gate.details || {};
      const steps = details.steps && details.steps.length ? details.steps : ["读取输入", "计算阈值/得分", "应用规则"];
      const rules = details.rules && details.rules.length ? details.rules.join(" / ") : "无";
      elements.gateInspector.innerHTML = `
        <div class="inspector-title">${gate.id} · ${gate.name}</div>
        <div class="inspector-grid">
          ${renderKeyValueBlock("输入", details.inputs)}
          ${renderKeyValueBlock("来源", details.sources)}
          ${renderKeyValueBlock("计算", details.calc)}
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
  });
  if (elements.evidenceHints) {
    const hints = buildEvidenceHints(output);
    elements.evidenceHints.innerHTML = hints.map((item) => `<div>${item}</div>`).join("");
  }
  renderCoverage(elements.coverageList, record.input);

  const historySorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const betaSeries = historySorted.map((item) => item.output.beta);
  const confidenceSeries = historySorted.map((item) => item.output.confidence);
  const fofSeries = historySorted.map((item) => item.output.fofScore / 100);

  renderChart(elements.betaChart, betaSeries, "#e0b65b");
  renderChart(elements.confidenceChart, confidenceSeries, "#60d6c2");
  renderChart(elements.fofChart, fofSeries, "#59d48f");

  if (elements.workflowReplay) elements.workflowReplay.textContent = "可回放";
  if (elements.workflowRun) elements.workflowRun.textContent = "完成";
  if (elements.workflowValidate) elements.workflowValidate.textContent = "通过";
}
