export function renderAiStatus(container, status) {
  if (!container) return;
  container.textContent = status;
}

export function renderAiPanel(container, payload) {
  if (!container) return;
  if (!payload) {
    container.innerHTML = "<div class=\"ai-empty\">AI 解读未生成</div>";
    return;
  }
  const summaryStatus = payload.summaryStatus || "pending";
  const overallStatus = payload.overallStatus || "pending";
  const gateBlocks = (payload.gates || [])
    .map(
      (gate) => `
        <div class="ai-gate">
          <div class="ai-gate-title">
            <span>${gate.id} · ${gate.name}</span>
            <span class="ai-state ${gate.status || "pending"}">${gate.status || "pending"}</span>
          </div>
          <div class="ai-gate-body">${gate.text || "生成中..."}</div>
        </div>
      `
    )
    .join("");
  container.innerHTML = `
    <div class="ai-summary">
      <div class="ai-summary-title">逐指标解读位置</div>
      <div class="ai-summary-body">每个指标的 AI 解读已移动到下方“数据覆盖矩阵”对应指标行内。</div>
    </div>
    <div class="ai-summary">
      <div class="ai-summary-title">总览解读</div>
      <div class="ai-summary-body">
        <span class="ai-state ${summaryStatus}">${summaryStatus}</span>
        ${payload.summary || "生成中..."}
      </div>
    </div>
    <div class="ai-summary ai-overall">
      <div class="ai-summary-title">AI 全局总结</div>
      <div class="ai-summary-body">
        <span class="ai-state ${overallStatus}">${overallStatus}</span>
        ${payload.overall || "生成中..."}
      </div>
    </div>
    <div class="ai-gates">${gateBlocks}</div>
  `;
}
