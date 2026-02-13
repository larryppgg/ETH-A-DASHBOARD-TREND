#!/usr/bin/env python3
"""Capture key section screenshots for README using Playwright.

We intentionally screenshot specific sections (not full-page) to keep README readable.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://etha.mytagclash001.help/"

SECTIONS = {
    "decision": "#decisionPanel",
    "action": "#actionPanel",
    "timeline": "#timelinePanel",
    "audit": "#gateAuditPanel",
    "coverage": "#coverageFold",
    "eval": "#evalPanelSection",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out-dir", default="docs/screenshots")
    ap.add_argument("--viewport", default="1440x900")
    ap.add_argument("--wait-ms", type=int, default=3500)
    ap.add_argument(
        "--sections",
        default="decision,audit,coverage",
        help="comma-separated keys: " + ",".join(SECTIONS.keys()),
    )
    args = ap.parse_args()

    vp = args.viewport.lower().split("x")
    if len(vp) != 2:
        raise SystemExit("invalid --viewport, expected like 1440x900")
    width, height = int(vp[0]), int(vp[1])

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    wanted = [s.strip() for s in args.sections.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in SECTIONS]
    if unknown:
        raise SystemExit(f"unknown sections: {unknown}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": width, "height": height})
        page = ctx.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        # Avoid networkidle (long-polling/websocket). Give hydration time.
        page.wait_for_timeout(args.wait_ms)

        for key in wanted:
            sel = SECTIONS[key]
            locator = page.locator(sel)
            locator.wait_for(state="visible", timeout=30_000)
            # Scroll so sticky headers don't occlude.
            locator.scroll_into_view_if_needed(timeout=10_000)
            page.wait_for_timeout(250)
            out_path = out_dir / f"section-{key}.png"
            locator.screenshot(path=str(out_path))
            print(out_path)

        browser.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
