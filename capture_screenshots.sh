#!/usr/bin/env bash
# capture_screenshots.sh — Capture all 5 required screenshots
# Run from repo root with Obsidian open to the demo vault

set -euo pipefail

REPO=~/source/obsidian-time-blocks
OUT_DIR="$REPO/docs/assets/screenshots"

echo "═══════════════════════════════════════════════════════"
echo "  Time Blocks — Screenshot Capture"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Make sure:"
echo "  1. Obsidian is open with the demo vault"
echo "  2. Time Blocks Weekly View is open and visible"
echo "  3. Window is sized nicely (~1400×900 or larger)"
echo ""

capture() {
    local num="$1"
    local name="$2"
    local prompt="$3"
    local outfile="$OUT_DIR/${num}-${name}.png"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Screenshot $num: $name"
    echo "What: $prompt"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    read -p "Press ENTER to capture (saves to $outfile)..."
    
    # Use screencapture -x (no sound) -w (window) targeting Obsidian
    osascript -e 'tell application "Obsidian" to activate'
    sleep 0.3
    screencapture -x -w "$outfile"
    
    if [[ -f "$outfile" && -s "$outfile" ]]; then
        SIZE=$(du -h "$outfile" | cut -f1)
        echo "✓ Saved: $outfile ($SIZE)"
    else
        echo "✗ Capture failed"
        return 1
    fi
}

capture "01" "weekly-grid" \
    "Full weekly grid with backlog sidebar visible and 4-6 blocks on calendar"

capture "02" "backlog-sidebar" \
    "Backlog panel zoomed — show priority emojis (⏫ 🔼 🔽) and tag chips"

capture "03" "day-view" \
    "Day view open in right sidebar alongside a note"

capture "04" "custom-query" \
    "Settings panel open to Custom Query section with example query"

capture "05" "gcal-sync" \
    "Grid with both purple task blocks and blue GCal event blocks (if ICS feed configured)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  All screenshots captured!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next: git add docs/assets/ && git commit -m \"docs: add screenshots\" && git push"