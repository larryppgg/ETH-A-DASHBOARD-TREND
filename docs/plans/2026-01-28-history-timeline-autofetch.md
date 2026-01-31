# History Timeline Autofetch (365d) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 365-day timeline slider and date selector that auto-fetches missing historical data, runs the pipeline, and persists results.

**Architecture:** Frontend provides a date slider tied to a fixed 365-day window and a date picker. When a date is selected, the app checks local history; if missing, it calls a new backend endpoint that runs the collector with a target date, returns normalized input/output, and persists a new history record. The UI updates immediately after the fetch completes.

**Tech Stack:** Vanilla JS, localStorage, Python `http.server`, `scripts/collector.py` with date support, Node test runner.

---

### Task 1: Add failing tests for history date selection + fetch path

**Files:**
- Modify: `tests/run.mjs`

**Step 1: Write the failing test (history range mapping with date window)**

```js
function testHistoryWindowDateRange() {
  const now = new Date("2026-01-28T00:00:00Z");
  const { buildDateWindow } = await import("../src/ui/historyWindow.js");
  const { dates, latest } = buildDateWindow(now, 365);
  assert(dates.length === 365, "历史窗口应为 365 天");
  assert(latest === "2026-01-28", "窗口最新日期应为 today");
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL with “module not found” or assertion failure.

---

### Task 2: Add date window utilities

**Files:**
- Create: `src/ui/historyWindow.js`
- Modify: `tests/run.mjs`

**Step 1: Write minimal implementation**

```js
export function buildDateWindow(today, days) {
  const result = [];
  const base = new Date(today);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(key);
  }
  return { dates: result, latest: result[result.length - 1] || null };
}
```

**Step 2: Run test to verify it passes**

Run: `npm test`  
Expected: PASS on the new test.

---

### Task 3: Backend: add history fetch endpoint + collector date support

**Files:**
- Modify: `scripts/collector.py`
- Modify: `scripts/server.py`
- Test: `tests/collector_test.py`

**Step 1: Write failing test**

Add test for `collector.py` date mode:
```python
def test_collect_with_date():
    payload = run_collector_for_date("2026-01-01")
    assert payload["data"]
    assert payload["generatedAt"]
```

**Step 2: Implement minimal date support**
- `collector.py`: accept `--date YYYY-MM-DD` and pass to all date-dependent fetchers (FRED/DefiLlama/etc). If a source cannot serve historical data, mark it in `missing` and `errors`.
- Output includes `targetDate` in payload.

**Step 3: Add server endpoint**
- `server.py`: `POST /data/history` with body `{ "date": "YYYY-MM-DD" }`
- Run collector in subprocess with `--date`, read `src/data/auto.json`, return `{ input, sources, missing, errors, generatedAt }`

**Step 4: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 4: Frontend: date slider + date picker + auto-fetch flow

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Modify: `src/ui/render.js`
- Modify: `tests/run.mjs`

**Step 1: Add failing tests**

```js
function testHistorySelectAutoFetchStub() {
  // Ensure handler triggers fetch when record missing
  assert(typeof window.__fetchHistory__ === "function", "应暴露历史抓取函数");
}
```

**Step 2: Implement minimal UI**
- Add a second slider under timeline for “历史日期轴”（365 天窗口）
- Add a date input (YYYY-MM-DD) aligned with slider

**Step 3: Implement auto-fetch behavior**
- On slider/date change:
  - if history has date: render snapshot
  - else: call `/data/history` and persist result, then render
- Ensure “抓取中…” status and failure fallback

**Step 4: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `npm test`  
Expected: All tests pass.

