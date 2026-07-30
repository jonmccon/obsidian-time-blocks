#!/usr/bin/env bash
# convert_all.sh — Batch convert all raw .mov files to .gif
# Run from repo root after recording session

set -euo pipefail

REPO=~/source/obsidian-time-blocks
RAW_DIR="$REPO/docs/assets/demo"
OUT_DIR="$REPO/docs/assets/demo"

echo "Converting all .mov → .gif in $RAW_DIR"
echo ""

for raw in "$RAW_DIR"/raw-*.mov; do
    [[ -f "$raw" ]] || continue
    base=$(basename "$raw" .mov)
    name=${base#raw-}
    out="$OUT_DIR/$name.gif"
    
    echo "→ $name"
    "$REPO/docs/make_gif.sh" "$raw" "$out" 960 15
done

echo ""
echo "Done. Output files:"
ls -lh "$OUT_DIR"/*.gif 2>/dev/null || echo "  (none yet)"