#!/usr/bin/env bash
# Behavioral contract checks for BB backend overlay (M1 partials B-O*, B-W4).
set -eu
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="$REPO/packages/bb-backend/overlay"
mkdir -p "$OVERLAY/.bb-integration/bin"
ln -sfn "$OVERLAY/bin/fm-bb-lib.sh" "$OVERLAY/.bb-integration/bin/fm-bb-lib.sh"
export FM_BB_BACKEND_ROOT="$OVERLAY"
BB="$OVERLAY/bin/backends/bb.sh"

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

echo "bb-backend M1 contract checks passed"
