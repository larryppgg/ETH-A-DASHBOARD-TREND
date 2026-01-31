# Gate & Status Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align “闸门链路”与“审计面板”同一水平位，并将审计面板可视化；精细化状态面板，仅展示当前状态内容并增加总览可视化。

**Architecture:** Rework layout into a two-column gate/audit row. Add a gate chain SVG component that mirrors audit selection. Enhance audit panel with visual widgets (input bars, rule chips). Refine status panel into state-specific content blocks plus a compact overview visualization.

**Tech Stack:** Vanilla JS, HTML/CSS, SVG, existing render functions, Node test runner.

---

### Task 1: Add failing layout tests for new sections

**Files:**
- Modify: `tests/run.mjs`

**Step 1: Write failing test**

```js
function testGateAuditLayoutIds() {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf-8");
  ["gateChain", "auditVisual", "statusOverview"].forEach((id) => {
    assert(html.includes(`id=\"${id}\"`), `布局应包含 ${id}`);
  });
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL for missing IDs.

---

### Task 2: Update HTML layout (gate chain + audit + status overview)

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`

**Step 1: Implement minimal layout**
- Add a new row: left `gateChain` (SVG container), right `auditVisual` (audit visualization).
- Ensure both are on the same row.
- Add `statusOverview` container inside status panel.

**Step 2: Run test**

Run: `npm test`  
Expected: PASS.

---

### Task 3: Gate chain visualization + audit sync

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/app.js`

**Step 1: Add failing test**

```js
function testGateChainHasNodes() {
  const container = createNode();
  renderGateChain(container, [{ id: "G0", status: "open", name: "宏观总闸门" }], "G0");
  assert(container.innerHTML.includes("G0"), "闸门链路应渲染节点");
}
```

**Step 2: Implement**
- Create `renderGateChain` for SVG nodes + connectors.
- Clicking node selects audit panel.
- Map statuses to colors (OPEN/WARN/CLOSED).

**Step 3: Run test**

Run: `npm test`  
Expected: PASS.

---

### Task 4: Audit panel visualization widgets

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/styles.css`

**Step 1: Add visual widgets**
- Input bar list (value vs threshold bar).
- Rule chips with hit/badge.
- Source chips.

**Step 2: Run tests**

Run: `npm test`

---

### Task 5: Status panel refinement + overview visual

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`

**Step 1: Add status overview visual**
- Compact state strength bar or tri-state indicator.
- Only show current state content blocks.

**Step 2: Run tests**

Run: `npm test`

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `npm test`  
Expected: All tests pass.

