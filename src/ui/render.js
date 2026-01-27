import { formatNumber } from "../utils.js";
import { fieldMeta, coverageGroups } from "./fieldMeta.js";
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

export function renderGates(container, inspector, gates) {
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
    });
    container.appendChild(item);
    nodes.push(item);
  });
  if (nodes[0]) nodes[0].classList.add("active");
  renderInspector(inspector, currentGate);
}

export function renderReasons(listContainer, notesContainer, reasons, notes, gateMap, gateList, inspector) {
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

  const aiStatus =
    typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
      ? localStorage.getItem("eth_a_dashboard_ai_status_v1") || "AI 未连接"
      : "AI 未连接";
  const health = buildHealthSummary(record.input, { aiStatus });
  if (elements.healthFreshness) elements.healthFreshness.textContent = health.freshnessText;
  if (elements.healthMissing) elements.healthMissing.textContent = health.missingText;
  if (elements.healthProxy) elements.healthProxy.textContent = health.proxyText;
  if (elements.healthAi) elements.healthAi.textContent = health.aiText;

  const action = buildActionSummary(output);
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
  renderGates(elements.gateList, elements.gateInspector, output.gates);
  const gateMap = new Map(output.gates.map((gate) => [gate.id, gate]));
  renderReasons(
    elements.topReasons,
    elements.riskNotes,
    output.reasonsTop3,
    output.riskNotes,
    gateMap,
    elements.gateList,
    elements.gateInspector
  );
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
