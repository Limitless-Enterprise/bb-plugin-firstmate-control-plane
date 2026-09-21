import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSemanticallyBlocked,
  isTerminalFsm,
  latestSemanticWorkingAtMs,
  shouldEnqueueBusyAgeStall,
  shouldEnqueueBusyAgeWake,
  shouldEnqueueStaleIdleSupervision,
  shouldEnqueueStaleIdleWake,
} from "./supervisor-wakes";

type Entry = { verb: string; createdAtMs: number };

function probe(entries: Entry[]) {
  return {
    latestLedgerByVerbs(threadId: string, verbs: Iterable<string>) {
      void threadId;
      const wanted = new Set(verbs);
      let best: Entry | null = null;
      for (const entry of entries) {
        if (!wanted.has(entry.verb)) continue;
        if (!best || entry.createdAtMs > best.createdAtMs) {
          best = entry;
        }
      }
      return best;
    },
  };
}

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

describe("semantic blocked and busy-age probes", () => {
  it("detects blocked when open holds exist", () => {
    assert.equal(
      isSemanticallyBlocked(probe([]), "t1", true),
      true,
    );
  });

  it("detects blocked when blocked verb is newer than unblock", () => {
    const p = probe([
      { verb: "mark.idle", createdAtMs: 100 },
      { verb: "crew.blocked", createdAtMs: 200 },
    ]);
    assert.equal(isSemanticallyBlocked(p, "t1", false), true);
  });

  it("is not blocked when unblock is newer than blocked verb", () => {
    const p = probe([
      { verb: "crew.blocked", createdAtMs: 100 },
      { verb: "mark.idle", createdAtMs: 200 },
    ]);
    assert.equal(isSemanticallyBlocked(p, "t1", false), false);
  });

  it("finds semantic working despite turn.end scroll-off", () => {
    const p = probe([{ verb: "crew.working", createdAtMs: 1000 }]);
    assert.equal(latestSemanticWorkingAtMs(p, "t1"), 1000);
  });

  it("clears semantic working when mark.idle is newer", () => {
    const p = probe([
      { verb: "crew.working", createdAtMs: 1000 },
      { verb: "mark.idle", createdAtMs: 2000 },
    ]);
    assert.equal(latestSemanticWorkingAtMs(p, "t1"), null);
  });

  it("stalls from aged semantic working without FSM gate", () => {
    const p = probe([{ verb: "crew.working", createdAtMs: 0 }]);
    assert.equal(
      shouldEnqueueBusyAgeStall(p, "t1", false, 60, 120_000),
      true,
    );
  });

  it("skips stale-idle when semantically blocked", () => {
    const p = probe([{ verb: "crew.blocked", createdAtMs: 500 }]);
    assert.equal(
      shouldEnqueueStaleIdleSupervision("idle", p, "t1", false),
      false,
    );
  });
});
