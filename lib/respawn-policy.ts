import type { LivenessVerdict } from "./types";

/** P-V6 / P-V7: supervisor respawn wake eligibility. */
export function shouldSupervisorRespawnWake(input: {
  autoRespawn: boolean;
  verdict: LivenessVerdict;
  controlStop: boolean;
  hasOpenHolds: boolean;
}): boolean {
  if (!input.autoRespawn) return false;
  if (input.controlStop) return false;
  if (input.hasOpenHolds) return false;
  return input.verdict === "dead" || input.verdict === "missing";
}

/** P-V8: stable dedupe for respawn / liveness mate wakes. */
export function livenessWakeDedupeKey(crewThreadId: string): string {
  return `liveness:${crewThreadId}`;
}

/** P-V3: never treat ambiguous as dead for respawn. */
export function probeVerdictAllowsRespawn(verdict: LivenessVerdict): boolean {
  return verdict === "dead" || verdict === "missing";
}
