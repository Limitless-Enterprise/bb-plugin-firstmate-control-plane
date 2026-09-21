import { BUSY_AGE_LEDGER_VERBS } from "./fsm";
import type { FsmState } from "./types";

/** Terminal FSM states — no stall / stale-idle supervision wakes. */
export function isTerminalFsm(fsm: FsmState): boolean {
  return fsm === "done" || fsm === "stopped" || fsm === "error";
}

export function shouldEnqueueStaleIdleWake(fsm: FsmState): boolean {
  return fsm === "idle";
}

const BLOCKED_LEDGER_VERBS = ["mark.blocked", "hold.open", "crew.blocked"];
const IDLE_UNBLOCK_LEDGER_VERBS = ["mark.idle", "crew.resolved", "crew.paused"];
const SUPERSEDES_WORKING_VERBS = [
  "mark.done",
  "crew.done",
  "task.complete",
  "control.exit",
  "control.stop",
  "thread.stopped",
  "turn.failed",
  "crew.failed",
  "mark.error",
  "liveness.dead",
  "mark.idle",
];

type LedgerProbe = {
  latestLedgerByVerbs(
    threadId: string,
    verbs: Iterable<string>,
  ): { createdAtMs: number } | null;
};

export function isSemanticallyBlocked(
  probe: LedgerProbe,
  threadId: string,
  hasOpenHolds: boolean,
): boolean {
  if (hasOpenHolds) return true;
  const lastBlocked = probe.latestLedgerByVerbs(threadId, BLOCKED_LEDGER_VERBS);
  if (!lastBlocked) return false;
  const lastUnblock = probe.latestLedgerByVerbs(
    threadId,
    IDLE_UNBLOCK_LEDGER_VERBS,
  );
  return !lastUnblock || lastBlocked.createdAtMs > lastUnblock.createdAtMs;
}

export function latestSemanticWorkingAtMs(
  probe: LedgerProbe,
  threadId: string,
): number | null {
  const lastWorking = probe.latestLedgerByVerbs(threadId, BUSY_AGE_LEDGER_VERBS);
  if (!lastWorking) return null;
  const superseding = probe.latestLedgerByVerbs(
    threadId,
    SUPERSEDES_WORKING_VERBS,
  );
  if (superseding && superseding.createdAtMs > lastWorking.createdAtMs) {
    return null;
  }
  return lastWorking.createdAtMs;
}

export function shouldEnqueueBusyAgeStall(
  probe: LedgerProbe,
  threadId: string,
  hasOpenHolds: boolean,
  busyAgeSec: number,
  nowMs = Date.now(),
): boolean {
  const workingAt = latestSemanticWorkingAtMs(probe, threadId);
  if (workingAt === null) return false;
  if (isSemanticallyBlocked(probe, threadId, hasOpenHolds)) return false;
  return nowMs - workingAt > busyAgeSec * 1000;
}

export function shouldEnqueueStaleIdleSupervision(
  fsm: FsmState,
  probe: LedgerProbe,
  threadId: string,
  hasOpenHolds: boolean,
): boolean {
  if (!shouldEnqueueStaleIdleWake(fsm)) return false;
  if (latestSemanticWorkingAtMs(probe, threadId) !== null) return false;
  return !isSemanticallyBlocked(probe, threadId, hasOpenHolds);
}
