import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode, Hold } from "./types";

type LedgerRow = {
  threadId: string;
  verb: string;
  fsmState: string;
};

const TECH_HOME = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/tech",
  primaryMateId: "mate-1",
  mateThreadId: "thr_primary",
  defaultProfileId: null,
  createdAtMs: 1,
};

const CREW_NODE: FleetNode = {
  id: "n-crew",
  homeId: "tech",
  kind: "crew",
  parentId: null,
  threadId: "thr_crew",
  label: "ship-1",
  role: null,
  envId: null,
  deliveryMode: "no-mistakes",
  yolo: false,
  createdAtMs: 1,
};

type BbThreads = {
  archive: (input: { threadId: string }) => Promise<void>;
  stop: (input: { threadId: string }) => Promise<void>;
};

function mockFleetService(
  nodes: Map<string, FleetNode>,
  options: {
    holds?: Hold[];
    bbThreads?: Partial<BbThreads>;
  } = {},
): {
  fleet: FleetService;
  ledger: LedgerRow[];
  deleted: string[];
  holds: Hold[];
  bbEvents: string[];
} {
  const ledger: LedgerRow[] = [];
  const deleted: string[] = [];
  const holds = [...(options.holds ?? [])];
  const bbEvents: string[] = [];

  const archive =
    options.bbThreads?.archive ??
    (async ({ threadId }: { threadId: string }) => {
      bbEvents.push(`archive:${threadId}`);
    });
  const stop =
    options.bbThreads?.stop ??
    (async ({ threadId }: { threadId: string }) => {
      bbEvents.push(`stop:${threadId}`);
    });

  const store = {
    getHome(homeId: string) {
      return homeId === TECH_HOME.homeId ? TECH_HOME : undefined;
    },
    getNodeByThread(threadId: string): FleetNode | undefined {
      return [...nodes.values()].find((n) => n.threadId === threadId);
    },
    appendLedger(row: {
      threadId: string;
      verb: string;
      fsmState: string;
    }): void {
      ledger.unshift(row);
    },
    deleteNode(id: string): void {
      bbEvents.push(`deleteNode:${id}`);
      for (const [key, node] of nodes) {
        if (node.id === id) {
          nodes.delete(key);
          deleted.push(id);
        }
      }
    },
    listHolds(homeId: string, state: Hold["state"]): Hold[] {
      return holds.filter((h) => h.homeId === homeId && h.state === state);
    },
    countOpenHolds(homeId: string, threadId?: string): number {
      return holds.filter(
        (h) =>
          h.homeId === homeId &&
          h.state === "open" &&
          (threadId === undefined || h.threadId === threadId),
      ).length;
    },
    resolveHold(holdId: string): void {
      const hold = holds.find((h) => h.id === holdId);
      if (hold) {
        hold.state = "resolved";
        hold.resolvedAtMs = Date.now();
      }
    },
    upsertInboxFromHold(_item: Hold): void {},
  };

  const fleet = new FleetService(
    {
      sdk: { threads: { archive, stop } },
      log: { warn: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );
  return { fleet, ledger, deleted, holds, bbEvents };
}

describe("Fleet archive sync (P-SYNC-1)", () => {
  it("removes crew node when BB archives thread", () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const { fleet, ledger, deleted } = mockFleetService(nodes);
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_crew"), true);
    assert.deepEqual(deleted, ["n-crew"]);
    assert.equal(ledger[0]?.verb, "thread.archived");
    assert.equal(ledger[0]?.fsmState, "stopped");
    assert.equal(nodes.size, 0);
  });

  it("resolves open holds before registry close-out on BB archive", () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const openHold: Hold = {
      id: "hold-1",
      homeId: "tech",
      mateId: "mate-1",
      threadId: "thr_crew",
      title: "blocked",
      body: "wait",
      urgency: "normal",
      state: "open",
      createdAtMs: 1,
      resolvedAtMs: null,
    };
    const { fleet, deleted, holds } = mockFleetService(nodes, {
      holds: [openHold],
    });
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_crew"), true);
    assert.deepEqual(deleted, ["n-crew"]);
    assert.equal(holds[0]?.state, "resolved");
    assert.ok(holds[0]?.resolvedAtMs != null);
  });

  it("does not remove primary mate on archive event", () => {
    const nodes = new Map<string, FleetNode>([
      [
        "n-primary",
        {
          id: "n-primary",
          homeId: "tech",
          kind: "primary",
          parentId: null,
          threadId: "thr_primary",
          label: "cto",
          role: null,
          envId: null,
          deliveryMode: "no-mistakes",
          yolo: false,
          createdAtMs: 1,
        },
      ],
    ]);
    const { fleet, deleted } = mockFleetService(nodes);
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_primary"), false);
    assert.equal(deleted.length, 0);
    assert.equal(nodes.size, 1);
  });

  it("detachCrew archives BB thread before removing registry node", async () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const { fleet, deleted, bbEvents } = mockFleetService(nodes);
    await fleet.detachCrew("tech", "thr_crew");
    assert.deepEqual(deleted, ["n-crew"]);
    assert.equal(nodes.size, 0);
    const archiveIdx = bbEvents.indexOf("archive:thr_crew");
    const deleteIdx = bbEvents.indexOf("deleteNode:n-crew");
    assert.ok(archiveIdx >= 0);
    assert.ok(deleteIdx >= 0);
    assert.ok(archiveIdx < deleteIdx);
  });

  it("detachCrew leaves registry node when BB archive fails", async () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const { fleet, deleted } = mockFleetService(nodes, {
      bbThreads: {
        archive: async () => {
          throw new Error("archive unavailable");
        },
      },
    });
    await assert.rejects(
      () => fleet.detachCrew("tech", "thr_crew"),
      /archive unavailable/,
    );
    assert.equal(deleted.length, 0);
    assert.equal(nodes.size, 1);
  });
});
