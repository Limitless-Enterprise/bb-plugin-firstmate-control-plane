import type { FleetNode, NodeKind } from "./types";

export type OpenChildBlocker = {
  threadId: string;
  label: string;
  kind: NodeKind;
};

/** BB thread is archived when archivedAt is set (open child threads block mate reset). */
export function isBbThreadArchived(thread: {
  archivedAt?: number | null;
}): boolean {
  return thread.archivedAt != null;
}

export function openChildBlockersFromNodes(
  nodes: FleetNode[],
  archivedByThreadId: ReadonlyMap<string, boolean>,
): OpenChildBlocker[] {
  const blockers: OpenChildBlocker[] = [];
  for (const node of nodes) {
    if (node.kind === "primary") continue;
    const archived = archivedByThreadId.get(node.threadId);
    if (archived === true) continue;
    blockers.push({
      threadId: node.threadId,
      label: node.label,
      kind: node.kind,
    });
  }
  return blockers;
}

export function formatOpenChildBlockMessage(blockers: OpenChildBlocker[]): string {
  if (blockers.length === 0) return "";
  const lines = blockers
    .slice(0, 8)
    .map((b) => `${b.label} (${b.kind}, ${b.threadId})`);
  const extra =
    blockers.length > lines.length
      ? `\n…and ${blockers.length - lines.length} more.`
      : "";
  return `Cannot start a new mate thread while open crew threads remain. Archive or detach them first:\n${lines.join("\n")}${extra}`;
}
