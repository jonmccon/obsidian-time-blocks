#!/usr/bin/env bash
# convert_all.sh — Batch convert all raw .mov files to GIFs
# Run this after recording all demo interactions

set -euo pipefail

RAW_DIR="docs/assets/demo"
OUT_DIR="docs/assets/demo"

echo "→ Looking for raw recordings in $RAW_DIR..."
shopt -s nullglob
files=("$RAW_DIR"/raw-*.mov)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
    echo "  No raw-*.mov files found. Record some first!"
    exit 0
fi

echo "  Found ${#files[@]} file(s):"
for f in "${files[@]}"; do
    echo "    $(basename "$f")"
done
echo ""

for raw in "${files[@]}"; do
    base=$(basename "$raw" .mov)
    # raw-drag-drop.mov → drag-drop.gif
    gif_name="${base#raw-}.gif"
    out="$OUT_DIR/$gif_name"
    
    echo "→ Converting: $(basename "$raw") → $gif_name"
    ./docs/make_gif.sh "$raw" "$out"
    echo ""
done

echo "✓ All conversions complete."
echo ""
echo "Generated GIFs:"
ls -lh "$OUT_DIR"/*.gif 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'