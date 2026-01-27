# ETH-A Dashboard v2.0.1 UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 全量升级仪表盘的信息架构、视觉层级与可审计体验，完整实现“总览态势 → 证据链 → 深度审计 → 数据与运维”的金融终端体验。

**Architecture:** 在现有 HTML/CSS/JS 单页结构上重排布局与组件，新增“全局健康条、总览卡、行动建议、反证条件、数据工作流与AI流水线”等模块，并补齐数据流与状态提示。

**Tech Stack:** 原生 HTML/CSS/JS（ESM），现有 `src/app.js` + `src/ui/*.js` 渲染层。

### Task 1: 信息架构与骨架重排

**Files:**
- Modify: `src/index.html`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// 断言新布局容器存在（概念性，后续实现）
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL with missing element assertion

**Step 3: Write minimal implementation**

```html
<!-- index.html 新增区域：global health bar / overview / action / evidence / workflow -->
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.html tests/run.mjs
git commit -m "feat: restructure dashboard layout"
```

### Task 2: 视觉体系与组件样式

**Files:**
- Modify: `src/styles.css`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// 断言关键 class 样式存在（通过字符串匹配）
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```css
/* 新增：health bar / overview cards / gate chain / workflow / ai pipeline 样式 */
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/styles.css tests/run.mjs
git commit -m "feat: add terminal-grade visual system"
```

### Task 3: 新增 UI 数据摘要与映射逻辑

**Files:**
- Create: `src/ui/summary.js`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
import { buildHealthSummary, buildActionSummary } from "../src/ui/summary.js";

const health = buildHealthSummary({ __missing: ["dxy5d"], __errors: ["x"] });
assert(health.level === "warn", "健康摘要应识别缺失字段");
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL with missing module/function

**Step 3: Write minimal implementation**

```js
// summary.js 提供：健康摘要、行动建议、反证条件、缺失影响映射
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/summary.js tests/run.mjs
git commit -m "feat: add summary builders for dashboard"
```

### Task 4: 渲染层升级（总览/闸门链路/证据/趋势标记）

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/index.html`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// renderOutput 后应填充 overview/action/evidence 容器
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// render.js: renderOverview/renderHealth/renderGateChain/renderEvidence/renderWorkflow
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/render.js src/index.html tests/run.mjs
git commit -m "feat: overhaul render layer"
```

### Task 5: 数据流完善（抓取/校验/运行/追溯）

**Files:**
- Modify: `src/app.js`
- Modify: `src/inputPolicy.js`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// autoFetch 应带 __generatedAt/__proxyTrace 供健康条使用
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// app.js: autoFetch 合并 __generatedAt/__proxyTrace
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app.js src/inputPolicy.js tests/run.mjs
git commit -m "feat: enrich data flow metadata"
```

### Task 6: AI 解读流水线与状态提示

**Files:**
- Modify: `src/ui/ai.js`
- Modify: `src/styles.css`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// renderAiPanel 应输出阶段状态与失败提示
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// ai.js: 增加状态徽章 + 重试提示容器
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/ai.js src/styles.css tests/run.mjs
git commit -m "feat: ai pipeline statuses"
```

### Task 7: 全量验收与手动验证

**Files:**
- Modify: `src/data/auto.json` (generated)

**Step 1: Run data fetch**

Run: `python3 scripts/collector.py`
Expected: `src/data/auto.json` 更新，missing/errors 为空

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Manual smoke**

Run: `npm run dev`
Expected: 访问 `http://localhost:5173`，确认总览卡/健康条/闸门链路/AI流水线/数据工作流全部渲染并可交互

**Step 4: Commit**

```bash
git add src/data/auto.json
git commit -m "chore: refresh auto data"
```

---

## Addendum (2026-01-27): Async AI + Global Summary + ETF Crawler Fallback

### Task 8: AI 异步请求与分批展示

**Files:**
- Modify: `src/app.js`
- Modify: `src/ui/ai.js`
- Modify: `src/styles.css`
- Modify: `scripts/server.py`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// renderAiPanel 应识别 gate status 并渲染总体 summary
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// app.js: 并发请求 /ai/summary /ai/gate /ai/overall\n// server.py: 增加 /ai/gate /ai/overall 端点\n```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

### Task 9: 全局 AI 总结提示词

**Files:**
- Modify: `src/ai/prompts.js`
- Modify: `src/ai/payload.js`
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// buildOverallPrompt 应生成含“结论/推断/预测”的提示
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// prompts.js: buildOverallPrompt\n// payload.js: overall prompt\n```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

### Task 10: ETF 数据抓取兜底与交叉校验

**Files:**
- Modify: `scripts/collector.py`
- Modify: `tests/collector_test.py`

**Step 1: Write the failing test**

```py
# tests/collector_test.py
# 当 farside 直连失败时应回退到 Jina 代理抓取
```

**Step 2: Run test to verify it fails**

Run: `python3 tests/collector_test.py`
Expected: FAIL

**Step 3: Write minimal implementation**

```py
# collector.py: 尝试 direct -> jina 代理, 并在双源可用时进行差值校验\n```

**Step 4: Run test to verify it passes**

Run: `python3 tests/collector_test.py`
Expected: PASS
