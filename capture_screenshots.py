#!/usr/bin/env python3
"""Recreate the README screenshots for obsidian-time-blocks using the
in-browser preview (preview/index.html) driven by Playwright.

Usage: python3 capture_screenshots.py
Requires: pip install playwright && playwright install chromium
"""
import os
import time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.abspath(__file__))
PREVIEW_URL = f"file://{REPO}/preview/index.html"
OUT_DIR = os.path.join(REPO, "docs/assets/screenshots")
os.makedirs(OUT_DIR, exist_ok=True)

VIEWPORT = {"width": 1600, "height": 1000}


def shot(page, name, selector=None, padding=0):
    path = os.path.join(OUT_DIR, f"{name}.png")
    if selector:
        el = page.locator(selector).first
        el.scroll_into_view_if_needed()
        el.screenshot(path=path)
    else:
        page.screenshot(path=path)
    size = os.path.getsize(path) / 1024
    print(f"  saved {name}.png ({size:.0f} KB)")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=2,
        )
        page = context.new_page()

        print("Loading preview...")
        page.goto(PREVIEW_URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector(".tb-root", timeout=10000)
        time.sleep(1)

        # Reset to known demo state each run
        page.evaluate("localStorage.removeItem('time-blocks-preview')")
        page.reload()
        page.wait_for_selector(".tb-root", timeout=10000)
        time.sleep(1)

        # 1. Full weekly grid with backlog + colored blocks
        print("01-weekly-grid.png")
        shot(page, "01-weekly-grid")

        # 2. Backlog sidebar zoomed in (priority emojis + tag chips)
        print("02-backlog-sidebar.png")
        shot(page, "02-backlog-sidebar", selector=".tb-sidebar")

        # 3. Day view — try toggling if a control exists, else fall back to
        # a cropped view of a single day column.
        print("03-day-view.png")
        day_toggle = page.locator(".day-view-toggle, [aria-label*='Day view' i]")
        if day_toggle.count() > 0:
            day_toggle.first.click()
            time.sleep(0.5)
            shot(page, "03-day-view")
        else:
            # Fallback: capture main grid area cropped to first day column
            shot(page, "03-day-view", selector=".tb-main")

        # 4. Settings / custom query panel — preview app doesn't ship the
        # Obsidian settings modal, so document that limitation and instead
        # capture the filter bar (closest in-preview analog: query/filter UI).
        print("04-custom-query.png")
        filter_bar = page.locator(".tb-filter-bar")
        if filter_bar.count() > 0:
            shot(page, "04-custom-query", selector=".tb-sidebar")
        else:
            shot(page, "04-custom-query")

        # 5. GCal sync — grid already has gcal-sourced blocks (source: gcal)
        # per the seed data (b4 'Design review (GCal)', b7 'Retrospective').
        print("05-gcal-sync.png")
        shot(page, "05-gcal-sync", selector=".tb-main")

        browser.close()
        print("Done.")


if __name__ == "__main__":
    main()
