#!/usr/bin/env bash
# Wrapper installed as bin/fm-backend.sh when BB integration is active.
# Extends native fm-backend with the bb adapter without editing upstream core.
set -eu

FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NATIVE="$FM_ROOT/.bb-integration/native/bin/fm-backend-native.sh"
if [ ! -f "$NATIVE" ]; then
  NATIVE="$FM_ROOT/.bb-integration/native/bin/fm-backend.sh"
fi

if [ ! -f "$NATIVE" ]; then
  echo "fm-bb: native fm-backend backup missing at $NATIVE" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$NATIVE"

eval "$(
  declare -f fm_backend_validate_task_endpoint \
    | sed '1s/fm_backend_validate_task_endpoint/_fm_backend_validate_task_endpoint_native/'
)"

FM_BACKEND_KNOWN="tmux herdr zellij orca cmux bb"

fm_backend_is_known() {
  case " $FM_BACKEND_KNOWN " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

fm_backend_validate_spawn() {
  local name=$1
  if [ "$name" = bb ]; then
    # shellcheck source=/dev/null
    . "$FM_ROOT/bin/backends/bb.sh"
    fm_backend_bb_validate_spawn
    return $?
  fi
  if [ "$name" = cmux ]; then
    echo "NOTICE: cmux backend is EXPERIMENTAL." >&2
  fi
  fm_backend_is_known "$name" || {
    echo "error: unknown backend '$name' (known: $FM_BACKEND_KNOWN)" >&2
    return 1
  }
  return 0
}

fm_backend_source() {
  local name=$1
  fm_backend_validate "$name" || return 1
  case "$name" in
    bb)
      if [ -z "${_FM_BACKEND_BB_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_ROOT/bin/backends/bb.sh" || return 1
        _FM_BACKEND_BB_SOURCED=1
      fi
      ;;
    tmux)
      if [ -z "${_FM_BACKEND_TMUX_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_BACKEND_LIB_DIR/backends/tmux.sh" || return 1
        _FM_BACKEND_TMUX_SOURCED=1
      fi
      ;;
    herdr)
      if [ -z "${_FM_BACKEND_HERDR_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_BACKEND_LIB_DIR/backends/herdr.sh" || return 1
        _FM_BACKEND_HERDR_SOURCED=1
      fi
      ;;
    zellij)
      if [ -z "${_FM_BACKEND_ZELLIJ_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_BACKEND_LIB_DIR/backends/zellij.sh" || return 1
        _FM_BACKEND_ZELLIJ_SOURCED=1
      fi
      ;;
    orca)
      if [ -z "${_FM_BACKEND_ORCA_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_BACKEND_LIB_DIR/backends/orca.sh" || return 1
        _FM_BACKEND_ORCA_SOURCED=1
      fi
      ;;
    cmux)
      if [ -z "${_FM_BACKEND_CMUX_SOURCED:-}" ]; then
        # shellcheck source=/dev/null
        . "$FM_BACKEND_LIB_DIR/backends/cmux.sh" || return 1
        _FM_BACKEND_CMUX_SOURCED=1
      fi
      ;;
  esac
}

fm_backend_capture() {
  local backend=$1
  shift
  fm_backend_source "$backend" || return 1
  case "$backend" in
    bb) fm_backend_bb_capture "$@" ;;
    tmux) fm_backend_tmux_capture "$@" ;;
    herdr) fm_backend_herdr_capture "$@" ;;
    zellij) fm_backend_zellij_capture "$@" ;;
    orca) fm_backend_orca_capture "$@" ;;
    cmux) fm_backend_cmux_capture "$@" ;;
    *) echo "error: no capture implementation for backend '$backend'" >&2; return 1 ;;
  esac
}

fm_backend_visible_capture_supported() {
  case "$1" in
    bb) return 1 ;;
    tmux|herdr|zellij) return 0 ;;
    *) return 1 ;;
  esac
}

fm_backend_visible_capture() {
  local backend=$1
  shift
  fm_backend_visible_capture_supported "$backend" || {
    echo "error: backend '$backend' has no verified viewport-bounded capture primitive" >&2
    return 1
  }
  fm_backend_source "$backend" || return 1
  case "$backend" in
    tmux) fm_backend_tmux_visible_capture "$@" ;;
    herdr) fm_backend_herdr_visible_capture "$@" ;;
    zellij) fm_backend_zellij_visible_capture "$@" ;;
    *) return 1 ;;
  esac
}

fm_backend_send_key() {
  local backend=$1
  shift
  fm_backend_source "$backend" || return 1
  case "$backend" in
    bb) fm_backend_bb_send_key "$@" ;;
    tmux) fm_backend_tmux_send_key "$@" ;;
    herdr) fm_backend_herdr_send_key "$@" ;;
    zellij) fm_backend_zellij_send_key "$@" ;;
    orca) fm_backend_orca_send_key "$@" ;;
    cmux) fm_backend_cmux_send_key "$@" ;;
    *) return 1 ;;
  esac
}

