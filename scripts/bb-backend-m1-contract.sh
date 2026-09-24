#!/usr/bin/env bash
# Behavioral contract checks for BB backend overlay (M1 partials B-O*, B-W4).
set -eu
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="$REPO/packages/bb-backend/overlay"
mkdir -p "$OVERLAY/.bb-integration/bin"
ln -sfn "$OVERLAY/bin/fm-bb-lib.sh" "$OVERLAY/.bb-integration/bin/fm-bb-lib.sh"
export FM_BB_BACKEND_ROOT="$OVERLAY"
BB="$OVERLAY/bin/backends/bb.sh"

CONFIG="$OVERLAY/config/bb-integration.json"
CONFIG_BACKUP=""
if [ -f "$CONFIG" ]; then
  CONFIG_BACKUP="$(mktemp)"
  cp -a "$CONFIG" "$CONFIG_BACKUP"
fi

FAKE_BB_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$FAKE_BB_DIR"
  if [ -n "$CONFIG_BACKUP" ]; then
    cp -a "$CONFIG_BACKUP" "$CONFIG"
    rm -f "$CONFIG_BACKUP"
  elif [ -f "$CONFIG" ]; then
    rm -f "$CONFIG"
  fi
}
trap cleanup EXIT

cat >"$FAKE_BB_DIR/bb" <<'EOF'
#!/usr/bin/env bash
set -eu
if [ "$1" = thread ] && [ "$2" = show ]; then
  printf '%s\n' '{"thread":{"status":"idle","environmentId":"env-1"}}'
  exit 0
fi
if [ "$1" = thread ] && [ "$2" = output ]; then
  printf 'captured line\n'
  exit 0
fi
if [ "$1" = thread ] && [ "$2" = log ]; then
  exit 0
fi
if [ "$1" = thread ] && [ "$2" = stop ]; then
  exit 0
fi
if [ "$1" = fleet ] && [ "$2" = steer ]; then
  exit 1
fi
if [ "$1" = thread ] && [ "$2" = tell ]; then
  exit 1
fi
exit 1
EOF
chmod +x "$FAKE_BB_DIR/bb"
export PATH="$FAKE_BB_DIR:$PATH"

mkdir -p "$OVERLAY/config"
printf '%s\n' '{"enabled":true,"homeId":"tech","mateThreadId":"thr_mate","version":1}' >"$CONFIG"

# shellcheck source=/dev/null
. "$BB"

if fm_backend_bb_visible_capture "@thread:fake" 10 2>/dev/null; then
  echo "B-O9: visible_capture should fail-closed" >&2
  exit 1
fi

state="$(fm_backend_bb_composer_state "@thread:fake")"
if [ "$state" != "unknown" ]; then
  echo "B-O8: composer_state expected unknown, got $state" >&2
  exit 1
fi

if fm_backend_bb_has_push "@thread:fake"; then
  echo "B-O10: has_push should fail-closed on bb" >&2
  exit 1
fi

if fm_backend_bb_wait_transition "@thread:fake" 2>/dev/null; then
  echo "B-O10: wait_transition should not succeed on bb" >&2
  exit 1
fi

if ! fm_backend_bb_validate_spawn; then
  echo "B-W4: validate_spawn should succeed with enabled integration + bb" >&2
  exit 1
fi

capture="$(fm_backend_bb_capture "@thread:thr_crew" 5)"
if ! printf '%s' "$capture" | grep -q 'captured line'; then
  echo "B-O1: capture expected thread output" >&2
  exit 1
fi

busy="$(fm_backend_bb_busy_state "@thread:thr_crew")"
if [ "$busy" != "idle" ]; then
  echo "B-O7: busy_state expected idle, got $busy" >&2
  exit 1
fi

if fm_backend_bb_send_key "@thread:thr_crew" Enter 2>/dev/null; then
  echo "B-O5: unsupported send_key should fail-closed" >&2
  exit 1
fi

echo "bb-backend M1 contract checks passed"
