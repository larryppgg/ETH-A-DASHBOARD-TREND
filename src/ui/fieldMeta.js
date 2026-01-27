export const fieldMeta = {
  dxy5d: { label: "美元指数 5D 涨幅", unit: "%", gate: "G0", desc: "衡量美元短期紧缩信号" },
  dxy3dUp: { label: "美元指数 3D 连涨", unit: "bool", gate: "G0", desc: "连续 3 日收涨触发紧缩" },
  us2yWeekBp: { label: "美债 2Y 周度变化", unit: "bp", gate: "G0", desc: "≥10bp 触发紧缩" },
  fciUpWeeks: { label: "FCI 连续上行周数", unit: "周", gate: "G0", desc: "≥2 周上行触发紧缩" },

  etf10d: { label: "ETF 10D 净流入", unit: "USD", gate: "V1/V5", desc: "资金面核心指标" },
  stablecoin30d: { label: "稳定币 30D 增减", unit: "%", gate: "V1", desc: "资金供血强弱" },
  exchStableDelta: { label: "交易所稳定币余额变化", unit: "USD", gate: "V1", desc: "交易所资金供给" },

  policyWindow: { label: "议息后观测窗口", unit: "bool", gate: "V2", desc: "重大政策后 2-3 交易日" },
  preMeeting2y: { label: "会前 2Y", unit: "%", gate: "V2", desc: "会前基准" },
  current2y: { label: "当前 2Y", unit: "%", gate: "V2", desc: "会后对比" },
  preMeetingDxy: { label: "会前 DXY", unit: "index", gate: "V2", desc: "会前基准" },
  currentDxy: { label: "当前 DXY", unit: "index", gate: "V2", desc: "会后对比" },

  crowdingIndex: { label: "杠杆拥挤度", unit: "score", gate: "V3", desc: "衍生品拥挤度指标" },
  liquidationUsd: { label: "全网清算额", unit: "USD", gate: "V3", desc: ">10亿触发 β-1/2" },
  longWicks: { label: "长下影线", unit: "bool", gate: "V3", desc: "诱空失败候选" },
  reverseFishing: { label: "反向钓鱼布局", unit: "bool", gate: "V3", desc: "提高风险权重" },
  shortFailure: { label: "空头失败雷达", unit: "bool", gate: "V3", desc: "反转置信度加成" },

  exchBalanceTrend: { label: "交易所余额趋势", unit: "USD", gate: "V4", desc: "卖墙是否变薄" },
  floatDensity: { label: "浮筹密度", unit: "ratio", gate: "V4", desc: "弹性与脆弱度" },
  mcapElasticity: { label: "市值-价格弹性", unit: "ratio", gate: "V4", desc: "虚涨告警" },
  mcapGrowth: { label: "市值增长", unit: "%", gate: "V4", desc: "泡沫结构输入" },

  etf5d: { label: "ETF 5D 净流入", unit: "USD", gate: "V5", desc: "连击风控" },
  etf1d: { label: "ETF 1D 净流入", unit: "USD", gate: "V5", desc: "极值与突破验证" },
  prevEtfExtremeOutflow: { label: "T-1 ETF 极值流出", unit: "bool", gate: "V5", desc: "次日预防性降 β" },
  volumeConfirm: { label: "成交量确认", unit: "bool", gate: "V5", desc: "突破验证必要条件" },

  rsdScore: { label: "RSD 结构分", unit: "0-10", gate: "V6.2", desc: "RWA/稳定币结构优势" },
  lstcScore: { label: "LSTC 结构分", unit: "0-10", gate: "V6.2", desc: "Blob/DA 价值捕获" },
  mappingRatioDown: { label: "映射/分发比走坏", unit: "bool", gate: "V6.2", desc: "结构红灯" },
  netIssuanceHigh: { label: "净通胀偏高", unit: "bool", gate: "V6.2", desc: "结构红灯" },

  cognitivePotential: { label: "认知势能", unit: "0-1", gate: "BE", desc: "相变候选因子" },
  liquidityPotential: { label: "流动性势能", unit: "0-1", gate: "BE", desc: "相变候选因子" },
  onchainReflexivity: { label: "链上反身性", unit: "0-1", gate: "BE", desc: "相变候选因子" },
  sentimentThreshold: { label: "情绪阈值", unit: "0-1", gate: "BE", desc: "对照阈值" },

  topo: { label: "拓扑流体", unit: "0-1", gate: "Tri", desc: "供需断裂/结构重构" },
  spectral: { label: "谱域谐振", unit: "0-1", gate: "Tri", desc: "周期能量集中" },
  roughPath: { label: "粗糙路径", unit: "0-1", gate: "Tri", desc: "尾部风险可控" },
  deltaES: { label: "ΔES", unit: "0-1", gate: "Tri", desc: "阈值 0.6" },

  trendMomentum: { label: "趋势动能", unit: "ratio", gate: "SC", desc: "相位判定因子" },
  divergence: { label: "背离强度", unit: "ratio", gate: "SC", desc: "相位判定因子" },

  distributionGateCount: { label: "分发闸门事件", unit: "count", gate: "DG", desc: "30D 内事件数" },

  rrpChange: { label: "RRP 变化", unit: "USD", gate: "D-ATAF", desc: "资金回收/释放" },
  tgaChange: { label: "TGA 变化", unit: "USD", gate: "D-ATAF", desc: "财政回笼/释放" },
  srfChange: { label: "SRF 变化", unit: "USD", gate: "D-ATAF", desc: "短期流动性" },
  ism: { label: "ISM 指数", unit: "index", gate: "D-ATAF", desc: "低权重周期代理" },
};

export const coverageGroups = [
  { id: "G0", label: "G0 宏观总闸门", keys: ["dxy5d", "dxy3dUp", "us2yWeekBp", "fciUpWeeks"] },
  { id: "V1", label: "V1 流动性总分", keys: ["etf10d", "stablecoin30d", "exchStableDelta"] },
  { id: "V2", label: "V2 Risk-ON", keys: ["policyWindow", "preMeeting2y", "current2y", "preMeetingDxy", "currentDxy"] },
  {
    id: "V3",
    label: "V3 杠杆结构与清算",
    keys: ["crowdingIndex", "liquidationUsd", "longWicks", "reverseFishing", "shortFailure"],
  },
  { id: "V4", label: "V4 卖墙与浮筹", keys: ["exchBalanceTrend", "floatDensity", "mcapElasticity", "mcapGrowth"] },
  { id: "V5", label: "V5 ETF 买墙与连击", keys: ["etf10d", "etf5d", "etf1d", "prevEtfExtremeOutflow", "volumeConfirm"] },
  { id: "V6.2", label: "V6.2 SVC 结构性价值捕获", keys: ["rsdScore", "lstcScore", "mappingRatioDown", "netIssuanceHigh"] },
  { id: "V7", label: "V7 买家阶段指标", keys: [] },
  { id: "V8", label: "V8 牛熊条件矩阵", keys: [] },
  { id: "HPM", label: "HPM 历史相位映射", keys: [] },
  { id: "SC", label: "SC 相位判定", keys: ["trendMomentum", "divergence"] },
  {
    id: "BE",
    label: "BE 相变判定",
    keys: ["cognitivePotential", "liquidityPotential", "onchainReflexivity", "sentimentThreshold"],
  },
  { id: "Tri", label: "三域扫描", keys: ["topo", "spectral", "roughPath", "deltaES"] },
  { id: "DG", label: "分发闸门", keys: ["distributionGateCount"] },
  { id: "D-ATAF", label: "D-ATAF", keys: ["rrpChange", "tgaChange", "srfChange", "ism"] },
];