fm_backend_send_text_submit() {
  local backend=$1
  shift
  fm_backend_source "$backend" || return 1
  case "$backend" in
    bb) fm_backend_bb_send_text_submit "$@" ;;
    tmux) fm_backend_tmux_send_text_submit "$@" ;;
    herdr) fm_backend_herdr_send_text_submit "$@" ;;
    zellij) fm_backend_zellij_send_text_submit "$@" ;;
    orca) fm_backend_orca_send_text_submit "$@" ;;
    cmux) fm_backend_cmux_send_text_submit "$@" ;;
    *) return 1 ;;
  esac
}

fm_backend_kill() {
  local backend=$1
  shift
  fm_backend_source "$backend" || return 1
  case "$backend" in
    bb) fm_backend_bb_kill "$@" ;;
    tmux) fm_backend_tmux_kill "$@" ;;
    herdr) fm_backend_herdr_kill "$@" ;;
    zellij) fm_backend_zellij_kill "$@" ;;
    orca) fm_backend_orca_kill "$@" ;;
    cmux) fm_backend_cmux_kill "$@" ;;
    *) return 1 ;;
  esac
}

fm_backend_busy_state() {
  local backend=$1
  shift
  fm_backend_source "$backend" || { printf 'unknown'; return 0; }
  case "$backend" in
    bb) fm_backend_bb_busy_state "$@" ;;
    herdr) fm_backend_herdr_busy_state "$@" ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_composer_state() {
  local backend=$1
  shift
  fm_backend_source "$backend" || { printf 'unknown'; return 0; }
  case "$backend" in
    bb) fm_backend_bb_composer_state "$@" ;;
    tmux) fm_tmux_composer_state "$@" ;;
    herdr) fm_backend_herdr_composer_state "$@" ;;
    orca) fm_backend_orca_composer_state "$@" ;;
    cmux) fm_backend_cmux_composer_state "$@" ;;
    zellij) fm_backend_zellij_composer_state "$@" ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_target_exists() {
  local backend=$1 target=$2
  case "$backend" in
    bb) fm_backend_bb_target_exists "$target" ;;
    tmux)
      tmux display-message -p -t "$target" '#{pane_id}' >/dev/null 2>&1
      ;;
    *)
      fm_backend_source "$backend" || return 1
      fm_backend_agent_alive "$backend" "$target" >/dev/null 2>&1
      ;;
  esac
}

fm_backend_agent_state() {
  local backend=$1 target=$2
  fm_backend_source "$backend" || { printf 'unverified'; return 0; }
  case "$backend" in
    bb) fm_backend_bb_agent_state "$target" ;;
    tmux) fm_backend_tmux_agent_state "$target" ;;
    herdr) fm_backend_herdr_agent_state "$target" ;;
    *) printf 'unverified' ;;
  esac
}

fm_backend_agent_alive() {
  case "$(fm_backend_agent_state "$1" "$2")" in
    alive) printf 'alive' ;;
    dead|missing) printf 'dead' ;;
    *) printf 'unknown' ;;
  esac
}

fm_backend_has_push() {
  case "$1" in
    bb) return 1 ;;
    herdr) return 0 ;;
    *) return 1 ;;
  esac
}

fm_backend_wait_transition() {
  local backend=$1
  shift
  fm_backend_has_push "$backend" || return 2
  fm_backend_source "$backend" || return 2
  case "$backend" in
    herdr) fm_backend_herdr_wait_transition "$@" ;;
    *) return 2 ;;
  esac
}

fm_backend_validate_task_endpoint() {
  local meta=$1 id=$2 backend window worktree project binding
  [ -f "$meta" ] && [ ! -L "$meta" ] || {
    echo "REFUSED: task $id has no regular endpoint metadata at $meta; preserving task state." >&2
    return 1
  }
  backend=$(grep '^backend=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1)
  backend=${backend:-tmux}
  if [ "$backend" = bb ]; then
    window=$(grep '^window=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1)
    worktree=$(grep '^worktree=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1)
    project=$(grep '^project=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1)
    binding=$(grep '^endpoint_task_id=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1)
    [ -n "$window" ] && [ -n "$worktree" ] && [ -n "$project" ] || {
      echo "REFUSED: bb task $id has incomplete endpoint metadata." >&2
      return 1
    }
    [ "$binding" = "$id" ] || {
      echo "REFUSED: bb task $id endpoint_task_id mismatch." >&2
      return 1
    }
    FM_BACKEND_VALIDATED_BACKEND=bb
    FM_BACKEND_VALIDATED_TARGET=$window
    return 0
  fi
  _fm_backend_validate_task_endpoint_native "$meta" "$id"
}
