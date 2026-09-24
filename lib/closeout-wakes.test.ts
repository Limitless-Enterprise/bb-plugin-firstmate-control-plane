import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wakeTiedToCrewThread } from "./fleet-service";

describe("wakeTiedToCrewThread close-out (supervisor + terminal)", () => {
  it("matches supervisor mate wakes keyed to crew thread", () => {
    const crew = "thr_crew";
    for (const key of [
      `liveness:${crew}`,
      `stall:${crew}`,
      `stale-idle:${crew}`,
      `turn.failed:${crew}`,
    ]) {
      assert.equal(
        wakeTiedToCrewThread({ threadId: "thr_mate", dedupeKey: key }, crew, []),
        true,
        key,
      );
    }
  });
});
