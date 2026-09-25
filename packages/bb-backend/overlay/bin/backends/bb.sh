#!/usr/bin/env bash
# bin/backends/bb.sh — Firstmate runtime backend via BB threads/worktrees.
# Sourced through fm-backend-wrap.sh after native fm-backend loads.
set -eu

FM_BB_BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../fm-bb-lib.sh
. "$FM_BB_BACKEND_ROOT/.bb-integration/bin/fm-bb-lib.sh"

fm_backend_bb_thread_status() {
  local tid=$1
  bb thread show "$tid" --json 2>/dev/null \
    | jq -r '.thread.status // .status // "unknown"' 2>/dev/null \
    || printf 'unknown'
}

fm_backend_bb_thread_id_from_target() {
  local target=$1
  case "$target" in
    @thread:*|thread:*) printf '%s' "${target#*thread:}" ;;
    @*) printf '%s' "${target#@}" ;;
    *) printf '%s' "$target" ;;
  esac
}

fm_backend_bb_capture() {
  local target=$1 lines=$2
  local tid out
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  fm_bb_require_bb || return 1
  out="$(bb thread output "$tid" 2>/dev/null || true)"
  if [ -z "$out" ]; then
    out="$(bb thread log "$tid" --limit "$lines" 2>/dev/null || true)"
  fi
  printf '%s' "$out" | tail -n "$lines"
}

fm_backend_bb_visible_capture() {
  echo "error: bb backend has no viewport capture" >&2
  return 1
}

fm_backend_bb_send_key() {
  local target=$1 key=$2 _label=${3-} _retries=${4-} _sleep=${5-} _settle=${6-}
  local tid
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  fm_bb_require_bb || return 1
  case "$key" in
    Escape|C-c)
      # BB has no raw terminal keys; stop cancels an in-flight turn without
      # retiring the thread, matching fm-control's interrupt semantics.
      bb thread stop "$tid" >/dev/null 2>&1 || return 1
      return 0
      ;;
    *)
      echo "error: bb backend does not support key '$key'" >&2
      return 1
      ;;
  esac
}

fm_backend_bb_send_text_submit() {
  local target=$1 text=$2 _retries=$3 _sleep=$4 _settle=$5
  local tid
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  fm_bb_load_config || return 1
  fm_bb_require_bb || return 1
  if bb fleet steer --mate "$FM_BB_HOME_ID" --thread "$tid" --text "$text" >/dev/null 2>&1; then
    printf ''
    return 0
  fi
  if bb thread tell "$tid" "$text" >/dev/null 2>&1; then
    printf ''
    return 0
  fi
  printf 'unconfirmed'
  return 1
}

fm_backend_bb_kill() {
  local target=$1
  local tid
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  fm_bb_require_bb || return 1
  bb thread stop "$tid" >/dev/null 2>&1 || return 0
  return 0
}

fm_backend_bb_target_exists() {
  local target=$1
  local tid
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  fm_bb_require_bb || return 1
  bb thread show "$tid" --json >/dev/null 2>&1
}

fm_backend_bb_agent_state() {
  local target=$1
  local tid json status env_id
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  if ! fm_backend_bb_target_exists "$target"; then
    printf 'missing'
    return 0
  fi
  json="$(bb thread show "$tid" --json 2>/dev/null || true)"
  status="$(
    printf '%s' "$json" \
      | jq -r '.thread.status // .status // "unknown"' 2>/dev/null \
      || printf 'unknown'
  )"
  env_id="$(
    printf '%s' "$json" \
      | jq -r '.thread.environmentId // .thread.envId // .envId // .environmentId // empty' 2>/dev/null \
      || true
  )"
  case "$status" in
    active|running|idle|starting|stopping) printf 'alive' ;;
    error|failed)
      # Stop/cancel can leave a bound thread in error while the worktree
      # endpoint persists — still alive for interrupt/relaunch postconditions.
      if [ -n "$env_id" ]; then printf 'alive'; else printf 'dead'; fi
      ;;
    stopped)
      if [ -n "$env_id" ]; then printf 'alive'; else printf 'dead'; fi
      ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_bb_agent_alive() {
  case "$(fm_backend_bb_agent_state "$1")" in
    alive) printf 'alive' ;;
    dead|missing) printf 'dead' ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_bb_busy_state() {
  local target=$1
  local tid status
  tid="$(fm_backend_bb_thread_id_from_target "$target")"
  status="$(fm_backend_bb_thread_status "$tid")"
  case "$status" in
    active|running) printf 'busy' ;;
    idle) printf 'idle' ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_bb_composer_state() {
  printf 'unknown'
}

fm_backend_bb_has_push() {
  return 1
}

fm_backend_bb_wait_transition() {
  return 2
}

fm_backend_bb_commit_transition() {
  return 2
}

fm_backend_bb_clear_transition() {
  return 0
}

fm_backend_bb_validate_spawn() {
  fm_bb_load_config || return 1
  if [ "$FM_BB_ENABLED" != 1 ]; then
    echo "error: bb backend requires enabled config/bb-integration.json" >&2
    return 1
  fi
  fm_bb_require_bb || return 1
  return 0
}
