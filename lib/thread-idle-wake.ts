import { projectFsm } from "./fsm";
import type { FleetNode } from "./types";

type ThreadIdleStore = {
  getNodeByThread(threadId: string): FleetNode | undefined;
  getHome(
    homeId: string,
  ): { mateThreadId: string; primaryMateId: string } | undefined;
  appendLedger(input: {
    homeId: string;
    threadId: string;
    verb: string;
    fsmState: string;
  }): void;
  tailLedger(
    threadId: string,
    limit: number,
  ): { verb: string; fsmState?: string }[];
  enqueueWake(input: {
    homeId: string;
    threadId: string;
    targetMateId: string;
    reason: string;
    priority: number;
    dedupeKey: string;
  }): void;
};

export function onThreadIdle(
  store: ThreadIdleStore,
  publish: () => void,
  threadId: string,
): void {
  const node = store.getNodeByThread(threadId);
  if (!node) return;
  store.appendLedger({
    homeId: node.homeId,
    threadId,
    verb: "turn.end",
    fsmState: projectFsm(store.tailLedger(threadId, 50).reverse()),
  });
  const home = store.getHome(node.homeId);
  if (home && node.threadId !== home.mateThreadId) {
    store.enqueueWake({
      homeId: node.homeId,
      threadId: home.mateThreadId,
      targetMateId: home.primaryMateId,
      reason: `thread.idle:${threadId}`,
      priority: 2,
      dedupeKey: `thread.idle:${threadId}`,
    });
  }
  publish();
}
