/** P-W7, W9, W10, W12, W15–W20 supervisor helpers. */

export function pauseResurfaceDueMs(
  pausedAtMs: number,
  cadenceSec: number,
  nowMs = Date.now(),
): boolean {
  return nowMs - pausedAtMs >= cadenceSec * 1000;
}

export function nextWedgeEscalationCount(priorCount: number): number {
  return priorCount + 1;
}

export function shouldEscalateWedge(staleCount: number, threshold = 3): boolean {
  return staleCount >= threshold;
}

export function wedgeWakeReason(threadId: string): string {
  return `wedge:${threadId}`;
}

export function shouldDeferStaleIdleForWorktreeMtime(input: {
  lastStatusMs: number;
  worktreeMtimeMs: number;
  quietSec: number;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  if (input.worktreeMtimeMs <= input.lastStatusMs) return false;
  return now - input.worktreeMtimeMs < input.quietSec * 1000;
}

export function supervisorDeadAlarmDue(input: {
  lockExpiresMs: number;
  lastBeaconMs: number;
  nowMs: number;
  graceMs: number;
}): boolean {
  if (input.lockExpiresMs > input.nowMs) return false;
  return input.nowMs - input.lastBeaconMs > input.graceMs;
}

export function awayPostureKvKey(homeId: string): string {
  return `fleet.away.${homeId}`;
}

export function buildReturnBrief(input: {
  awayStartedMs: number;
  nowMs: number;
  inboxOpened: number;
  wakesUnacked: number;
  divergences: number;
}): string {
  const minutes = Math.max(1, Math.round((input.nowMs - input.awayStartedMs) / 60_000));
  return [
    `Return brief (${minutes}m away)`,
    `${input.inboxOpened} inbox opened`,
    `${input.wakesUnacked} unacked wakes`,
    input.divergences > 0
      ? `${input.divergences} divergence(s) recorded`
      : "no divergences",
  ].join(" · ");
}

export function startupInactiveScanReason(threadId: string): string {
  return `startup-inactive:${threadId}`;
}

export function instructionRefreshReason(threadId: string): string {
  return `instruction-refresh:${threadId}`;
}

export function checkKindWakeReason(kind: string): string {
  return `check:${kind}`;
}

export function recoveryEpisodeId(threadId: string, nowMs = Date.now()): string {
  return `recovery:${threadId}:${nowMs}`;
}

export function recoveryWakeReason(episodeId: string): string {
  return `recovery:${episodeId}`;
}
