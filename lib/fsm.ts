import type { FsmState } from "./types";

const SEMANTIC_WORKING = new Set(["working", "blocked", "starting"]);

const NATIVE_IDLE_VERBS = new Set([
  "native.idle",
  "thread.idle",
  "turn.end",
]);

const DONE_VERBS = new Set(["mark.done", "crew.done", "task.complete"]);
export const BLOCKED_VERBS = new Set(["mark.blocked", "crew.blocked"]);
const WORKING_VERBS = new Set([
  "mark.working",
  "crew.working",
  "steer.sent",
  "turn.start",
]);

export const BUSY_AGE_LEDGER_VERBS = new Set([...WORKING_VERBS, "mark.starting"]);
const ERROR_VERBS = new Set(["turn.failed", "mark.error", "liveness.dead"]);
const STOPPED_VERBS = new Set(["control.exit", "control.stop", "thread.stopped"]);

export function projectFsm(
  entries: { verb: string; fsmState: string }[],
  nativeIdle = false,
): FsmState {
  let state: FsmState = "idle";
  for (const entry of entries) {
    const verb = entry.verb;
    if (DONE_VERBS.has(verb)) {
      state = "done";
      continue;
    }
    if (BLOCKED_VERBS.has(verb)) {
      state = "blocked";
      continue;
    }
    if (WORKING_VERBS.has(verb)) {
      state = "working";
      continue;
    }
    if (ERROR_VERBS.has(verb)) {
      if (state !== "blocked") {
        state = "error";
      }
      continue;
    }
    if (STOPPED_VERBS.has(verb)) {
      state = "stopped";
      continue;
    }
    if (verb === "mark.unknown" || verb === "liveness.ambiguous") {
      state = "unknown";
      continue;
    }
    if (NATIVE_IDLE_VERBS.has(verb)) {
      if (!SEMANTIC_WORKING.has(state)) {
        state = "idle";
      }
      continue;
    }
    if (entry.fsmState && entry.fsmState !== state) {
      state = entry.fsmState as FsmState;
    }
  }
  if (nativeIdle && state === "working") {
    // Caller may pass native idle hint separately; semantic working wins.
  }
  return state;
}

export function verbForMark(state: FsmState): string {
  return `mark.${state}`;
}
