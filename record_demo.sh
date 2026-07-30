#!/usr/bin/env bash
# record_demo.sh — One-command demo recording session for Time Blocks
#
# Usage: ./record_demo.sh [output_dir]
# Output: raw .mov files in output_dir/, then run ./make_gif.sh on each

set -euo pipefail

OUTPUT_DIR="${1:-docs/assets/demo}"

VAULT=~/Desktop/TimeBlocksDemo
REPO=~/source/obsidian-time-blocks

echo "════════════════════════════════════════════════════════════"
echo "  Time Blocks — Demo Recording Session"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Vault:     $VAULT"
echo "Output:    $OUTPUT_DIR"
echo ""

# Ensure demo vault is open in Obsidian
echo "→ Opening demo vault in Obsidian..."
open -a Obsidian "$VAULT"

# Wait for Obsidian to launch
sleep 3

# Ensure the plugin window is the right size and position
echo "→ Waiting for Obsidian to be ready..."
echo "   Please make sure:"
echo "   1. Time Blocks is ENABLED in Settings → Community plugins"
echo "   2. The Weekly View is OPEN (click calendar icon in ribbon)"
echo "   3. Window is sized to ~1400×900 (good for 960px GIF output)"
echo ""
read -p "Press ENTER when the weekly grid with backlog is visible..."

# Recording function
record() {
    local name="$1"
    local prompt="$2"
    local outfile="$OUTPUT_DIR/raw-$name.mov"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Recording: $name"
    echo "Action:    $prompt"
    echo "Output:    $outfile"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "When ready, press RETURN to START recording..."
    read
    
    # Use screencapture with -v for video, targeting the Obsidian window
    # We'll use a small AppleScript to get the Obsidian window ID
    osascript -e "
        tell application \"System Events\"
            set obsidianProcess to first process whose name is \"Obsidian\"
            set frontmost of obsidianProcess to true
        end tell
    "
    
    echo "⏺ Recording... Press RETURN to STOP"
    
    # Start recording
    screencapture -v "$outfile" &
    REC_PID=$!
    
    read
    
    kill $REC_PID 2>/dev/null || true
    sleep 0.5
    
    if [[ -f "$outfile" && -s "$outfile" ]]; then
        SIZE=$(du -h "$outfile" | cut -f1)
        echo "✓ Saved: $outfile ($SIZE)"
    else
        echo "✗ Recording failed or empty"
        return 1
    fi
}

# ── Recording sequence ──

record "drag-drop" \
    "Drag a task from backlog (e.g. 'Design homepage redesign') and drop it onto Tuesday ~10am. Block should snap into place."

record "resize-block" \
    "Drag the bottom edge of the block you just placed to extend it from 30min to 1h 30m."

record "week-nav" \
    "Click the '›' (next week) arrow in the week header, then click 'Today' to return."

record "tag-filter" \
    "In the backlog sidebar, click the '#work' tag chip. Backlog filters to work tasks. Click again to clear."

record "day-view" \
    "Click the day-view icon (right sidebar) or run 'Open day view' command. Navigate Mon→Tue→Wed with arrows."

record "gcal-overlay" \
    "(Optional) If you have GCal ICS feed configured: show the grid with blue calendar events overlayed."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  All recordings captured!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next step: Convert each .mov to .gif"
echo "  cd $REPO"
echo "  ./docs/make_gif.sh $OUTPUT_DIR/raw-drag-drop.mov $OUTPUT_DIR/drag-drop.gif"
echo "  ./docs/make_gif.sh $OUTPUT_DIR/raw-resize-block.mov $OUTPUT_DIR/resize-block.gif"
echo "  ...etc"
echo ""
echo "Then: git add docs/assets/ && git commit -m \"docs: add demo GIFs\" && git push"