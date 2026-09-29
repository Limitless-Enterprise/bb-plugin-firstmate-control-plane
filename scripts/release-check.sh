#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> plugin id"
node scripts/derive-plugin-id.mjs package.json

echo "==> pnpm typecheck"
pnpm run typecheck

echo "==> pnpm test"
pnpm test

if ! command -v bb >/dev/null 2>&1; then
  echo "ERROR: bb not on PATH — install BB to run bb plugin build" >&2
  exit 1
fi

echo "==> bb plugin build"
bb plugin build .

echo "OK: release checks passed"
