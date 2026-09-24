import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode } from "./types";

const HOME = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/tech",
  primaryMateId: "mate-1",
  mateThreadId: "thr_mate",
  defaultProfileId: "prof-ship",
  createdAtMs: 1,
};

describe("buildTree UI fields (P-U5)", () => {
  it("includes prUrl and profileLabel on tree nodes", () => {
    const store = {
      listNodes: () => [
        {
          id: "mate-1",
          homeId: "tech",
          kind: "primary" as const,
          parentId: null,
          threadId: "thr_mate",
          label: "cto",
          role: null,
          envId: null,
          deliveryMode: "no-mistakes" as const,
          yolo: false,
          dispatchProfileId: null,
          createdAtMs: 1,
        },
        {
          id: "n-crew",
          homeId: "tech",
          kind: "crew" as const,
          parentId: "mate-1",
          threadId: "thr_crew",
          label: "ship-1",
          role: "ship" as const,
          envId: null,
          deliveryMode: "direct-PR" as const,
          yolo: true,
          dispatchProfileId: "prof-ship",
          createdAtMs: 2,
        },
      ],
      tailLedger: (threadId: string) =>
        threadId === "thr_crew"
          ? [
              {
                verb: "pr.opened",
                fsmState: "done",
                detail: { url: "https://github.com/o/r/pull/1" },
              },
            ]
          : [],
      listProfiles: () => [
        {
          id: "prof-ship",
          homeId: "tech",
          label: "Ship fast",
          providerId: null,
          model: null,
          effort: null,
          taskClasses: [],
        },
      ],
      getLiveness: () => null,
    };

    const fleet = new FleetService(
      { sdk: {}, log: {}, realtime: { publish: () => {} } } as never,
      store as never,
    );
    const tree = fleet.buildTree("tech");
    const crew = tree[0]?.children[0];
    assert.equal(crew?.prUrl, "https://github.com/o/r/pull/1");
    assert.equal(crew?.profileLabel, "Ship fast");
    assert.equal(crew?.deliveryMode, "direct-PR");
    assert.equal(crew?.yolo, true);
  });
});

describe("fleetNavCounts and snapshot (P-H12, P-U14, P-C5)", () => {
  it("aggregates inbox, wakes, and dead nodes", () => {
    const store = {
      getHome: (id: string) => (id === "tech" ? HOME : undefined),
      countOpenInbox: () => 2,
      countUnackedWakes: () => 3,
      countDeadNodes: () => 1,
      listNodes: () => [],
      tailLedger: () => [],
      listProfiles: () => [],
      getLiveness: () => null,
      listWakes: () => [],
      listHolds: () => [],
    };
    const fleet = new FleetService(
      { sdk: {}, log: {}, realtime: { publish: () => {} } } as never,
      store as never,
    );
    assert.deepEqual(fleet.fleetNavCounts("tech"), {
      inbox: 2,
      wakes: 3,
      dead: 1,
    });
    const snap = fleet.fleetSnapshot("tech");
    assert.equal(snap.digest.homeId, "tech");
    assert.equal(snap.bearings.homeId, "tech");
    assert.ok(snap.generatedAtMs > 0);
  });
});
