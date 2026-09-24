import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { Hold } from "./types";

const HOME = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/tech",
  primaryMateId: "mate-1",
  mateThreadId: "thr_mate",
  defaultProfileId: null,
  createdAtMs: 1,
};

function digestFleet(options: {
  livenessVerdict?: string;
  holds?: Hold[];
}) {
  const holds = options.holds ?? [];
  const store = {
    getHome(homeId: string) {
      return homeId === HOME.homeId ? HOME : undefined;
    },
    listNodes(homeId: string) {
      if (homeId !== HOME.homeId) return [];
      return [
        {
          id: "n-primary",
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
      ];
    },
    tailLedger() {
      return [];
    },
    listProfiles() {
      return [];
    },
    getLiveness(threadId: string) {
      if (threadId !== "thr_mate") return null;
      if (!options.livenessVerdict) return null;
      return {
        verdict: options.livenessVerdict,
        probedAtMs: Date.now(),
        detail: null,
      };
    },
    countOpenInbox() {
      return 0;
    },
    listWakes() {
      return [];
    },
    listHolds(_homeId: string, state: Hold["state"]) {
      return holds.filter((hold) => hold.state === state);
    },
  };

  const fleet = new FleetService(
    { sdk: {}, log: {}, realtime: { publish: () => {} } } as never,
    store as never,
  );
  return fleet;
}

describe("fleet digest and bearings (P-C4, B-ST3)", () => {
  it("prefixes digest summary when mate liveness is dead", () => {
    const fleet = digestFleet({ livenessVerdict: "dead" });
    const digest = fleet.buildDigest("tech");
    assert.match(digest.summary, /^MATE DOWN/);
  });

  it("includes open decision titles in bearings lines", () => {
    const hold: Hold = {
      id: "hold-1",
      homeId: "tech",
      mateId: "mate-1",
      threadId: "thr_crew",
      title: "pick auth model",
      body: "needs-decision:",
      urgency: "high",
      state: "open",
      createdAtMs: 1,
      resolvedAtMs: null,
    };
    const fleet = digestFleet({ holds: [hold] });
    const bearings = fleet.buildBearings("tech");
    assert.ok(
      bearings.lines.some((line) => line.includes("Open decisions (1): pick auth model")),
    );
  });

  it("builds full digest node summary (P-C3)", () => {
    const store = {
      getHome: (homeId: string) => (homeId === HOME.homeId ? HOME : undefined),
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
          deliveryMode: "no-mistakes" as const,
          yolo: false,
          dispatchProfileId: null,
          createdAtMs: 2,
        },
      ],
      tailLedger: (threadId: string) =>
        threadId === "thr_crew"
          ? [{ verb: "crew.working", fsmState: "working" }]
          : [],
      listProfiles: () => [],
      getLiveness: () => null,
      countOpenInbox: () => 1,
      listWakes: () => [{ acked: false }],
      listHolds: () => [],
    };
    const fleet = new FleetService(
      { sdk: {}, log: {}, realtime: { publish: () => {} } } as never,
      store as never,
    );
    const digest = fleet.buildDigest("tech");
    assert.equal(digest.nodes.length, 2);
    assert.equal(digest.openInbox, 1);
    assert.equal(digest.unackedWakes, 1);
    assert.match(digest.summary, /1 working/);
  });
});
