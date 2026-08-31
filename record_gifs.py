#!/usr/bin/env python3
"""Record demo GIFs for the README using the in-browser preview
(preview/index.html) via Playwright's video recording + ffmpeg.

Selectors verified against preview/render.js class names (tb-task-item,
tb-block, tb-nav-btn, tb-resize-handle, etc.) — the older
record_preview_gifs.py used stale selectors from an earlier UI.

Usage: python3 record_gifs.py
"""
import asyncio
import os
from playwright.async_api import async_playwright

REPO = os.path.dirname(os.path.abspath(__file__))
PREVIEW_URL = f"file://{REPO}/preview/index.html"
OUT_DIR = os.path.join(REPO, "docs/assets/demo")
os.makedirs(OUT_DIR, exist_ok=True)


def to_gif(raw_path, gif_path):
    cmd = (
        f"ffmpeg -y -i '{raw_path}' "
        f"-vf 'fps=15,scale=960:-1:flags=lanczos,split[s0][s1];"
        f"[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5' "
        f"'{gif_path}' -loglevel error"
    )
    os.system(cmd)
    if os.path.exists(gif_path):
        size = os.path.getsize(gif_path) / 1024 / 1024
        print(f"  saved {os.path.basename(gif_path)} ({size:.2f} MB)")
    else:
        print(f"  FAILED to create {gif_path}")


async def record_one(browser, name, action_fn, wait_before=1.0, wait_after=1.2):
    """Open a fresh context/page (so each clip starts from the same reset
    demo state), run action_fn(page), save the video, convert to gif."""
    context = await browser.new_context(
        viewport={"width": 1400, "height": 900},
        record_video_dir=OUT_DIR,
        record_video_size={"width": 1400, "height": 900},
    )
    page = await context.new_page()
    await page.goto(PREVIEW_URL)
    await page.wait_for_load_state("networkidle")
    await page.wait_for_selector(".tb-root", timeout=10000)
    # Fresh demo state every recording
    await page.evaluate("localStorage.removeItem('time-blocks-preview')")
    await page.reload()
    await page.wait_for_selector(".tb-root", timeout=10000)
    await asyncio.sleep(wait_before)

    await action_fn(page)

    await asyncio.sleep(wait_after)
    video = page.video
    await context.close()  # video finalizes on close
    raw_path = os.path.join(OUT_DIR, f"raw-{name}.webm")
    await video.save_as(raw_path)
    gif_path = os.path.join(OUT_DIR, f"{name}.gif")
    to_gif(raw_path, gif_path)
    os.remove(raw_path)


async def drag_drop(page):
    task = page.locator(".tb-task-item").first
    box = await task.bounding_box()
    target = page.locator(".tb-day-col").nth(1).locator(".tb-slots")  # Tuesday
    tbox = await target.bounding_box()
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    await page.mouse.down()
    await asyncio.sleep(0.3)
    await page.mouse.move(tbox["x"] + tbox["width"] / 2, tbox["y"] + 120, steps=20)
    await asyncio.sleep(0.3)
    await page.mouse.up()


async def resize_block(page):
    block = page.locator(".tb-block").first
    await block.scroll_into_view_if_needed()
    handle = block.locator(".tb-resize-handle")
    box = await handle.bounding_box()
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    await page.mouse.down()
    await asyncio.sleep(0.3)
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 150, steps=20)
    await asyncio.sleep(0.3)
    await page.mouse.up()


async def week_nav(page):
    next_btn = page.get_by_role("button", name="Next →")
    today_btn = page.get_by_role("button", name="Today")
    await next_btn.click()
    await asyncio.sleep(0.6)
    await next_btn.click()
    await asyncio.sleep(0.6)
    await today_btn.click()
    await asyncio.sleep(0.5)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        print("Recording drag-drop.gif")
        await record_one(browser, "drag-drop", drag_drop)

        print("Recording resize-block.gif")
        await record_one(browser, "resize-block", resize_block)

        print("Recording week-nav.gif")
        await record_one(browser, "week-nav", week_nav)

        await browser.close()
        print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
