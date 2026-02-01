# Run ETA Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show an ETA card for the full “今日运行” pipeline, estimated by summing live step timers (fetch + compute + AI).

**Architecture:** Add an ETA card UI block and a small timer module that tracks phase start/stop. Update the ETA display as phases complete, with final elapsed time on success or failure.

**Tech Stack:** Vanilla JS, DOM updates, Node test runner.

---

### Task 1: Add failing tests for ETA timer

**Files:**
- Modify: `tests/run.mjs`

**Step 1: Write failing test**

```js
function testEtaTimerTotals() {
  const { createEtaTimer } = await import("../src/ui/etaTimer.js");
  const timer = createEtaTimer();
  timer.start("fetch", 0);
  timer.end("fetch", 1000);
  timer.start("compute", 1000);
  timer.end("compute", 2500);
  const total = timer.totalMs();
  assert(total === 2500, "总耗时应为各阶段累加");
}
```

**Step 2: Run test**

Run: `npm test`  
Expected: FAIL (module not found).

---

### Task 2: Add ETA card UI

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`

**Step 1: Implement minimal card**
- Add a new card near status/health area: `id="etaCard"` and `id="etaValue"`.
- Style as small panel.

**Step 2: Run tests**

Run: `npm test`

---

### Task 3: Add timer module + wire into run flow

**Files:**
- Create: `src/ui/etaTimer.js`
- Modify: `src/app.js`
- Modify: `tests/run.mjs`

**Step 1: Implement timer**
- `createEtaTimer()` with `start(name, ts)`, `end(name, ts)`, `totalMs()`, `formatMs()`.

**Step 2: Wire into `runToday`**
- Start fetch timer before autoFetch, end after.
- Start compute timer before runPipeline, end after.
- Start AI timer before `runAi`, end when it resolves (or fail).
- Update ETA card in UI after each phase.

**Step 3: Run tests**

Run: `npm test`

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`  
Expected: All tests pass.

