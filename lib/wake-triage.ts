/** P-W4: classify supervisor wake reasons as actionable vs absorb-only. */

const ABSORB_PREFIXES = [
  "heartbeat:",
  "progress:",
  "crew.progress",
  "thread.idle:",
  "check:ok:",
];

const ACTIONABLE_PREFIXES = [
  "blocked:",
  "hold:",
  "terminal:failed:",
  "pr.checks.failed:",
  "liveness.dead:",
  "liveness.missing:",
  "stall:",
  "stale-idle:",
  "wedge:",
  "supervisor.dead:",
  "divergence:",
  "authority:",
  "pr.review:",
  "pr.changes:",
  "pr.merged:",
  "recovery:",
];

export function isActionableWakeReason(reason: string): boolean {
  const trimmed = reason.trim();
  if (!trimmed) return false;
  if (ABSORB_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return false;
  }
  if (ACTIONABLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  if (trimmed.startsWith("terminal:done:")) return true;
  if (trimmed.startsWith("pr.checks.green:")) return true;
  if (trimmed.startsWith("pr.ready:")) return true;
  if (trimmed.startsWith("paused:resurface:")) return true;
  return trimmed.startsWith("demand-deep-inspection:");
}

export function shouldEnqueueMateWake(reason: string, awayPosture: boolean): boolean {
  if (awayPosture && !reason.startsWith("authority:") && !reason.startsWith("hold:")) {
    return false;
  }
  return isActionableWakeReason(reason);
}
