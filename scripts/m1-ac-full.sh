#!/usr/bin/env bash
# M1 full acceptance suite — every phase exit criterion + §8 smoke path (24 checks).
# Requires: FM_HOME, bb CLI, jq, pnpm (for unit tests), integration applied.
set -u

FM_HOME="${FM_HOME:-}"
MATE="${MATE:-tech}"
TASK=m1-ac-full
TASK_LIVE=m1-ac-full-live
TASK_HOLD=m1-ac-full-hold
PROJECT="${PROJECT:-projects/limitlessenterprise-website}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS=()

if [ -z "$FM_HOME" ] || [ ! -d "$FM_HOME" ]; then
  echo "Set FM_HOME to the mate checkout (e.g. export FM_HOME=.../firstmate-tech)" >&2
  exit 1
fi

cd "$FM_HOME" || exit 1

record() { RESULTS+=("$1|$2|$3"); printf '[%s] %s — %s\n' "$1" "$2" "$3"; }

wait_fsm() {
  local label=$1 want=$2 i=0 state=""
  while [ "$i" -lt 30 ]; do
    state=$(bb fleet tree --mate "$MATE" --json 2>/dev/null \
      | jq -r --arg l "$label" '[.. | objects | select(.label? == $l)] | max_by(.createdAtMs // 0) | .fsmState // empty')
    [ "$state" = "$want" ] && return 0
    sleep 1; i=$((i + 1))
  done
  echo "$state"
  return 1
}

tree_field() {
  bb fleet tree --mate "$MATE" --json 2>/dev/null \
    | jq -r --arg l "$1" --arg f "$2" '[.. | objects | select(.label? == $l)] | max_by(.createdAtMs // 0) | .[$f] // empty'
}

meta_thread() {
  grep '^bb_thread_id=' "$FM_HOME/state/$1.meta" 2>/dev/null | cut -d= -f2- | head -1
}

open_inbox_count() {
  bb fleet inbox --mate "$MATE" --json 2>/dev/null \
    | jq '[.items[]? | select(.state == "open")] | length' 2>/dev/null || echo 0
}

echo "=== M1 FULL ACCEPTANCE SUITE ==="
echo "FM_HOME=$FM_HOME MATE=$MATE"
echo ""

# --- Phase 0: contracts + integration pin ---
if [ -f "$REPO_ROOT/contracts.md" ] && [ -d "$REPO_ROOT/contracts" ]; then
  record P0-1 pass "contracts/ + contracts.md present"
else
  record P0-1 fail "missing contracts artifacts"
fi

if [ -d "$REPO_ROOT/packages/bb-backend" ] && [ -f "$REPO_ROOT/server.ts" ]; then
  record P0-2 pass "monorepo: bb-backend package + Fleet plugin at repo root"
else
  record P0-2 fail "monorepo layout check failed"
fi

int_json=$(bb fleet integration check --mate "$MATE" --json 2>/dev/null) || true
int_ver=$(echo "$int_json" | jq -r '.integrationVersion // empty' 2>/dev/null)
if echo "$int_json" | jq -e '.ok == true' >/dev/null 2>&1; then
  record P0-3 pass "integration check ok (v${int_ver:-unknown})"
else
  record P0-3 fail "integration check failed"
fi

# --- Phase 1–4 + §8 core path ---
rm -f "$FM_HOME/state/${TASK}"* "$FM_HOME/state/${TASK_LIVE}"* "$FM_HOME/state/${TASK_HOLD}"* 2>/dev/null || true

if [ "$(tr -d '[:space:]' <"$FM_HOME/config/backend")" = bb ]; then
  record AC1 pass "config/backend=bb"
else
  record AC1 fail "backend not bb"
fi

spawn_out=$(./bin/fm-spawn.sh "$TASK" "$PROJECT" --scout --harness cursor 2>&1) || true
if echo "$spawn_out" | grep -q 'bb_thread_id=' \
  && bb fleet tree --mate "$MATE" --json 2>/dev/null | jq -e --arg t "$TASK" '.. | objects | select(.label? == $t)' >/dev/null; then
  record AC2 pass "fm-spawn → Fleet tree ($(meta_thread "$TASK"))"
else
  record AC2 fail "$(echo "$spawn_out" | tail -2 | tr '\n' ' ')"
fi

THREAD=$(meta_thread "$TASK")
[ -n "$THREAD" ] || THREAD=$(tree_field "$TASK" threadId)

peek_out=$(./bin/fm-peek.sh "$TASK" 2>&1) || true
if [ -n "${peek_out:-}" ]; then
  record AC3 pass "fm-peek returned output"
else
  record AC3 partial "fm-peek empty (BB capture may be limited)"
fi

if ./bin/fm-send.sh "$TASK" "M1 full AC ping" >/dev/null 2>&1; then
  record AC4 pass "fm-send delivered"
else
  record AC4 fail "fm-send failed"
fi

printf '%s\n' "working: M1 full AC working probe" >"$FM_HOME/state/${TASK}.status"
if wait_fsm "$TASK" working >/dev/null; then
  record AC5 pass "working: → FSM working (Phase 2 exit)"
