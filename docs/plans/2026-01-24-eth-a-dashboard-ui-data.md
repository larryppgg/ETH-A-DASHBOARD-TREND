# ETH-A Dashboard UI/Data Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构 UI 以增强审计可视化与交互体验，并扩展真实数据抓取与覆盖提示，保证一键运行可用。

**Architecture:** 前端为纯静态模块（HTML/CSS/ESM），逻辑在 `src/app.js` 与 `src/ui/render.js`。数据由 `scripts/collector.py` 抓取写入 `src/data/auto.json`，前端读取后渲染并存历史。

**Tech Stack:** HTML/CSS/ESM + Python3 collector + Node test runner.

### Task 1: 审计交互修复 + 视觉重构

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```javascript
function testRenderOutputInspector() {
  // Click reason item should jump inspector to gate.
  // Expect: gateInspector contains gate id after click.
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `gateMap.get is not a function`

**Step 3: Write minimal implementation**

```javascript
const gateMap = new Map(output.gates.map((gate) => [gate.id, gate]));
renderReasons(..., gateMap, elements.gateList, elements.gateInspector);
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/render.js src/index.html src/styles.css tests/run.mjs
git commit -m "feat: improve gate audit UI and interactions"
```

### Task 2: 数据覆盖矩阵 + 一键运行优化

**Files:**
- Modify: `src/app.js`
- Modify: `src/ui/render.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Test: `tests/run.mjs`

**Step 1: Write the failing test**

```javascript
function testRenderOutputInspector() {
  // Add coverage render call; verify no exceptions and inspector updates.
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL until renderCoverage is wired

**Step 3: Write minimal implementation**

```javascript
export function renderCoverage(container, input) { /* render rows */ }
renderCoverage(elements.coverageList, record.input);
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app.js src/ui/render.js src/index.html src/styles.css tests/run.mjs
git commit -m "feat: add coverage matrix and one-click auto fetch"
```

### Task 3: 数据抓取稳健性与去估算

**Files:**
- Modify: `scripts/collector.py`
- Modify: `tests/collector_test.py`
- Modify: `package.json`

**Step 1: Write the failing test**

```python
def test_main_skips_exchange_proxy():
    # exchange_proxy should not be called
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL until exchange_proxy removed from main

**Step 3: Write minimal implementation**

```python
data, sources, missing = merge(macro, stable, etf, market, liquidation, cex, klines)
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/collector.py tests/collector_test.py package.json
git commit -m "fix: harden collector and remove estimated exchange proxy"
```

---

Plan complete and saved to `docs/plans/2026-01-24-eth-a-dashboard-ui-data.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
