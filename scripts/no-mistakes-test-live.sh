#!/usr/bin/env bash
# Optional live layer for no-mistakes test step (same RPC as Fleet Tree UI).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if ! bb_path="$(bash "$root/scripts/resolve-bb-cli.sh")"; then
  echo "no-mistakes live: bb CLI not found (set BB_CLI); skipping scripts/p-u19-live-rpc.sh" >&2
  exit 0
fi

export BB_CLI="$bb_path"
export PATH="$(dirname "$bb_path"):${PATH:-}"
export MATE="${MATE:-tech}"
export FM_HOME="${FM_HOME:-/workspace/firstmates/firstmate-${MATE}}"
export RUN_META_DETACH="${RUN_META_DETACH:-1}"
export EXECUTE_MATE_RESET="${EXECUTE_MATE_RESET:-0}"

echo "no-mistakes live: BB_CLI=$BB_CLI MATE=$MATE" >&2
bash "$root/scripts/p-u19-live-rpc.sh"
