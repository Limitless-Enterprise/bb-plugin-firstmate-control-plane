import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onThreadIdle } from "./thread-idle-wake";
import type { FleetNode } from "./types";

const HOME = {
  homeId: "tech",
  mateThreadId: "thr_mate",
  primaryMateId: "mate-1",
};

const CREW: FleetNode = {
  id: "n-crew",
  homeId: "tech",
  kind: "crew",
  parentId: "mate-1",
  threadId: "thr_crew",
  label: "ship-1",
  role: "ship",
  envId: null,
  deliveryMode: "no-mistakes",
  yolo: false,
  dispatchProfileId: null,
  createdAtMs: 1,
};

describe("onThreadIdle (P-L5)", () => {
  it("enqueues mate wake for crew thread idle", () => {
    const ledger: { verb: string; threadId: string }[] = [];
    const wakes: { reason: string; threadId: string; dedupeKey: string }[] = [];
    let published = 0;
    const store = {
      getNodeByThread(threadId: string) {
        return threadId === CREW.threadId ? CREW : undefined;
      },
      getHome(homeId: string) {
        return homeId === HOME.homeId ? HOME : undefined;
      },
      appendLedger(row: { verb: string; threadId: string }) {
        ledger.push({ verb: row.verb, threadId: row.threadId });
      },
      tailLedger() {
        return [];
      },
      enqueueWake(input: {
        reason: string;
        threadId: string;
        dedupeKey: string;
      }) {
        wakes.push({
          reason: input.reason,
          threadId: input.threadId,
          dedupeKey: input.dedupeKey,
        });
      },
    };
    onThreadIdle(store, () => {
      published += 1;
    }, "thr_crew");
    assert.equal(ledger[0]?.verb, "turn.end");
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0]?.reason, "thread.idle:thr_crew");
    assert.equal(wakes[0]?.threadId, "thr_mate");
    assert.equal(wakes[0]?.dedupeKey, "thread.idle:thr_crew");
    assert.equal(published, 1);
  });

  it("does not enqueue wake when primary mate thread idles", () => {
    const wakes: unknown[] = [];
    const primary: FleetNode = {
      ...CREW,
      id: "n-primary",
      kind: "primary",
      threadId: "thr_mate",
    };
    const store = {
      getNodeByThread() {
        return primary;
      },
      getHome(homeId: string) {
        return homeId === HOME.homeId ? HOME : undefined;
      },
      appendLedger() {},
      tailLedger() {
        return [];
      },
      enqueueWake(input: unknown) {
        wakes.push(input);
      },
    };
    onThreadIdle(store, () => {}, "thr_mate");
    assert.equal(wakes.length, 0);
  });
});
