import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectFsm } from "./fsm";

describe("projectFsm", () => {
  it("keeps working through native idle until done", () => {
    const state = projectFsm([
      { verb: "crew.working", fsmState: "working" },
      { verb: "turn.end", fsmState: "idle" },
    ]);
    assert.equal(state, "working");
  });

  it("transitions to done on crew.done", () => {
    const state = projectFsm([
      { verb: "crew.working", fsmState: "working" },
      { verb: "crew.done", fsmState: "done" },
    ]);
    assert.equal(state, "done");
  });

  it("blocked beats later idle", () => {
    const state = projectFsm([
      { verb: "crew.blocked", fsmState: "blocked" },
      { verb: "turn.end", fsmState: "idle" },
    ]);
    assert.equal(state, "blocked");
  });

  it("blocked beats later turn.failed", () => {
    const state = projectFsm([
      { verb: "crew.blocked", fsmState: "blocked" },
      { verb: "turn.failed", fsmState: "error" },
    ]);
    assert.equal(state, "blocked");
  });

  it("stays done when pr.opened follows crew.done", () => {
    const state = projectFsm([
      { verb: "crew.done", fsmState: "done" },
      { verb: "pr.opened", fsmState: "done" },
    ]);
    assert.equal(state, "done");
  });
});
