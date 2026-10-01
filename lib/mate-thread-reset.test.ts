import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatOpenChildBlockMessage,
  isBbThreadArchived,
  openChildBlockersFromNodes,
} from "./mate-thread-reset";
import type { FleetNode } from "./types";

describe("mate-thread-reset helpers", () => {
  it("treats archivedAt as archived", () => {
    assert.equal(isBbThreadArchived({ archivedAt: 1 }), true);
    assert.equal(isBbThreadArchived({ archivedAt: null }), false);
    assert.equal(isBbThreadArchived({}), false);
  });

  it("blocks only non-primary nodes with open BB threads", () => {
    const nodes: FleetNode[] = [
      {
        id: "p",
        homeId: "tech",
        kind: "primary",
        parentId: null,
        threadId: "thr_mate",
        label: "CTO",
        role: null,
        envId: null,
        deliveryMode: "no-mistakes",
        yolo: false,
        dispatchProfileId: null,
        createdAtMs: 1,
      },
      {
        id: "c1",
        homeId: "tech",
        kind: "crew",
        parentId: "p",
        threadId: "thr_open",
        label: "ship-1",
        role: "ship",
        envId: null,
        deliveryMode: "no-mistakes",
        yolo: false,
        dispatchProfileId: null,
        createdAtMs: 2,
      },
      {
        id: "c2",
        homeId: "tech",
        kind: "crew",
        parentId: "p",
        threadId: "thr_done",
        label: "ship-2",
        role: "ship",
        envId: null,
        deliveryMode: "no-mistakes",
        yolo: false,
        dispatchProfileId: null,
        createdAtMs: 3,
      },
    ];
    const archived = new Map<string, boolean>([
      ["thr_open", false],
      ["thr_done", true],
    ]);
    const blockers = openChildBlockersFromNodes(nodes, archived);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0]?.threadId, "thr_open");
    assert.match(formatOpenChildBlockMessage(blockers), /ship-1/);
  });
});
