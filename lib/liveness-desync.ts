/** P-V4: reconcile thread idle/alive vs semantic working ledger. */

import type { FsmState, LivenessVerdict } from "./types";

export type DesyncCase = {
  threadId: string;
  liveness: LivenessVerdict;
  threadStatus: string;
  semanticWorking: boolean;
};

export function detectLivenessDesync(input: {
  threadId: string;
  liveness: LivenessVerdict;
  threadStatus: string;
  semanticWorking: boolean;
}): DesyncCase | null {
  const status = input.threadStatus.toLowerCase();
  const idleLike = status === "idle" || status === "stopped";
  if (
    input.liveness === "alive" &&
    idleLike &&
    input.semanticWorking
  ) {
    return {
      threadId: input.threadId,
      liveness: input.liveness,
      threadStatus: input.threadStatus,
      semanticWorking: true,
    };
  }
  return null;
}

export function reconcileDesyncFsm(current: FsmState): FsmState {
  return current === "unknown" ? "working" : current;
}

export const DESYNC_LEDGER_VERB = "liveness.desync";