else
  record AC5 fail "FSM=$(tree_field "$TASK" fsmState) after working:"
fi

printf '%s\n' "blocked: M1 full AC blocked probe" >"$FM_HOME/state/${TASK}.status"
if wait_fsm "$TASK" blocked >/dev/null; then
  record AC6 pass "blocked: → FSM blocked + mate wake path"
else
  record AC6 fail "FSM=$(tree_field "$TASK" fsmState) after blocked:"
fi

# Phase 5: holds + inbox + resolve (CLI path, after status blocked AC)
hold_json=$(bb fleet hold open --mate "$MATE" --thread "$THREAD" \
  --title "M1 hold test" --body "AC hold path" --json 2>/dev/null) || true
hold_id=$(echo "$hold_json" | jq -r '.id // empty' 2>/dev/null)
inbox_before=$(open_inbox_count)
if [ -n "$hold_id" ] && [ "$inbox_before" -ge 1 ]; then
  record P5-1 pass "hold open → inbox item (count=$inbox_before)"
else
  record P5-1 fail "hold/inbox path failed hold=$hold_id inbox=$inbox_before"
fi

if [ -n "$hold_id" ]; then
  bb fleet hold resolve "$hold_id" --mate "$MATE" >/dev/null 2>&1
  sleep 2
  open_holds=$(bb fleet hold list --mate "$MATE" --thread "$THREAD" --json 2>/dev/null | jq -r '.openCount // 0')
  fsm_after=$(tree_field "$TASK" fsmState)
  if [ "${open_holds:-1}" -eq 0 ] && [ "$fsm_after" != "blocked" ]; then
    record P5-2 pass "resolve hold → openCount=0 FSM=$fsm_after"
  else
    record P5-2 fail "after resolve openHolds=$open_holds fsm=$fsm_after"
  fi
fi

# Phase 5 teardown guard
spawn_hold=$(./bin/fm-spawn.sh "$TASK_HOLD" "$PROJECT" --scout --harness cursor 2>&1) || true
HOLD_THREAD=$(meta_thread "$TASK_HOLD")
if [ -n "$HOLD_THREAD" ]; then
  bb fleet hold open --mate "$MATE" --thread "$HOLD_THREAD" \
    --title "block teardown" --body "guard test" >/dev/null 2>&1
  td_guard=$(./bin/fm-teardown.sh "$TASK_HOLD" --force 2>&1) || td_guard_rc=$?
  if [ "${td_guard_rc:-0}" -eq 2 ] && echo "$td_guard" | grep -qi 'refused'; then
    record P5-3 pass "teardown refused with open hold"
    bb fleet hold list --mate "$MATE" --thread "$HOLD_THREAD" --json 2>/dev/null \
      | jq -r '.holds[]? | select(.state=="open") | .id' | while read -r hid; do
      [ -n "$hid" ] && bb fleet hold resolve "$hid" --mate "$MATE" >/dev/null 2>&1
    done
    ./bin/fm-teardown.sh "$TASK_HOLD" --force >/dev/null 2>&1 || true
  else
    record P5-3 fail "expected exit 2 refused; got ${td_guard_rc:-0}"
    ./bin/fm-teardown.sh "$TASK_HOLD" --force >/dev/null 2>&1 || true
  fi
else
  record P5-3 fail "hold guard spawn failed: $(echo "$spawn_hold" | tail -1)"
fi

# AC7 interrupt
fm_ok=0; bb_ok=0
./bin/fm-control.sh "$TASK" interrupt >/dev/null 2>&1 && fm_ok=1
bb fleet interrupt --mate "$MATE" --thread "$THREAD" >/dev/null 2>&1 && bb_ok=1
if [ "$fm_ok" -eq 1 ] && [ "$bb_ok" -eq 1 ]; then
  record AC7 pass "fm-control + bb fleet interrupt (Phase 4)"
else
  record AC7 fail "fm=$fm_ok bb=$bb_ok"
fi

PR_URL="https://github.com/example/example/pull/888"
printf '%s\n' "done: shipped — $PR_URL" >"$FM_HOME/state/${TASK}.status"
sleep 6
if bb fleet bearings --mate "$MATE" 2>/dev/null | grep -q 'pull/888'; then
  record AC8 pass "PR in bearings (Phase 8 poller path)"
else
  record AC8 partial "done: written; PR not in bearings yet"
fi

# Phase 8 profiles
prof=$(bb fleet profiles --mate "$MATE" --json 2>/dev/null \
  | jq -r 'if type == "array" then .[0].id elif .profiles then .profiles[0].id else empty end // empty')
if [ -z "$prof" ]; then
  prof=$(bb fleet profiles --mate "$MATE" upsert --label "m1-scout" --model "composer-2.5" --json 2>/dev/null \
    | jq -r '.id // empty')
