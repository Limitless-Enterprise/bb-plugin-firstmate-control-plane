#!/usr/bin/env bash
# BB Fleet dispatch for Firstmate ship/scout spawns.
# Registers crews in Fleet and writes durable Firstmate state/<id>.meta.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fm-bb-lib.sh
. "$SCRIPT_DIR/fm-bb-lib.sh"

ORIGINAL_ARGS=("$@")

usage() {
  cat <<'EOF'
fm-bb-spawn: BB Fleet dispatch for Firstmate crews.

Used when config/bb-integration.json is enabled and config/backend=bb.
Unsupported spawn modes fall back to native Firstmate.
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
HARNESS=
MODEL=
EFFORT=

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
    --harness)
      shift
      HARNESS=${1:-}
      ;;
    --model)
      shift
      MODEL=${1:-}
      ;;
    --effort)
      shift
      EFFORT=${1:-}
      ;;
    --harness=*)
      HARNESS=${1#--harness=}
      ;;
    --model=*)
      MODEL=${1#--model=}
      ;;
    --effort=*)
      EFFORT=${1#--effort=}
      ;;
    --backend|--backend=*)
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
PROJ_ABS="$(cd "$PROJECT" 2>/dev/null && pwd || printf '%s' "$PROJECT")"

echo "fm-bb: dispatching ${ROLE} ${TASK_ID} through bb fleet spawn (home=${FM_BB_HOME_ID})" >&2

SPAWN_ARGS=(
  fleet spawn
  --mate "$FM_BB_HOME_ID"
  --role "$ROLE"
  --label "$LABEL"
  --prompt "$PROMPT"
  --json
)
case "$DELIVERY_MODE" in
  no-mistakes|direct-PR|local-only)
    SPAWN_ARGS+=(--mode "$DELIVERY_MODE")
    ;;
esac
case "$YOLO" in
  on|yes|true|1) SPAWN_ARGS+=(--yolo) ;;
esac

SPAWN_JSON="$(bb "${SPAWN_ARGS[@]}" 2>&1)" || {
  echo "fm-bb-spawn: bb fleet spawn failed:" >&2
  printf '%s\n' "$SPAWN_JSON" >&2
  exit 1
}

THREAD_ID="$(printf '%s' "$SPAWN_JSON" | jq -r '.threadId // empty')"
if [ -z "$THREAD_ID" ]; then
  echo "fm-bb-spawn: bb fleet spawn returned no threadId" >&2
  printf '%s\n' "$SPAWN_JSON" >&2
  exit 1
fi

ENV_ID="$(printf '%s' "$SPAWN_JSON" | jq -r '.envId // .environmentId // empty')"
WORKTREE="$(printf '%s' "$SPAWN_JSON" | jq -r '.worktreePath // .checkoutPath // empty')"
if [ -z "$WORKTREE" ] && [ -n "$ENV_ID" ]; then
  WORKTREE="$(bb environments get "$ENV_ID" --json 2>/dev/null | jq -r '.path // empty' || true)"
fi
if [ -z "$WORKTREE" ]; then
  WORKTREE="$PROJ_ABS"
fi

STATE_DIR="$(fm_bb_root)/state"
mkdir -p "$STATE_DIR"
META="$STATE_DIR/${TASK_ID}.meta"
TARGET="$(fm_bb_thread_target "$THREAD_ID")"

{
  printf 'backend=bb\n'
  printf 'window=%s\n' "$TARGET"
  printf 'endpoint_task_id=%s\n' "$TASK_ID"
  printf 'bb_thread_id=%s\n' "$THREAD_ID"
  printf 'bb_home_id=%s\n' "$FM_BB_HOME_ID"
  [ -n "$ENV_ID" ] && printf 'bb_env_id=%s\n' "$ENV_ID"
  printf 'worktree=%s\n' "$WORKTREE"
  printf 'project=%s\n' "$PROJ_ABS"
  printf 'kind=%s\n' "$ROLE"
  printf 'mode=%s\n' "$DELIVERY_MODE"
  printf 'yolo=%s\n' "$YOLO"
  [ -n "$HARNESS" ] && printf 'harness=%s\n' "$HARNESS"
  [ -n "$MODEL" ] && printf 'model=%s\n' "$MODEL"
  [ -n "$EFFORT" ] && printf 'effort=%s\n' "$EFFORT"
  printf 'spawn_gen=bb-%s\n' "$(date +%s)"
} >"$META"

printf '%s\n' "working: dispatched through BB Fleet as ${TARGET}" >"$STATE_DIR/${TASK_ID}.status"
fm_bb_mark_thread "$THREAD_ID" working

printf 'bb_thread_id=%s\n' "$THREAD_ID"
printf 'window=%s\n' "$TARGET"
echo "fm-bb: crew visible in Fleet UI under ${FM_BB_HOME_ID} → ${LABEL}" >&2
