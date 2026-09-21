import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTerminalFsm,
  shouldEnqueueBusyAgeWake,
  shouldEnqueueStaleIdleWake,
} from "./supervisor-wakes";

describe("supervisor wake eligibility (turn-end guard)", () => {
  it("does not stall-wake terminal done/stopped/error", () => {
    for (const fsm of ["done", "stopped", "error"] as const) {
      assert.equal(shouldEnqueueBusyAgeWake(fsm), false);
      assert.equal(isTerminalFsm(fsm), true);
    }
  });

  it("stall-wakes working and starting only", () => {
    assert.equal(shouldEnqueueBusyAgeWake("working"), true);
    assert.equal(shouldEnqueueBusyAgeWake("starting"), true);
    assert.equal(shouldEnqueueBusyAgeWake("idle"), false);
    assert.equal(shouldEnqueueBusyAgeWake("blocked"), false);
  });

  it("stale-idle wakes only idle FSM", () => {
    assert.equal(shouldEnqueueStaleIdleWake("idle"), true);
    assert.equal(shouldEnqueueStaleIdleWake("working"), false);
    assert.equal(shouldEnqueueStaleIdleWake("done"), false);
  });
});
