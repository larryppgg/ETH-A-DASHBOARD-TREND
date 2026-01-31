# Timeline ETH Tooltip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a hover tooltip on the timeline overview that displays ETH spot price with USD formatting and date.

**Architecture:** Add a lightweight tooltip DOM element inside the timeline panel. When hovering over the timeline SVG, compute the nearest index, read the ETH price from history for that date, and position the tooltip with formatted `$` price plus date.

**Tech Stack:** Vanilla JS, SVG, DOM events, Node test runner.

---

### Task 1: Add failing tests for tooltip label format

**Files:**
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
function testEthTooltipFormat() {
  const { formatUsd } = await import("../src/ui/formatters.js");
  assert(formatUsd(3456.78) === "$3,456.78", "USD 格式应带千分位与两位小数");
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL with “module not found” or wrong formatting.

---

### Task 2: Add formatter + tooltip DOM

**Files:**
- Create: `src/ui/formatters.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`

**Step 1: Implement formatter**

```js
export function formatUsd(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
```

**Step 2: Add tooltip container**
- Add `<div id="timelineTooltip" class="timeline-tooltip"></div>` under timeline overview.
- Style with dark panel, small mono font, and pointer-events none.

**Step 3: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 3: Wire hover logic for tooltip

**Files:**
- Modify: `src/app.js`
- Modify: `src/ui/render.js`
- Modify: `tests/run.mjs`

**Step 1: Write failing test**

```js
function testTooltipIncludesDateAndPrice() {
  const tooltip = createNode();
  tooltip.style = {};
  const history = [{ date: "2026-01-01", input: { ethSpotPrice: 3456.78 }, output: { beta: 0.3, confidence: 0.4, fofScore: 60, state: "B", extremeAllowed: false, distributionGate: 0, riskNotes: [] } }];
  const { buildTooltipText } = await import("../src/ui/formatters.js");
  const text = buildTooltipText(history[0]);
  assert(text.includes("2026-01-01"), "应包含日期");
  assert(text.includes("$3,456.78"), "应包含格式化价格");
}
```

**Step 2: Implement minimal logic**
- Add `buildTooltipText(record)` in `formatters.js`.
- In `app.js`, on `mousemove` over `timelineOverview`, compute index and update tooltip text + position.
- Hide tooltip on `mouseleave`.

**Step 3: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`  
Expected: All tests pass.

