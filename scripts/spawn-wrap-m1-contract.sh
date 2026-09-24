#!/usr/bin/env bash
# Spawn wrapper routing checks (B-S1 native path, B-S6 --relaunch).
set -eu
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/.bb-integration/native/bin" "$ROOT/.bb-integration/bin" "$ROOT/config" "$ROOT/bin"

cat >"$ROOT/.bb-integration/native/bin/fm-spawn.sh" <<'EOF'
#!/usr/bin/env bash
printf 'native-spawn:%s\n' "$*"
EOF
chmod +x "$ROOT/.bb-integration/native/bin/fm-spawn.sh"

cat >"$ROOT/.bb-integration/bin/fm-bb-spawn.sh" <<'EOF'
#!/usr/bin/env bash
printf 'bb-spawn:%s\n' "$*"
EOF
chmod +x "$ROOT/.bb-integration/bin/fm-bb-spawn.sh"

cp "$REPO/packages/bb-backend/overlay/bin/fm-bb-lib.sh" "$ROOT/.bb-integration/bin/fm-bb-lib.sh"
cp "$REPO/packages/bb-backend/overlay/bin/fm-spawn-wrap.sh" "$ROOT/bin/fm-spawn-wrap.sh"
chmod +x "$ROOT/bin/fm-spawn-wrap.sh" "$ROOT/.bb-integration/bin/fm-bb-lib.sh"

printf '%s\n' '{"enabled":true,"homeId":"tech","mateThreadId":"thr_mate","version":1}' >"$ROOT/config/bb-integration.json"
printf 'bb\n' >"$ROOT/config/backend"

out="$(FM_BB_BACKEND_ROOT="$ROOT" "$ROOT/bin/fm-spawn-wrap.sh" task-1 /proj --scout --harness cursor 2>&1)"
if ! printf '%s' "$out" | grep -q '^bb-spawn:'; then
  echo "B-S1: expected BB spawn dispatch for scout crew, got: $out" >&2
  exit 1
fi

relaunch_out="$(FM_BB_BACKEND_ROOT="$ROOT" "$ROOT/bin/fm-spawn-wrap.sh" task-1 /proj --relaunch 2>&1)"
if ! printf '%s' "$relaunch_out" | grep -q '^native-spawn:'; then
  echo "B-S6: --relaunch should route to native spawn, got: $relaunch_out" >&2
  exit 1
fi

echo "spawn-wrap M1 contract checks passed"
