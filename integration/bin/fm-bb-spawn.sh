#!/usr/bin/env bash
# BB Fleet dispatch adapter for Firstmate ship/scout spawns.
# Keeps Firstmate backlog/task files; routes the agent session through bb fleet spawn.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fm-bb-lib.sh
. "$SCRIPT_DIR/fm-bb-lib.sh"

ORIGINAL_ARGS=("$@")

usage() {
  cat <<'EOF'
fm-bb-spawn: BB Fleet dispatch for Firstmate crews.

Invoked by the BB integration wrapper when config/bb-integration.json is enabled.
Unsupported spawn modes fall back to native Firstmate (tmux/herdr/treehouse).
EOF
}

native_spawn() {
  fm_bb_native_spawn "${ORIGINAL_ARGS[@]}"
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

fm_bb_load_config || exit 1
if [ "$FM_BB_ENABLED" != 1 ] || [ -z "$FM_BB_HOME_ID" ]; then
  echo "fm-bb-spawn: BB integration is not enabled for this checkout" >&2
  exit 1
fi

for arg in "${ORIGINAL_ARGS[@]}"; do
  case "$arg" in
    --relaunch|--secondmate)
      native_spawn
      ;;
  esac
done

TASK_ID=${1:-}
PROJECT=${2:-}
if [ -z "$TASK_ID" ] || [ -z "$PROJECT" ]; then
  echo "usage: fm-bb-spawn <task-id> <project-dir> [--scout] [--mode ...] [--yolo ...]" >&2
  exit 2
fi

ROLE=ship
DELIVERY_MODE=no-mistakes
YOLO=off
MODE_SEEN=0
YOLO_SEEN=0
SCOUT=0

shift 2 || true
while [ $# -gt 0 ]; do
  case "$1" in
    --scout) SCOUT=1; ROLE=scout ;;
    --mode)
      shift
      DELIVERY_MODE=${1:-}
      MODE_SEEN=1
      ;;
    --yolo)
      shift
      YOLO=${1:-}
      YOLO_SEEN=1
      ;;
    --harness|--model|--effort|--backend)
      shift
      ;;
    --harness=*|--model=*|--effort=*|--backend=*)
      ;;
    *)
      echo "fm-bb-spawn: unsupported flag for BB dispatch: $1 (using native spawn)" >&2
      native_spawn
      ;;
  esac
  shift
done

if [ "$SCOUT" = 0 ]; then
  if [ "$MODE_SEEN" != 1 ] || [ "$YOLO_SEEN" != 1 ]; then
    echo "fm-bb-spawn: ship spawn missing --mode/--yolo (using native spawn)" >&2
    native_spawn
  fi
fi

fm_bb_require_bb || exit 1

PROMPT="$(fm_bb_read_prompt "$TASK_ID")"
LABEL="$TASK_ID"

echo "fm-bb: dispatching ${ROLE} ${TASK_ID} through bb fleet spawn (home=${FM_BB_HOME_ID})" >&2

SPAWN_JSON=$(
  bb fleet spawn \
    --mate "$FM_BB_HOME_ID" \
    --role "$ROLE" \
    --label "$LABEL" \
    --prompt "$PROMPT" \
    --json 2>&1
) || {
  echo "fm-bb-spawn: bb fleet spawn failed:" >&2
  printf '%s\n' "$SPAWN_JSON" >&2
  exit 1
}

THREAD_ID=$(printf '%s' "$SPAWN_JSON" | jq -r '.threadId // empty')
if [ -z "$THREAD_ID" ]; then
  echo "fm-bb-spawn: bb fleet spawn returned no threadId" >&2
  printf '%s\n' "$SPAWN_JSON" >&2
  exit 1
fi

fm_bb_write_meta "$TASK_ID" "$THREAD_ID" "$ROLE"
fm_bb_write_status "$TASK_ID" "working: dispatched through BB Fleet as @thread:${THREAD_ID}"
fm_bb_mark_thread "$THREAD_ID" working

printf 'bb_thread_id=%s\n' "$THREAD_ID"
printf 'bb_fleet_node_id=%s\n' "$(printf '%s' "$SPAWN_JSON" | jq -r '.id // empty')"
echo "fm-bb: crew visible in Fleet UI under ${FM_BB_HOME_ID} → ${LABEL}" >&2
