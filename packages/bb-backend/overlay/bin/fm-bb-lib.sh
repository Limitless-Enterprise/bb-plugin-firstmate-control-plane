#!/usr/bin/env bash
# Shared helpers for the Firstmate ↔ BB Fleet integration overlay.
set -eu

fm_bb_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$script_dir/../.." && pwd
}

fm_bb_config_path() {
  printf '%s\n' "$(fm_bb_root)/config/bb-integration.json"
}

fm_bb_load_config() {
  FM_BB_ROOT="$(fm_bb_root)"
  FM_BB_CONFIG="$(fm_bb_config_path)"
  FM_BB_ENABLED=0
  FM_BB_HOME_ID=
  FM_BB_MATE_THREAD_ID=
  FM_BB_VERSION=

  if [ ! -f "$FM_BB_CONFIG" ]; then
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "fm-bb: jq is required for BB integration" >&2
    return 1
  fi

  local enabled
  enabled="$(jq -r '.enabled // false' "$FM_BB_CONFIG")"
  case "$enabled" in
    true|1|yes|on) FM_BB_ENABLED=1 ;;
    *) FM_BB_ENABLED=0 ;;
  esac

  FM_BB_HOME_ID="$(jq -r '.homeId // empty' "$FM_BB_CONFIG")"
  FM_BB_MATE_THREAD_ID="$(jq -r '.mateThreadId // empty' "$FM_BB_CONFIG")"
  FM_BB_VERSION="$(jq -r '.version // empty' "$FM_BB_CONFIG")"
}

fm_bb_enabled() {
  fm_bb_load_config || return 1
  [ "$FM_BB_ENABLED" = 1 ] && [ -n "$FM_BB_HOME_ID" ]
}

fm_bb_native_spawn() {
  fm_bb_load_config || return 1
  exec "$FM_BB_ROOT/.bb-integration/native/bin/fm-spawn.sh" "$@"
}

fm_bb_require_bb() {
  if ! command -v bb >/dev/null 2>&1; then
    echo "fm-bb: bb CLI not found; cannot dispatch through BB Fleet" >&2
    return 1
  fi
}

fm_bb_read_prompt() {
  local task_id=$1
  local data_dir=${2:-"$(fm_bb_root)/data"}
  local brief="$data_dir/$task_id/launch-brief.md"
  if [ -f "$brief" ]; then
    cat "$brief"
    return 0
  fi
  brief="$data_dir/$task_id/brief.md"
  if [ -f "$brief" ]; then
    cat "$brief"
    return 0
  fi
  echo "Execute Firstmate task ${task_id}. Follow the task brief in data/${task_id}/."
}

fm_bb_thread_target() {
  local thread_id=$1
  printf '@thread:%s' "$thread_id"
}

fm_bb_mark_thread() {
  local thread_id=$1
  local state=$2
  fm_bb_require_bb || return 0
  bb fleet mark --mate "$FM_BB_HOME_ID" --thread "$thread_id" --state "$state" >/dev/null 2>&1 || true
}
