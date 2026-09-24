import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  livenessWakeDedupeKey,
  probeVerdictAllowsRespawn,
  shouldSupervisorRespawnWake,
} from "./respawn-policy";

describe("respawn policy (P-V6–P-V8)", () => {
  it("respawns only when autoRespawn and dead/missing without holds or controlStop", () => {
    assert.equal(
      shouldSupervisorRespawnWake({
        autoRespawn: true,
        verdict: "dead",
        controlStop: false,
        hasOpenHolds: false,
      }),
      true,
    );
    assert.equal(
      shouldSupervisorRespawnWake({
        autoRespawn: true,
        verdict: "missing",
        controlStop: false,
        hasOpenHolds: false,
      }),
      true,
    );
    assert.equal(
      shouldSupervisorRespawnWake({
        autoRespawn: false,
        verdict: "dead",
        controlStop: false,
        hasOpenHolds: false,
      }),
      false,
    );
    assert.equal(
      shouldSupervisorRespawnWake({
        autoRespawn: true,
        verdict: "dead",
        controlStop: true,
        hasOpenHolds: false,
      }),
      false,
    );
    assert.equal(
      shouldSupervisorRespawnWake({
        autoRespawn: true,
        verdict: "dead",
        controlStop: false,
        hasOpenHolds: true,
      }),
      false,
    );
  });

  it("uses idempotent liveness dedupe keys", () => {
    assert.equal(livenessWakeDedupeKey("thr_a"), "liveness:thr_a");
    assert.equal(livenessWakeDedupeKey("thr_a"), livenessWakeDedupeKey("thr_a"));
  });

  it("never respawns on ambiguous (P-V3 gate)", () => {
    assert.equal(probeVerdictAllowsRespawn("ambiguous"), false);
    assert.equal(probeVerdictAllowsRespawn("alive"), false);
  });
});
