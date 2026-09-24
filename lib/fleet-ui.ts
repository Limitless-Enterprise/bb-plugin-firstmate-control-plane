/** Pure Fleet panel routing and copy helpers (P-H11, P-H14, P-U8). */

import { FLEET_CHANGED } from "./fleet-service";

export { FLEET_CHANGED };

export type FleetTab = "fleet" | "inbox" | "board" | "homes";

export const FLEET_REALTIME_TOPIC = FLEET_CHANGED;

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

/** Tailwind classes for mobile tree drawer visibility (P-U8). */
export function mobileTreeDrawerHidden(treeOpen: boolean): string {
  return treeOpen ? "" : "max-md:hidden";
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
