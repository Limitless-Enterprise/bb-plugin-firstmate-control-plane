/** P-S3–S6, S8–S10: steer delivery semantics. */

export type SteerSendResult = "sent" | "unconfirmed" | "rejected";

export function shouldQueueSteerWhileBusy(input: {
  pendingInteraction: boolean;
  threadStatus: string;
}): boolean {
  if (input.pendingInteraction) return true;
  const status = input.threadStatus.toLowerCase();
  return status === "active" || status === "running";
}

export function isThreadReadyForSteer(input: {
  pendingInteraction: boolean;
  threadStatus: string;
}): boolean {
  if (input.pendingInteraction) return false;
  const status = input.threadStatus.toLowerCase();
  return status === "idle" || status === "stopped" || status === "error";
}

export function shouldRetryUnconfirmedSubmit(
  result: SteerSendResult | "sent" | "unconfirmed",
  attempts: number,
  maxAttempts = 3,
): boolean {
  return result === "unconfirmed" && attempts < maxAttempts;
}

export function shouldFirePostSteerStallWatchdog(input: {
  steerSentAtMs: number;
  lastProgressAtMs: number | null;
  nowMs: number;
  stallSec: number;
}): boolean {
  if (input.nowMs - input.steerSentAtMs < input.stallSec * 1000) return false;
  if (input.lastProgressAtMs === null) return true;
  return input.lastProgressAtMs < input.steerSentAtMs;
}

export function steerInboxTitle(label: string): string {
  return `Steer queued: ${label}`;
}

export function doorbellNudgeText(label: string): string {
  return `[fleet nudge] ${label}: captain ping — check thread.`;
}

export const CAPTAIN_ATTACH_LEDGER_VERB = "captain.attach";
