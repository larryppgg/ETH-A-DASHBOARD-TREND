# ETH-A Dashboard Trend

本项目为本地可运行的策略仪表盘，覆盖宏观闸门、风险矩阵与趋势智能，支持自动抓取 + 手动输入 + 全链路可审计回溯。

---

## 功能概览

- **总览态势层**：当前档位、动作建议、核心驱动、风险阻断一屏可读
- **证据链层**：闸门链路 + Top3 触发原因 + 风险注记
- **深度审计层**：输入字段 → 来源 → 计算 → 规则命中
- **数据与运维层**：抓取 / 校验 / 运行 / 回放流程可视化
- **AI 解读**：异步分批生成 + 全局总结（豆包 API）

---

## 本地运行

推荐：
```bash
npm run dev
```
访问：`http://localhost:5173`

仅更新数据：
```bash
npm run fetch
```

备用方式：
```bash
bash scripts/dev.sh
```

---

## 测试
```bash
npm test
```

---

## 配置说明（.env）

复制 `.env.example` → `.env`，并填写：

```
DOUBAO_API_KEY=...
DOUBAO_MODEL=...
PROXY_PRIMARY=direct
PROXY_FALLBACK=direct
DOUBAO_DIRECT=true
DOH_URL=
```

字段说明：
- `DOUBAO_API_KEY`：豆包 Key
- `DOUBAO_MODEL`：模型名（如 doubao-seed-1-8-251228）
- `DOUBAO_DIRECT`：true 表示直连豆包；false 时使用代理池
- `PROXY_PRIMARY/PROXY_FALLBACK`：代理地址或 direct
- `DOH_URL`：可选 DNS over HTTPS（如需）

> 本仓库不会保存密钥，请仅在本地 `.env` 中维护。

---

## 数据源与可靠性

自动抓取主要来自：
- FRED（宏观）
- DefiLlama（稳定币 + CEX 储备 + RWA）
- CoinGecko（市场 + 价格结构）
- Coinglass（清算）
- Farside（ETF 流入流出）
- GDELT（分发闸门事件）

**ETF 数据兜底逻辑**：
- 若 Farside 直连被 Cloudflare 拦截 → 自动回退 Jina 代理抓取
- 若直连可用 → 同时用 Jina 校验差分
- 对“Total vs 组件合计”做一致性校验并记录

---

## AI 解读与全局总结（豆包）

- AI 请求异步分批发送
- 先返回先展示（无需等待全部完成）
- 新增“AI 全局总结”（对全量结果推断与预测）

提示：AI 生成失败时会保留已成功部分，并提示失败状态。

---

## 常见问题

### 1. 为什么出现“字段不完整”？
- 通常是自动抓取失败或手动输入不全
- 建议顺序：**自动抓取 → 校验 → 运行**

### 2. 手动输入如何跑通？
- 用“插入模板”生成结构
- 补齐所有字段 → 点击“应用并运行”

### 3. ETF 数据一直为 0？
- 可能是 Farside 直连受限
- 已启用 Jina 兜底抓取，建议重新运行 `npm run fetch`

---

## 目录说明

- `src/` 前端与逻辑核心
- `scripts/collector.py` 数据抓取
- `scripts/server.py` 本地服务 + AI 代理
- `docs/specs/` 规则与设计文档

---

## 版本

- **v2.0.1**：新增总览态势层、AI 异步解读、全局 AI 总结、ETF 抓取兜底与交叉验证。

---

## License

内部私有仓库使用，不公开发布。
