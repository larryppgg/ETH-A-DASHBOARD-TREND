export function buildSummaryPrompt(output, input) {
  return `你是资深交易研究员，请用“非术语、面向业务”的中文解释仪表盘结果，避免堆概念。\n\n` +
    `输出结果: ${JSON.stringify({
      state: output.state,
      beta: output.beta,
      betaCap: output.betaCap,
      hedge: output.hedge,
      phase: output.phaseLabel,
      confidence: output.confidence,
      extremeAllowed: output.extremeAllowed,
      modelRisk: output.modelRisk,
      execution: output.execution,
      reasons: output.reasonsTop3,
      riskNotes: output.riskNotes,
    })}\n\n` +
    `输入摘要: ${JSON.stringify({
      dxy5d: input.dxy5d,
      us2yWeekBp: input.us2yWeekBp,
      etf10d: input.etf10d,
      stablecoin30d: input.stablecoin30d,
      exchStableDelta: input.exchStableDelta,
      liquidationUsd: input.liquidationUsd,
    })}\n\n` +
    `输出格式要求：\n` +
    `1) 【总判断】一句话（<=20字）；\n` +
    `2) 【阶段】现在处于什么阶段（用人话解释）；\n` +
    `3) 【为什么】2-3条核心驱动（直接引用可观测指标/闸门）；\n` +
    `4) 【最大风险】1条最关键风险阻断；\n` +
    `5) 【执行约束】一句话说明漂移/交易成本是否限制仓位；\n` +
    `6) 【下一步盯】给1个最关键指标 + 触发阈值（若无精确阈值，用方向+相对强弱）；\n` +
    `6) 禁止空话，禁止免责声明，120-180字。`;
}

export function buildGatePrompt(gate) {
  const details = gate.details || {};
  return `你是风控分析师。解释以下闸门结论，要求“先结论、再依据、后动作”，必须使用人话。\n\n` +
    `闸门: ${gate.id} ${gate.name}\n` +
    `状态: ${gate.status}\n` +
    `说明: ${gate.note}\n` +
    `输入: ${JSON.stringify(details.inputs || {})}\n` +
    `输入时间: ${JSON.stringify(details.timings || {})}\n` +
    `计算: ${JSON.stringify(details.calc || {})}\n` +
    `规则: ${JSON.stringify(details.rules || [])}\n\n` +
    `输出格式（必须严格按5行，每行一个小节，使用以下标签）：\n` +
    `【结论】：一句话说明放行/预警/关闭。\n` +
    `【依据】：2条证据合并成一句，必须点名可观测指标（字段名+当前值）。\n` +
    `【动作】：1条可执行建议（增/减/等/对冲/观察触发条件）。\n` +
    `【反证】：1条反证条件（优先阈值；无精确阈值时写方向+强弱）。\n` +
    `【时效】：明确“时效通过”或“结论受限”，并点名衰减/过期字段。\n` +
    `总长度 90-150 字，禁止免责声明，禁止输出额外段落。`;
}

export function buildOverallPrompt(output, input) {
  return `你是资深交易研究主管。基于 AI仪表盘 2.0.1 的全量结果，直接给出判断、推断与预测，不要免责声明。\n\n` +
    `输出摘要: ${JSON.stringify({
      state: output.state,
      beta: output.beta,
      betaCap: output.betaCap,
      hedge: output.hedge,
      phase: output.phaseLabel,
      confidence: output.confidence,
      extremeAllowed: output.extremeAllowed,
      modelRisk: output.modelRisk,
      execution: output.execution,
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
    `1) 【主结论】先给一句话：现在更像什么行情 + 总体动作（<=25字）；\n` +
    `2) 【结构拆解】按宏观/流动性/杠杆/ETF/结构(SVC)/分发闸门/相位与三域，各用1句话说“对结果加分/减分”；\n` +
    `3) 【未来1-2周预测】至少2个情景：主场景/备选场景，并给出概率倾向（不用硬凑数字，写相对倾向也行）；\n` +
    `4) 【关键反证】2-3条，必须绑定可观测指标与触发阈值；\n` +
    `5) 【执行清单】仓位β、对冲、观察清单(3项以内) + 为什么。\n` +
    `6) 【执行限制】明确写出漂移门/交易成本是否限制动作。\n` +
    `字数 240-340 字。`;
}

export function buildFieldPrompt(field, context = {}) {
  const { output = {}, date = "" } = context;
  return `你是量化研究助手。请对单一指标做“当前含义解读”，目标读者是非技术用户。\n\n` +
    `日期: ${date}\n` +
    `指标字段: ${field.key}\n` +
    `指标名称: ${field.label}\n` +
    `指标说明: ${field.desc || "无"}\n` +
    `所属闸门: ${field.gate || "未知"}\n` +
    `当前值: ${field.value}\n` +
    `单位: ${field.unit || ""}\n` +
    `数据来源: ${field.source || "未知"}\n` +
    `字段观测时间: ${field.observedAt || "未知"}\n` +
    `字段抓取时间: ${field.fetchedAt || "未知"}\n` +
    `字段新鲜度: ${field.freshnessLabel || "未知"}\n` +
    `字段趋势: ${field.trend || "趋势样本不足"}\n` +
    `当前全局状态: ${JSON.stringify({
      state: output.state,
      beta: output.beta,
      betaCap: output.betaCap,
      confidence: output.confidence,
      reasons: output.reasonsTop3,
    })}\n\n` +
    `输出要求：\n` +
    `1) 【这代表什么】一句话解释当前值的含义；\n` +
    `2) 【影响】一句话说明对当前动作是加分/减分（结合所属闸门）；\n` +
    `3) 【时效】一句话说明新鲜度是否足够（新鲜/衰减/过期），并点名观测时间与抓取时间；\n` +
    `4) 【下一次观察】一句话给出最值得盯的变化方向或阈值；\n` +
    `5) 70-130字，禁止免责声明。`;
}
