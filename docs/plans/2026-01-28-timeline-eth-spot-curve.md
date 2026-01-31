# Timeline ETH Spot Curve Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ETH spot price as a new curve in the timeline overview chart.

**Architecture:** Extend data collection to expose a per-snapshot ETH spot price (from CoinGecko), persist it with each history record, and render a new polyline + legend item in the timeline overview SVG. Use existing series builder utilities for consistent scaling.

**Tech Stack:** Vanilla JS, Python collector, SVG rendering, Node test runner.

---

### Task 1: Add failing tests for ETH price series

**Files:**
- Modify: `tests/run.mjs`

**Step 1: Write the failing test**

```js
function testTimelineIncludesEthPriceSeries() {
  const history = [
    { date: "2026-01-01", input: { ethSpotPrice: 2000 }, output: { beta: 0.3, confidence: 0.4, fofScore: 0.5 } },
    { date: "2026-01-02", input: { ethSpotPrice: 2100 }, output: { beta: 0.4, confidence: 0.5, fofScore: 0.6 } },
  ];
  const series = buildSeries(history, (item) => item.input.ethSpotPrice);
  assert(series[0].value === 2000, "ETH 价格序列应来自 input.ethSpotPrice");
}
```

**Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL if series not wired or missing.

---

### Task 2: Extend collector output with ETH spot price

**Files:**
- Modify: `scripts/collector.py`
- Test: `tests/collector_test.py`

**Step 1: Write failing test**

```python
def test_eth_spot_price_present():
    data, sources, missing = collector.fetch_coingecko_market()
    assert "ethSpotPrice" in data
```

**Step 2: Implement minimal change**
- In `fetch_coingecko_market`, add `ethSpotPrice` using CoinGecko `current_price.usd` or history API `market_data.current_price.usd` when `--date` is passed.
- Add source label `"ethSpotPrice": "CoinGecko: current_price.usd"`.

**Step 3: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 3: Render ETH price curve in timeline overview

**Files:**
- Modify: `src/ui/render.js`
- Modify: `src/styles.css`
- Modify: `src/index.html` (legend entry)

**Step 1: Write failing test**

```js
function testTimelineLegendHasEthPrice() {
  const legend = createNode();
  renderTimelineOverview(createNode(), legend, [], null);
  assert(legend.innerHTML.includes("ETH 现货"), "时间轴图例应包含 ETH 现货");
}
```

**Step 2: Implement minimal UI changes**
- Add ETH spot series to `renderTimelineOverview` and draw polyline with distinct color.
- Add legend dot for ETH 现货.

**Step 3: Run tests**

Run: `npm test`  
Expected: PASS.

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`  
Expected: All tests pass.

