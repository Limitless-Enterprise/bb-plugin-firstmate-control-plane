/** P-H5–H7: captain holds, deliverable park, authority → CoS. */

import type { HoldKind, Urgency } from "./types";

export function normalizeHoldKind(kind?: string | null): HoldKind {
  if (kind === "captain" || kind === "authority") return kind;
  return "decision";
}

export function isCaptainHoldKind(kind: HoldKind): boolean {
  return kind === "captain" || kind === "authority";
}

export function authorityEscalationWakeReason(holdId: string): string {
  return `authority:hold:${holdId}`;
}

export function deliverableParkedInboxTitle(taskLabel: string): string {
  return `Deliverable ready (hold intact): ${taskLabel}`;
}

export function captainHoldDefaultUrgency(kind: HoldKind): Urgency {
  return kind === "authority" ? "high" : "normal";
}

export function routeHoldNotifyThreadId(input: {
  holdKind: HoldKind;
  mateThreadId: string;
  cosThreadId: string | null;
}): string {
  if (input.holdKind === "authority" && input.cosThreadId) {
    return input.cosThreadId;
  }
  return input.mateThreadId;
}
