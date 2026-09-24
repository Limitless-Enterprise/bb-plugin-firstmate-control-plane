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
for arg in "$@"; do
  case "$arg" in
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
if fm_bb_enabled && [ -n "$TASK_ID" ]; then
  meta="$FM_ROOT/state/$TASK_ID.meta"
  if [ -f "$meta" ]; then
    backend=$(grep '^backend=' "$meta" 2>/dev/null | cut -d= -f2- | head -n1 || true)
    if [ "$backend" = bb ]; then
      USE_BB_TEARDOWN=1
    fi
  else
    backlog_close="$FM_ROOT/state/${TASK_ID}.backlog-close"
    backend_file="$FM_ROOT/config/backend"
    if [ -e "$backlog_close" ] || [ -L "$backlog_close" ]; then
      USE_BB_TEARDOWN=1
    elif [ -f "$backend_file" ] && [ "$(tr -d '[:space:]' <"$backend_file")" = bb ]; then
      USE_BB_TEARDOWN=1
    fi
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
        hold_json=$(bb fleet hold list --mate "$FM_BB_HOME_ID" --thread "$tid" --json 2>/dev/null) || {
          echo "fm-bb: teardown refused — could not verify open holds for ${TASK_ID}" >&2
          exit 2
        }
        open_holds=$(echo "$hold_json" | jq -r '.openCount // empty' 2>/dev/null) || {
          echo "fm-bb: teardown refused — could not parse hold list for ${TASK_ID}" >&2
          exit 2
        }
        if [ -z "$open_holds" ]; then
          echo "fm-bb: teardown refused — hold count missing for ${TASK_ID}" >&2
          exit 2
        fi
        if [ "$open_holds" -gt 0 ]; then
          echo "fm-bb: teardown refused — ${open_holds} open hold(s) on ${TASK_ID}" >&2
          exit 2
        fi
        bb fleet detach --mate "$FM_BB_HOME_ID" --thread "$tid" >/dev/null 2>&1
      fi
    fi
  fi
fi

if [ "$USE_BB_TEARDOWN" = 1 ]; then
  echo "treehouse: skipping pool return (BB-managed worktree)" >&2
fi

link_native_teardown_libs "$FM_ROOT/bin" "$(dirname "$NATIVE")"
export FM_ROOT_OVERRIDE="$FM_ROOT"
export FM_HOME="${FM_HOME:-$FM_ROOT}"

set +e
"$NATIVE" "$@"
rc=$?
set -e

# Ad-hoc BB scouts are often absent from tasks-axi; native teardown can leave a
# stale backlog-close marker after the task record is already gone. Treat meta
# cleared with that marker as success (AC9).
if [ "$USE_BB_TEARDOWN" = 1 ] && [ -n "$TASK_ID" ] && [ "$rc" -ne 0 ]; then
  if [ ! -f "$FM_ROOT/state/${TASK_ID}.meta" ]; then
    backlog_close="$FM_ROOT/state/${TASK_ID}.backlog-close"
    if [ -e "$backlog_close" ] || [ -L "$backlog_close" ]; then
      rm -f "$backlog_close"
      rc=0
    fi
  fi
fi

exit "$rc"
