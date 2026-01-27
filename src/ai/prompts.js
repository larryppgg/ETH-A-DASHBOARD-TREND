export function buildSummaryPrompt(output, input) {
  return `你是资深交易研究员。根据以下仪表盘结果给出中文摘要：\n\n` +
    `输出结果: ${JSON.stringify({
      state: output.state,
      beta: output.beta,
      betaCap: output.betaCap,
      hedge: output.hedge,
      phase: output.phaseLabel,
      confidence: output.confidence,
      extremeAllowed: output.extremeAllowed,
      reasons: output.reasonsTop3,
    })}\n\n` +
    `输入摘要: ${JSON.stringify({
      dxy5d: input.dxy5d,
      us2yWeekBp: input.us2yWeekBp,
      etf10d: input.etf10d,
      stablecoin30d: input.stablecoin30d,
      exchStableDelta: input.exchStableDelta,
      liquidationUsd: input.liquidationUsd,
    })}\n\n` +
    `要求: 1) 总结当前状态与风险暴露; 2) 解释Top3原因; 3) 给出1条关注点。字数120-180字。`;
}

export function buildGatePrompt(gate) {
  const details = gate.details || {};
  return `你是风控分析师。解释以下闸门的输出含义，说明输入与规则命中。\n\n` +
    `闸门: ${gate.id} ${gate.name}\n` +
    `状态: ${gate.status}\n` +
    `说明: ${gate.note}\n` +
    `输入: ${JSON.stringify(details.inputs || {})}\n` +
    `计算: ${JSON.stringify(details.calc || {})}\n` +
    `规则: ${JSON.stringify(details.rules || [])}\n\n` +
    `要求: 1) 解释本闸门结论; 2) 若有风险提醒请标明; 3) 80-120字。`;
}

export function buildOverallPrompt(output, input) {
  return `你是资深交易研究主管。基于 AI仪表盘 2.0.1 的全量结果，直接给出最真实的判断、推断与预测，不需要任何风险提示或免责声明。\n\n` +
    `输出摘要: ${JSON.stringify({
      state: output.state,
      beta: output.beta,
      betaCap: output.betaCap,
      hedge: output.hedge,
      phase: output.phaseLabel,
      confidence: output.confidence,
      extremeAllowed: output.extremeAllowed,
      reasons: output.reasonsTop3,
      riskNotes: output.riskNotes,
    })}\n\n` +
    `输入关键项: ${JSON.stringify({
      dxy5d: input.dxy5d,
      us2yWeekBp: input.us2yWeekBp,
      etf10d: input.etf10d,
      stablecoin30d: input.stablecoin30d,
      exchStableDelta: input.exchStableDelta,
      liquidationUsd: input.liquidationUsd,
      distributionGateCount: input.distributionGateCount,
      trendMomentum: input.trendMomentum,
      divergence: input.divergence,
    })}\n\n` +
    `输出要求:\n` +
    `1) 用 3-4 句总结当前结构（宏观/流动性/杠杆/ETF/情绪/分发闸门/三域）;\n` +
    `2) 给出未来 1-2 周主要走势情景与概率倾向;\n` +
    `3) 指出 2-3 条关键反证条件（触发条件写清楚）;\n` +
    `4) 给出可执行的仓位/对冲/观察点建议。\n` +
    `字数 220-320 字。`;
}
