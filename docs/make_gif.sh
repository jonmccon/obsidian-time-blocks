#!/usr/bin/env bash
# make_gif.sh — Convert a screen recording (.mov/.mp4) to an optimised GIF
# Usage: ./docs/make_gif.sh <input.mov> <output.gif> [width] [fps]
#
# Defaults: width=960px, fps=15
# Requires: ffmpeg (brew install ffmpeg)

set -euo pipefail

INPUT="${1:?Usage: make_gif.sh <input.mov> <output.gif> [width] [fps]}"
OUTPUT="${2:?Usage: make_gif.sh <input.mov> <output.gif> [width] [fps]}"
WIDTH="${3:-960}"
FPS="${4:-15}"

PALETTE="$(mktemp /tmp/gif_palette_XXXXXX.png)"

echo "→ Generating palette from: $INPUT"
ffmpeg -y -i "$INPUT" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
  "$PALETTE" 2>/dev/null

echo "→ Encoding GIF: $OUTPUT"
ffmpeg -y -i "$INPUT" -i "$PALETTE" \
  -filter_complex "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  "$OUTPUT" 2>/dev/null

SIZE=$(du -sh "$OUTPUT" | cut -f1)
echo "✓ Done: $OUTPUT ($SIZE)"

rm -f "$PALETTE"
