## 架构选择
- 纯前端单页应用（HTML/CSS/JS），本地服务器启动即可运行。
- 数据仅支持手动输入或导入，运行历史保存在浏览器 localStorage。

## 模块划分
- data/input：手动输入与校验。
- engine/pipeline：按顺序执行 G0→V1→...→Action Mapping。
- engine/rules：硬规则与修正规则集合。
- ui/render：状态面板、闸门链路、趋势图、看板列。

## 数据结构（简化）
- RunInput: 宏观/流动性/ETF/杠杆/供给/结构性等原始指标
- RunOutput:
  - state (A/B/C)
  - beta, betaCap
  - hedge (on/off)
  - phaseLabel, phaseConfidence
  - extremePositionAllowed
  - reasonsTop3[]
  - gateResults[] (按顺序记录)
  - trendSignals (FoF, risk, etc.)

## 关键规则落地（摘要）
- G0：任一信号触发 → 宏观关门；≥2 直接切 C。
- V1：FoF 低于阈值 → 流动性红灯。
- V3：杠杆拥挤+ETF10D≤0 → β-1/3；清算>10亿 → β-1/2。
- V5：ETF 5D 红灯 → 风险升级；单日极值流出 → 次日 β-20%。
- V6：ETF5D红灯 + FoF红灯 + 宏观关门 → 直切 C + 轻对冲。
- V6.2：SVC 结构分数 → β_cap 与置信度修正；结构红灯并入危险信号。
- BE + 三域 + ΔES≤0.6 + 结构强分数 → 极限重仓许可。

## 可解释性与审计
- 每个闸门可展开查看输入、阈值、计算、规则命中。
- Top3 原因可定位到对应闸门。
- 输出记录可导出 JSON/CSV 供审计复盘。

## 视觉方向
- “金融战情室”风格：深色背景 + 金属质感 + 大标题 + 高对比状态色。
- 强调看板列与闸门顺序的视觉指向性。
- 动画：页面首屏渐入 + 卡片轻微漂浮 + 运行时高亮。
