#!/usr/bin/env bash
# Live P-U19 / P-SYNC checks against a running BB + Fleet plugin (tech mate home).
# Uses the same RPC transport as the Fleet Tree UI (`bb plugin rpc call`).
set -euo pipefail

BB="${BB_CLI:-bb}"
MATE="${MATE:-tech}"
FM_HOME="${FM_HOME:-/workspace/firstmates/firstmate-${MATE}}"
EXECUTE_MATE_RESET="${EXECUTE_MATE_RESET:-0}"
RUN_META_DETACH="${RUN_META_DETACH:-1}"

if ! command -v "$BB" >/dev/null 2>&1; then
  echo "Set BB_CLI or put bb on PATH" >&2
  exit 1
fi

pass=0
fail=0
record() {
  local id=$1 ok=$2 msg=$3
  if [ "$ok" = pass ]; then
    echo "  $id  PASS  $msg"
    pass=$((pass + 1))
  else
    echo "  $id  FAIL  $msg" >&2
    fail=$((fail + 1))
  fi
}

rpc() {
  local method=$1
  local input=${2:-'{"homeId":"'"$MATE"'"}'}
  "$BB" plugin rpc call firstmate-control-plane "$method" --input-file <(printf '%s' "$input") --json 2>&1
}

echo "=== P-U19 live RPC (mate=$MATE FM_HOME=$FM_HOME) ==="

"$BB" fleet sweep --mate "$MATE" >/dev/null 2>&1 || true

preflight=$(rpc resetMateThreadPreflight)
if echo "$preflight" | jq -e '.allowed == true' >/dev/null 2>&1; then
  record P-U19-preflight-empty pass "preflight allowed with no open crews"
else
  record P-U19-preflight-empty fail "$preflight"
fi

label="p-u19-live-$RANDOM"
spawn_out=$("$BB" fleet spawn --mate "$MATE" --role scout --label "$label" --prompt "Reply OK." 2>&1) || true
crew_thread=$(echo "$spawn_out" | sed -n 's/^Spawned scout //p')
if [ -z "$crew_thread" ]; then
  record P-U19-open-block fail "spawn failed: $spawn_out"
else
  blocked=$(rpc resetMateThreadPreflight)
  if echo "$blocked" | jq -e '.allowed == false and (.openChildren | length) >= 1' >/dev/null 2>&1; then
    record P-U19-open-block pass "preflight blocked for $crew_thread"
  else
    record P-U19-open-block fail "$blocked"
  fi

  reject=$("$BB" plugin rpc call firstmate-control-plane resetMateThread \
    --input-file <(printf '{"homeId":"%s"}' "$MATE") --json 2>&1) || true
  if echo "$reject" | grep -q "open crew threads remain"; then
    record P-U19-reset-reject pass "resetMateThread rejected with open crew"
  else
    record P-U19-reset-reject fail "$reject"
  fi

  "$BB" fleet detach --mate "$MATE" --thread "$crew_thread" >/dev/null 2>&1 ||
    "$BB" thread archive "$crew_thread" >/dev/null 2>&1 || true
  "$BB" fleet sweep --mate "$MATE" >/dev/null 2>&1 || true
  sleep 1
  allowed=$(rpc resetMateThreadPreflight)
  if echo "$allowed" | jq -e '.allowed == true' >/dev/null 2>&1; then
    record P-U19-archived-allow pass "preflight allowed after crew archived"
  else
    record P-U19-archived-allow fail "$allowed"
  fi
fi

if [ "$RUN_META_DETACH" = 1 ] && [ -d "$FM_HOME/bin" ]; then
  task="p-u19-meta-$RANDOM"
  (cd "$FM_HOME" && ./bin/fm-spawn.sh "$task" personal --scout --harness cursor >/dev/null) || true
  meta="$FM_HOME/state/${task}.meta"
  if [ -f "$meta" ]; then
    crew=$(grep '^bb_thread_id=' "$meta" | cut -d= -f2-)
    "$BB" fleet crew attach --mate "$MATE" --thread "$crew" --label "$task" --role scout >/dev/null 2>&1 || true
    "$BB" fleet detach --mate "$MATE" --thread "$crew" >/dev/null
    if grep -q '^fleet_detached=1' "$meta"; then
      record P-SYNC-meta-stamp pass "fleet_detached stamped on $task"
    else
      record P-SYNC-meta-stamp fail "missing fleet_detached on $meta"
    fi
    sweep=$("$BB" fleet sweep --mate "$MATE" 2>&1) || true
    children=$("$BB" fleet tree --mate "$MATE" --json | jq "[.. | objects | select(.threadId?==\"$crew\")] | length")
    if [ "$children" = 0 ]; then
      record P-SYNC-sweep-tree pass "detached crew absent from tree after sweep"
    else
      record P-SYNC-sweep-tree fail "tree still lists $crew ($sweep)"
    fi
  else
    record P-SYNC-meta-stamp fail "fm-spawn did not create $meta"
  fi
fi

if [ "$EXECUTE_MATE_RESET" = 1 ]; then
  before=$("$BB" fleet home list --json | jq -r ".[] | select(.homeId==\"$MATE\") | .mateThreadId")
  reset=$(rpc resetMateThread)
  after=$(echo "$reset" | jq -r .mateThreadId)
  archived=$("$BB" thread show "$before" --json | jq -r '.thread.archivedAt // empty')
  if [ -n "$after" ] && [ "$after" != "$before" ] && [ -n "$archived" ]; then
    record P-U19-mate-reset pass "new mate $after; archived $before"
    "$BB" fleet integration apply --mate "$MATE" >/dev/null
  else
    record P-U19-mate-reset fail "$reset (before=$before archived=$archived)"
  fi
else
  echo "  (skip mate reset — set EXECUTE_MATE_RESET=1 to run destructive check)"
fi

echo "=== Score: $pass pass · $fail fail ==="
[ "$fail" -eq 0 ]
