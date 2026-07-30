#!/usr/bin/env bash
# record_demo.sh — Record a single demo interaction using macOS screencapture
# Usage: ./record_demo.sh <name> [duration_seconds]
# Example: ./record_demo.sh drag-drop 8

set -euo pipefail

NAME="${1:?Usage: record_demo.sh <name> [duration_seconds]}"
DURATION="${2:-10}"
OUT_DIR="docs/assets/demo"
RAW_FILE="$OUT_DIR/raw-$NAME.mov"

mkdir -p "$OUT_DIR"

echo "════════════════════════════════════════════"
echo "  Recording: $NAME"
echo "  Duration: ${DURATION}s"
echo "  Output: $RAW_FILE"
echo "════════════════════════════════════════════"
echo ""
echo ">>> Get ready — recording starts in 3 seconds..."
sleep 1
echo ">>> 2..."
sleep 1
echo ">>> 1..."
sleep 1
echo ">>> RECORDING NOW — perform the interaction!"
echo ""

# screencapture -v records video; -V sets duration in seconds
# This captures the MAIN display. For a specific window, use QuickTime instead.
screencapture -v -V "$DURATION" "$RAW_FILE"

echo ""
echo "✓ Recording saved: $RAW_FILE"
SIZE=$(du -sh "$RAW_FILE" | cut -f1)
echo "  Size: $SIZE"
echo ""
echo "Next steps:"
echo "  1. Verify the recording looks good"
echo "  2. Convert: ./docs/make_gif.sh $RAW_FILE $OUT_DIR/$NAME.gif"
echo "  3. Or batch convert all: ./convert_all.sh"