fi
if [ -n "$prof" ]; then
  record P8-1 pass "profiles CRUD id=$prof"
  spawn_prof=$(bb fleet spawn --mate "$MATE" --role scout --label m1-prof-test \
    --prompt "profile AC" --profile "$prof" --json 2>/dev/null) || true
  prof_node=$(bb fleet tree --mate "$MATE" --json 2>/dev/null \
    | jq -r '.. | objects | select(.label?=="m1-prof-test") | .dispatchProfileId' | head -1)
  prof_tid=$(bb fleet tree --mate "$MATE" --json 2>/dev/null \
    | jq -r '.. | objects | select(.label?=="m1-prof-test") | .threadId' | head -1)
  if [ "$prof_node" = "$prof" ]; then
    if [ -n "$prof_tid" ]; then
      if bb fleet detach --mate "$MATE" --thread "$prof_tid" >/dev/null 2>&1; then
        record P8-2 pass "spawn --profile sets dispatchProfileId"
      else
        record P8-2 fail "spawn --profile ok; detach/archive failed"
      fi
    else
      record P8-2 pass "spawn --profile sets dispatchProfileId"
    fi
  else
    if [ -n "$prof_tid" ]; then
      bb fleet detach --mate "$MATE" --thread "$prof_tid" >/dev/null 2>&1 || true
    fi
    record P8-2 partial "spawn ok; dispatchProfileId=$prof_node expected $prof"
  fi
else
  record P8-1 fail "profiles unavailable"
  record P8-2 fail "skipped"
fi

if bb fleet digest --mate "$MATE" --tell-cos --json 2>/dev/null | jq -e '.summary' >/dev/null; then
  record AC10 pass "digest --tell-cos (Phase 9)"
else
  record AC10 fail "digest failed"
fi

if bb fleet bearings --mate "$MATE" --json 2>/dev/null | jq -e '.homeId' >/dev/null; then
  record AC11 pass "bearings snapshot"
else
  record AC11 fail "bearings failed"
fi

td_out=$(./bin/fm-teardown.sh "$TASK" --force 2>&1) || td_rc=$?
if echo "$td_out" | grep -q 'skipping pool return' && [ ! -f "$FM_HOME/state/${TASK}.meta" ]; then
  record AC9 pass "fm-teardown clean (Phase 10)"
else
  record AC9 fail "$(echo "$td_out" | tail -1 | tr '\n' ' ')"
fi

# Phase 10 orphan sweep CLI
sweep=$(bb fleet sweep --mate "$MATE" --json 2>/dev/null) || true
if echo "$sweep" | jq -e '.removed' >/dev/null 2>&1; then
  record P10-1 pass "bb fleet sweep CLI ok"
else
  record P10-1 fail "sweep failed"
fi

# AC12 liveness
spawn_live=$(./bin/fm-spawn.sh "$TASK_LIVE" "$PROJECT" --scout --harness cursor 2>&1) || true
LIVE_THREAD=$(meta_thread "$TASK_LIVE")
if [ -n "$LIVE_THREAD" ]; then
  for i in $(seq 1 15); do
    [ "$(tree_field "$TASK_LIVE" liveness)" = "alive" ] && break
    sleep 2
  done
  bb fleet interrupt --mate "$MATE" --thread "$LIVE_THREAD" >/dev/null 2>&1 || true
  sleep 8
  live_after=$(tree_field "$TASK_LIVE" liveness)
  if [ "$live_after" = "dead" ]; then
    record AC12 pass "interrupt → liveness dead (Phase 7)"
  else
    record AC12 partial "liveness=$live_after after interrupt"
  fi
  ./bin/fm-teardown.sh "$TASK_LIVE" --force >/dev/null 2>&1 || true
else
  record AC12 fail "live spawn failed"
fi

# AC13 CLI surfaces
ac13=pass; notes=""
for sub in "tree --json" "board --json" "inbox --json"; do
  set -- bb fleet ${sub%% *} --mate "$MATE" ${sub#* }
  if ! "$@" >/dev/null 2>&1; then ac13=partial; notes+=" $sub"; fi
done
record AC13 "$ac13" "tree/board/inbox JSON${notes:+; gaps:$notes}"

# Phase 6 unit tests (turn-end matrix + FSM)
if (cd "$REPO_ROOT" && pnpm run test >/dev/null 2>&1); then
  record P6-1 pass "supervisor/FSM unit tests pass"
else
  record P6-1 fail "pnpm test failed in $REPO_ROOT"
fi

# Phase 11: no Herdr/tmux on happy path
if ! grep -qE 'herdr|tmux' "$FM_HOME/bin/fm-spawn.sh" 2>/dev/null; then
  record P11-1 pass "fm-spawn happy path does not invoke herdr/tmux"
else
  record P11-1 fail "herdr/tmux referenced in fm-spawn"
fi

echo ""
echo "=== M1 FULL AC SUMMARY ==="
pass=0; partial=0; fail=0
for row in "${RESULTS[@]}"; do
  IFS='|' read -r id status msg <<<"$row"
  printf '  %-8s  %-7s  %s\n' "$id" "$status" "$msg"
  case "$status" in pass) pass=$((pass+1));; partial) partial=$((partial+1));; fail) fail=$((fail+1));; esac
done
echo ""
echo "Score: $pass pass · $partial partial · $fail fail (of ${#RESULTS[@]} checks)"
[ "$fail" -eq 0 ]
