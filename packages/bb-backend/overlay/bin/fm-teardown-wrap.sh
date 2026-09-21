#!/usr/bin/env bash
# Wrapper installed as bin/fm-teardown.sh when BB integration is active.
# Skips treehouse pool return for backend=bb crews (BB owns the worktree env).
set -eu

FM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$FM_ROOT/.bb-integration/native/bin/fm-teardown.sh"
INTEGRATION_BIN="$FM_ROOT/.bb-integration/bin"
# shellcheck source=/dev/null
. "$INTEGRATION_BIN/fm-bb-lib.sh"

if [ ! -x "$NATIVE" ]; then
  echo "fm-bb: native fm-teardown backup missing at $NATIVE" >&2
  exit 1
fi

TASK_ID=
FORCE=
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --legacy-record) ;;
    -*) ;;
    *)
      if [ -z "$TASK_ID" ]; then
        TASK_ID=$arg
      fi
      ;;
  esac
done

USE_BB_TEARDOWN=0
if fm_bb_enabled && [ -n "$TASK_ID" ] && [ -f "$FM_ROOT/state/$TASK_ID.meta" ]; then
  backend=$(grep '^backend=' "$FM_ROOT/state/$TASK_ID.meta" 2>/dev/null | cut -d= -f2- | head -n1 || true)
  if [ "$backend" = bb ]; then
    USE_BB_TEARDOWN=1
  fi
fi

link_native_teardown_libs() {
  local bin_dir=$1 native_dir=$2 target base
  for target in "$bin_dir"/fm-*; do
    [ -e "$target" ] || continue
    base=$(basename "$target")
    case "$base" in
      fm-spawn.sh | fm-backend.sh | fm-teardown.sh) continue ;;
    esac
    ln -sf "$target" "$native_dir/$base"
  done
  if [ -d "$bin_dir/backends" ]; then
    mkdir -p "$native_dir/backends"
    for target in "$bin_dir"/backends/*; do
      [ -e "$target" ] || continue
      base=$(basename "$target")
      ln -sf "$target" "$native_dir/backends/$base"
    done
  fi
  native_backend="$native_dir/fm-backend-native.sh"
  if [ ! -f "$native_backend" ]; then
    if grep -q 'fm-backend-design-d7' "$native_dir/fm-backend.sh" 2>/dev/null; then
      cp -a "$native_dir/fm-backend.sh" "$native_backend"
    fi
  fi
  if [ -f "$native_backend" ]; then
    cat >"$native_dir/fm-backend.sh" <<'EOF'
#!/usr/bin/env bash
set -eu
: "${FM_ROOT_OVERRIDE:?fm-teardown-wrap must set FM_ROOT_OVERRIDE}"
# shellcheck source=/dev/null
. "$FM_ROOT_OVERRIDE/bin/fm-backend.sh"
EOF
    chmod +x "$native_dir/fm-backend.sh"
  fi
}

if [ "$USE_BB_TEARDOWN" = 1 ]; then
  export FM_BB_SKIP_TREEHOUSE=1
  export PATH="$INTEGRATION_BIN:$PATH"
  if fm_bb_load_config && [ "$FM_BB_ENABLED" = 1 ] && [ -n "$TASK_ID" ] && [ -n "$FM_BB_HOME_ID" ]; then
    meta="$FM_ROOT/state/$TASK_ID.meta"
    if [ -f "$meta" ]; then
      tid=$(grep '^bb_thread_id=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1 || true)
      if [ -n "$tid" ] && command -v bb >/dev/null 2>&1; then
        bb fleet detach --mate "$FM_BB_HOME_ID" --thread "$tid" >/dev/null 2>&1 || true
      fi
    fi
  fi
fi

link_native_teardown_libs "$FM_ROOT/bin" "$(dirname "$NATIVE")"
export FM_ROOT_OVERRIDE="$FM_ROOT"
export FM_HOME="${FM_HOME:-$FM_ROOT}"

set +e
"$NATIVE" "$@"
rc=$?
set -e

# Ad-hoc BB scouts are often absent from tasks-axi; native teardown can leave a
# stale backlog-close marker after the task record is already gone. Treat that
# as success when --force cleared local state.
if [ "$USE_BB_TEARDOWN" = 1 ] && [ -n "$TASK_ID" ] && [ "$rc" -ne 0 ]; then
  if [ ! -f "$FM_ROOT/state/${TASK_ID}.meta" ]; then
    backlog_close="$FM_ROOT/state/${TASK_ID}.backlog-close"
    if [ -e "$backlog_close" ] || [ -L "$backlog_close" ]; then
      rm -f "$backlog_close"
    fi
    rc=0
  fi
fi

exit "$rc"
