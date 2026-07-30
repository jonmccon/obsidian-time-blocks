# Time Blocks — Asset Creation Guide

How to produce the screenshots and animated GIFs used in README.md.

## Requirements

- macOS with Obsidian installed and Time Blocks plugin enabled
- `ffmpeg` (`brew install ffmpeg`)
- The vault at `~/Documents/obm-cloud-lab` open in Obsidian
- A few real tasks in the vault with due dates and priorities set

---

## Screenshot checklist

Capture all screenshots at **2× retina** (System Settings → Displays → More Space or Retina resolution).
Use the Obsidian light theme for screenshots unless dark is already your default.

| File | What to capture | Notes |
|---|---|---|
| `docs/assets/screenshots/01-weekly-grid.png` | Full weekly view with backlog + 4–6 colored blocks on the grid | Make sure current-time indicator is visible |
| `docs/assets/screenshots/02-backlog-sidebar.png` | Backlog panel zoomed in — show tasks with priority emojis and tags | Show both filtered and unfiltered states |
| `docs/assets/screenshots/03-day-view.png` | Day view in right sidebar alongside a note | Show resize handle and block details |
| `docs/assets/screenshots/04-custom-query.png` | Settings panel open to Custom Query section | Show example query text |
| `docs/assets/screenshots/05-gcal-sync.png` | Grid with GCal overlay events (blue) + task blocks (purple) | After a sync, show both block types |

**macOS screenshot tool:**
```bash
# Full screen to clipboard (then paste into image editor for crop)
cmd + shift + 4

# Window only
cmd + shift + 4, then spacebar, click window

# Or use screencapture CLI:
screencapture -x -w docs/assets/screenshots/01-weekly-grid.png
```

---

## Animated GIF checklist

GIFs show the interactions that make the plugin compelling.

| File | What to record | Duration |
|---|---|---|
| `docs/assets/demo/drag-drop.gif` | Drag task from backlog → drop on Tuesday 10am → block appears | ~5 sec |
| `docs/assets/demo/resize-block.gif` | Drag bottom edge of a block to extend it from 30min to 1h | ~4 sec |
| `docs/assets/demo/week-nav.gif` | Click forward week → back to today | ~3 sec |
| `docs/assets/demo/tag-filter.gif` | Click a tag chip in backlog → list filters instantly | ~4 sec |
| `docs/assets/demo/day-view.gif` | Open day view in right sidebar, navigate days | ~5 sec |

---

## Recording a GIF (macOS → ffmpeg pipeline)

### Step 1 — Record screen with QuickTime or screencapture

**Option A: QuickTime**
1. File → New Screen Recording
2. Click the down arrow → select the Obsidian window
3. Record the interaction (keep it short: 3–7 sec)
4. Save as `.mov` to `docs/assets/demo/`

**Option B: screencapture (terminal)**
```bash
# 10-second recording of the full screen
screencapture -v -V 10 docs/assets/demo/raw-drag-drop.mov
```

### Step 2 — Convert `.mov` to GIF via ffmpeg

Use the `make_gif.sh` script in this folder:

```bash
./docs/make_gif.sh docs/assets/demo/raw-drag-drop.mov docs/assets/demo/drag-drop.gif
```

Or manually:
```bash
# Step 2a: Generate optimal palette
ffmpeg -i input.mov -vf "fps=15,scale=960:-1:flags=lanczos,palettegen" palette.png

# Step 2b: Apply palette to create GIF
ffmpeg -i input.mov -i palette.png \
  -filter_complex "fps=15,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  output.gif
```

### Recommended settings

| Setting | Value | Why |
|---|---|---|
| fps | 15 | Smooth enough, keeps file size down |
| scale width | 960px | Good for GitHub/community display |
| `lanczos` | always | Best quality downscale |

### File size targets

- Screenshots: < 400 KB each (PNG, export at 1×, run `pngcrush` if needed)
- GIFs: < 2 MB each (trim to the key interaction only)

---

## After capturing assets

1. Put all files in the paths above.
2. Run `git add docs/` and commit: `git commit -m "docs: add screenshots and demo GIFs"`
3. Push to GitHub — the README already references these paths via raw GitHub URLs.
4. Verify the images appear on the community plugin page (usually updates within minutes of push).
