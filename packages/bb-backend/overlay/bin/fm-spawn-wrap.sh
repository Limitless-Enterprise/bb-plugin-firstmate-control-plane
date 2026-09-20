#!/usr/bin/env bash
# BB integration wrapper for bin/fm-spawn.sh
# Routes ship/scout crews through BB when integration is enabled.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_BB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$FM_BB_ROOT/.bb-integration/bin/fm-bb-lib.sh"

NATIVE="$FM_BB_ROOT/.bb-integration/native/bin/fm-spawn.sh"
BB_SPAWN="$FM_BB_ROOT/.bb-integration/bin/fm-bb-spawn.sh"

if [ ! -x "$NATIVE" ]; then
  echo "fm-bb: native fm-spawn backup missing at $NATIVE" >&2
  exit 1
fi

BACKEND_FILE="$FM_BB_ROOT/config/backend"
USE_BB=0
if fm_bb_enabled; then
  if [ -f "$BACKEND_FILE" ]; then
    case "$(tr -d '[:space:]' <"$BACKEND_FILE")" in
      bb) USE_BB=1 ;;
    esac
  fi
fi

if [ "$USE_BB" = 1 ]; then
  for arg in "$@"; do
    case "$arg" in
      --relaunch|--secondmate)
        exec "$NATIVE" "$@"
        ;;
    esac
  done
  exec "$BB_SPAWN" "$@"
fi

exec "$NATIVE" "$@"
