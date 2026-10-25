/** Pure Fleet panel routing and copy helpers (P-H11, P-H14). */

import type { TreeNode } from "./types";

export type FleetTab = "fleet" | "inbox" | "board" | "homes";

export const FLEET_REALTIME_TOPIC = "fleet-changed";

export function fleetPanelFromSubPath(subPath?: string): {
  tab: FleetTab;
  threadId: string | null;
} {
  if (subPath?.startsWith("inbox")) {
    return { tab: "inbox", threadId: null };
  }
  if (subPath?.startsWith("board")) {
    return { tab: "board", threadId: null };
  }
  if (subPath?.startsWith("homes")) {
    return { tab: "homes", threadId: null };
  }
  const threadMatch = subPath?.match(/^thread\/(.+)$/);
  if (threadMatch) {
    return { tab: "fleet", threadId: threadMatch[1] };
  }
  return { tab: "fleet", threadId: null };
}

export function needsDecisionRailLine(
  holds: readonly { title: string }[],
): string | null {
  if (holds.length === 0) return null;
  const primary = holds[0]?.title ?? "Decision needed";
  if (holds.length === 1) return `Needs decision: ${primary}`;
  return `Needs decision: ${primary} (+${holds.length - 1})`;
}

/** Find a fleet tree node by BB thread id. */
export function findFleetTreeNode(
  tree: readonly TreeNode[],
  threadId: string,
): TreeNode | null {
  for (const node of tree) {
    if (node.threadId === threadId) return node;
    const child = findFleetTreeNode(node.children, threadId);
    if (child) return child;
  }
  return null;
}

export type FleetOverflowAction =
  | "interrupt"
  | "exitThread"
  | "relaunch"
  | "detachCrew";

export function fleetSteerPayload(
  homeId: string,
  threadId: string,
  text: string,
): { homeId: string; threadId: string; text: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { homeId, threadId, text: trimmed };
}

export function fleetOverflowRpcCall(
  action: FleetOverflowAction,
  homeId: string,
  threadId: string,
): { method: FleetOverflowAction; params: { homeId: string; threadId: string } } {
  return { method: action, params: { homeId, threadId } };
}

/** P-H10: operator reply includes inbox context plus their steer comment. */
export function inboxReplySteerText(input: {
  title: string;
  body: string;
  comment: string;
}): string | null {
  const comment = input.comment.trim();
  if (!comment) return null;
  const title = input.title.trim();
  const body = input.body.trim();
  const lines = ["Re: Fleet inbox"];
  if (title) lines.push(`Subject: ${title}`);
  if (body) lines.push("", "Context:", body);
  lines.push("", "Reply:", comment);
  return lines.join("\n");
}
