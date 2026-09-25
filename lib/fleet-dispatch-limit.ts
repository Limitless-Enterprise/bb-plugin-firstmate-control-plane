/** P-D8: max concurrent active crews / dispatch wait. */

import type { FleetNode, FsmState } from "./types";

export const DEFAULT_MAX_CREW_CONCURRENCY = 6;

export function countActiveCrewSlots(
  nodes: FleetNode[],
  fsmForThread: (threadId: string) => FsmState,
): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind !== "crew") continue;
    const fsm = fsmForThread(node.threadId);
    if (fsm === "working" || fsm === "starting" || fsm === "blocked") {
      count += 1;
    }
  }
  return count;
}

export function canDispatchCrew(active: number, maxConcurrency: number): boolean {
  return active < Math.max(1, maxConcurrency);
}

export function dispatchWaitMessage(active: number, maxConcurrency: number): string {
  return `dispatch wait: ${active}/${maxConcurrency} crew slots in use`;
}
