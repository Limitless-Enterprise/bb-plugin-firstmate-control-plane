#!/usr/bin/env bash
# BB integration wrapper for bin/fm-spawn.sh
# When config/bb-integration.json is enabled, ship/scout crews go through BB Fleet.
# Otherwise, or for unsupported modes, the native Firstmate spawn runs unchanged.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_BB_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=fm-bb-lib.sh
. "$SCRIPT_DIR/fm-bb-lib.sh"

NATIVE="$FM_BB_ROOT/.bb-integration/native/bin/fm-spawn.sh"
BB_SPAWN="$FM_BB_ROOT/.bb-integration/bin/fm-bb-spawn.sh"

if [ ! -x "$NATIVE" ]; then
  echo "fm-bb: native fm-spawn backup missing at $NATIVE" >&2
  exit 1
fi

if fm_bb_enabled; then
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
