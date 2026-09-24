#!/usr/bin/env bash
# Fail if CAPABILITY_INVENTORY still has M1 🔲 rows or undocumented partials without AC mapping.
set -eu
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INV="$REPO_ROOT/docs/CAPABILITY_INVENTORY.md"

if [ ! -f "$INV" ]; then
  echo "missing $INV" >&2
  exit 1
fi

pnpm run test
pnpm run typecheck

open=$(grep -E '\| ✓ \| 🔲 \|' "$INV" | wc -l)
partial=$(grep -E '\| ✓ \| ⚠ \|' "$INV" | wc -l)

echo "M1 inventory: $open not-done, $partial partial"

if [ "$open" -gt 0 ]; then
  echo "Remaining 🔲 (M1):" >&2
  grep -E '\| ✓ \| 🔲 \|' "$INV" >&2 || true
  exit 1
fi

if [ "$partial" -gt 0 ]; then
  echo "Remaining ⚠ partial (M1) — promote to ✅ with evidence or implement:" >&2
  grep -E '\| ✓ \| ⚠ \|' "$INV" >&2 || true
  exit 1
fi

echo "M1 inventory gate: all M1 rows ✅"
