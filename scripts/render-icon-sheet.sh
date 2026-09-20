#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/.icon-preview"
PNG_DIR="$OUT_DIR/png"
rm -rf "$OUT_DIR"
mkdir -p "$PNG_DIR"

node "$ROOT/scripts/preview-icons.mjs" >/dev/null
node "$ROOT/scripts/export-icon-svgs.mjs" >/dev/null

while IFS= read -r slug; do
  rsvg-convert -w 128 -h 128 -b "#151922" "$OUT_DIR/${slug}.svg" -o "$PNG_DIR/${slug}.png"
done < <(node -e "const m=require('$OUT_DIR/manifest.json'); console.log(m.map(i=>i.slug).join('\n'))")

LABEL_ARGS=()
while IFS=$'\t' read -r slug label group; do
  LABEL_ARGS+=("-label" "${label}\n(${group})")
  LABEL_ARGS+=("$PNG_DIR/${slug}.png")
done < <(node -e "const m=require('$OUT_DIR/manifest.json'); for (const i of m) console.log([i.slug,i.label,i.group].join('\t'))")

montage "${LABEL_ARGS[@]}" \
  -tile 6x3 -geometry 160x190+10+10 \
  -background "#0b0d12" -fill "#e8ecf4" -pointsize 13 \
  "$ROOT/icon-options-sheet.png"

echo "$ROOT/icon-options-sheet.png"
