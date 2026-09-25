/** B-ST4 / P-L7: status log vs backlog (holds/decisions) mismatch. */

export type DivergenceCase = {
  threadId: string;
  taskId: string;
  kind: "resolved-with-open-hold" | "done-with-open-hold" | "fsm-idle-hold-open";
  decisionKey?: string;
  holdTitle?: string;
};

export function detectStatusBacklogDivergence(input: {
  threadId: string;
  taskId: string;
  statusPrefix: string;
  decisionKey?: string;
  openHolds: { threadId: string; title: string; decisionKey?: string | null }[];
  fsmState: string;
}): DivergenceCase | null {
  const holdsOnThread = input.openHolds.filter((h) => h.threadId === input.threadId);
  if (holdsOnThread.length === 0) return null;

  if (input.statusPrefix === "resolved:" && input.decisionKey) {
    const decisionKey = input.decisionKey;
    const stillOpen = holdsOnThread.some(
      (hold) =>
        hold.decisionKey === decisionKey ||
        hold.title.includes(decisionKey),
    );
    if (stillOpen) {
      return {
        threadId: input.threadId,
        taskId: input.taskId,
        kind: "resolved-with-open-hold",
        decisionKey: input.decisionKey,
        holdTitle: holdsOnThread[0]?.title,
      };
    }
  }

  if (input.statusPrefix === "done:" && holdsOnThread.length > 0) {
    return {
      threadId: input.threadId,
      taskId: input.taskId,
      kind: "done-with-open-hold",
      holdTitle: holdsOnThread[0]?.title,
    };
  }

  if (
    (input.fsmState === "idle" || input.fsmState === "done") &&
    holdsOnThread.some((h) => h.decisionKey)
  ) {
    return {
      threadId: input.threadId,
      taskId: input.taskId,
      kind: "fsm-idle-hold-open",
      holdTitle: holdsOnThread[0]?.title,
    };
  }

  return null;
}

export function formatDivergenceRecord(entry: DivergenceCase): string {
  const key = entry.decisionKey ? ` key=${entry.decisionKey}` : "";
  const hold = entry.holdTitle ? ` hold="${entry.holdTitle}"` : "";
  return `RECORD DIVERGENCE ${entry.kind} task=${entry.taskId} thread=${entry.threadId}${key}${hold}`;
}

export const DIVERGENCE_LEDGER_VERB = "ledger.divergence";
