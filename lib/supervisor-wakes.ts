import type { FsmState } from "./types";

/** Terminal FSM states — no stall / stale-idle supervision wakes. */
export function isTerminalFsm(fsm: FsmState): boolean {
  return fsm === "done" || fsm === "stopped" || fsm === "error";
}

export function shouldEnqueueBusyAgeWake(fsm: FsmState): boolean {
  return !isTerminalFsm(fsm) && (fsm === "working" || fsm === "starting");
}

export function shouldEnqueueStaleIdleWake(fsm: FsmState): boolean {
  return fsm === "idle";
}
