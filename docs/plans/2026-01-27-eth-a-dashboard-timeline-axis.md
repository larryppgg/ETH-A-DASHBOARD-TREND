# Timeline Axis Full-Linked UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将仪表盘升级为时间轴主控的“全量联动”模式，并新增总趋势总览，实现全站快照随时间轴切换。

**Architecture:** 在现有 `history` 数据结构上新增时间轴索引与选中日期状态，所有渲染层以 `selectedDate` 对应的 record 为单一真源；新增时间轴总览组件 + 游标，驱动状态卡、闸门链路、审计、AI 与数据台同步切换。

**Tech Stack:** 原生 HTML/CSS/JS（ESM），现有 `src/app.js` + `src/ui/*.js` 渲染层。

### Task 1: 时间轴 UI 骨架与总趋势总览

**Files:**
- Modify: `src/index.html`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// 断言时间轴容器与游标存在
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL with missing element assertion

**Step 3: Write minimal implementation**

```html
<!-- index.html: timeline-overview / timeline-track / timeline-handle -->
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.html tests/run.mjs
git commit -m "feat: add timeline skeleton"
```

### Task 2: 时间轴样式与交互视觉

**Files:**
- Modify: `src/styles.css`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// 断言 timeline 相关 class 样式存在
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```css
/* timeline-overview / timeline-track / timeline-handle / timeline-marker */
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/styles.css tests/run.mjs
git commit -m "feat: add timeline visuals"
```

### Task 3: 时间轴数据模型与选中日期状态

**Files:**
- Create: `src/ui/timeline.js`
- Modify: `src/app.js`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
import { buildTimelineIndex, pickRecordByDate } from "../src/ui/timeline.js";

const history = [{ date: "2026-01-01" }, { date: "2026-01-02" }];
const idx = buildTimelineIndex(history);
assert(idx.dates.length === 2, "时间轴应生成日期索引");
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL with missing module/function

**Step 3: Write minimal implementation**

```js
// timeline.js: buildTimelineIndex / pickRecordByDate / nearestDate
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/timeline.js src/app.js tests/run.mjs
git commit -m "feat: timeline data model"
```

### Task 4: 全站渲染联动（快照游标）

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/app.js`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// renderOutput 应基于 selectedDate 渲染并标记当前日期
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// render.js: renderTimelineOverview / renderTimelineHandle
// app.js: selectedDate state + onTimelineChange
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/render.js src/app.js tests/run.mjs
git commit -m "feat: timeline full linkage"
```

### Task 5: 交互与容错

**Files:**
- Modify: `src/app.js`
- Modify: `src/ui/timeline.js`
- Modify: `src/ui/render.js`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```js
// tests/run.mjs
// 当 selectedDate 无记录时应显示空快照提示
```

**Step 2: Run test to verify it fails**

Run: `node tests/run.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// timeline.js: fallback to latest / nearest
// render.js: 空快照提示
```

**Step 4: Run test to verify it passes**

Run: `node tests/run.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/timeline.js src/ui/render.js src/app.js tests/run.mjs
git commit -m "feat: timeline empty snapshot handling"
```

### Task 6: 验证

**Files:**
- Test: `tests/run.mjs`

**Step 1: Run tests**

Run: `npm test`
Expected: PASS

**Step 2: Manual smoke**

Run: `npm run dev`
Expected: 时间轴拖动时全站数据联动，点击“返回最新”恢复最新快照
