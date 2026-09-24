import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode, Hold, InboxItem, Wake } from "./types";

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
  dispatchProfileId: null,
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
    inbox: [] as InboxItem[],
    wakes: [] as Wake[],
    createInboxItem(input: {
      homeId: string;
      threadId: string;
      kind: InboxItem["kind"];
      title: string;
      body: string;
    }): InboxItem {
      const item: InboxItem = {
        id: `inbox-${store.inbox.length + 1}`,
        homeId: input.homeId,
        holdId: null,
        threadId: input.threadId,
        kind: input.kind,
        urgency: "normal",
        title: input.title,
        body: input.body,
        state: "open",
        snoozedUntilMs: null,
        createdAtMs: 1,
        resolvedAtMs: null,
      };
      store.inbox.push(item);
      return item;
    },
    listInbox(homeId: string, state?: InboxItem["state"]): InboxItem[] {
      return store.inbox.filter(
        (item) =>
          item.homeId === homeId && (state === undefined || item.state === state),
      );
    },
    resolveInbox(id: string): void {
      const item = store.inbox.find((candidate) => candidate.id === id);
      if (item) {
        item.state = "resolved";
        item.resolvedAtMs = Date.now();
      }
    },
    countOpenInbox(homeId: string): number {
      return store.inbox.filter(
        (item) => item.homeId === homeId && item.state === "open",
      ).length;
    },
    enqueueWake(input: {
      homeId: string;
      threadId?: string | null;
      reason: string;
      dedupeKey?: string | null;
    }): string {
      const wake: Wake = {
        id: `wake-${store.wakes.length + 1}`,
        homeId: input.homeId,
        threadId: input.threadId ?? null,
        targetMateId: null,
        reason: input.reason,
        priority: 0,
        dedupeKey: input.dedupeKey ?? null,
        acked: false,
        createdAtMs: 1,
      };
      store.wakes.push(wake);
      return wake.id;
    },
    listWakes(homeId: string, acked?: boolean): Wake[] {
      return store.wakes.filter(
        (wake) =>
          wake.homeId === homeId &&
          (acked === undefined || wake.acked === acked),
      );
    },
    ackWake(id: string): void {
      const wake = store.wakes.find((candidate) => candidate.id === id);
      if (wake) wake.acked = true;
    },
    countUnackedWakes(homeId: string): number {
      return store.wakes.filter(
        (wake) => wake.homeId === homeId && !wake.acked,
      ).length;
    },
    countDeadNodes(_homeId: string): number {
      return 0;
    },
  };

  const fleet = new FleetService(
    {
      sdk: { threads: { archive, stop } },
      log: { warn: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );
  return { fleet, ledger, deleted, holds, bbEvents, store };
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

  it("clears open inbox and unacked wakes on BB archive close-out", () => {
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
    const { fleet, store } = mockFleetService(nodes, { holds: [openHold] });
    store.createInboxItem({
      homeId: "tech",
      threadId: "thr_crew",
      kind: "wake",
      title: "Turn failed",
      body: "failed",
    });
    store.enqueueWake({
      homeId: "tech",
      threadId: "thr_crew",
      reason: "turn.failed",
      dedupeKey: "turn.failed:thr_crew",
    });
    store.enqueueWake({
      homeId: "tech",
      threadId: TECH_HOME.mateThreadId,
      reason: "hold:hold-1",
      dedupeKey: "hold:hold-1",
    });
    assert.equal(fleet.fleetNavCounts("tech").inbox, 1);
    assert.equal(fleet.fleetNavCounts("tech").wakes, 2);
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_crew"), true);
    assert.equal(fleet.fleetNavCounts("tech").inbox, 0);
    assert.equal(fleet.fleetNavCounts("tech").wakes, 0);
  });

  it("clears mate-targeted terminal and idle wakes on BB archive close-out", () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const { fleet, store } = mockFleetService(nodes);
    store.enqueueWake({
      homeId: "tech",
      threadId: TECH_HOME.mateThreadId,
      reason: "terminal:done:task-1",
      dedupeKey: "terminal:thr_crew:done:",
    });
    store.enqueueWake({
      homeId: "tech",
      threadId: TECH_HOME.mateThreadId,
      reason: "thread.idle:thr_crew",
      dedupeKey: "thread.idle:thr_crew",
    });
    assert.equal(fleet.fleetNavCounts("tech").wakes, 2);
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_crew"), true);
    assert.equal(fleet.fleetNavCounts("tech").wakes, 0);
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
          dispatchProfileId: null,
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

  it("detachCrew clears inbox and wakes before removing registry node", async () => {
    const nodes = new Map<string, FleetNode>([["n-crew", { ...CREW_NODE }]]);
    const { fleet, store } = mockFleetService(nodes);
    store.createInboxItem({
      homeId: "tech",
      threadId: "thr_crew",
      kind: "wake",
      title: "Turn failed",
      body: "failed",
    });
    store.enqueueWake({
      homeId: "tech",
      threadId: "thr_crew",
      reason: "turn.failed",
      dedupeKey: "turn.failed:thr_crew",
    });
    store.enqueueWake({
      homeId: "tech",
      threadId: TECH_HOME.mateThreadId,
      reason: "thread.idle:thr_crew",
      dedupeKey: "thread.idle:thr_crew",
    });
    assert.equal(fleet.fleetNavCounts("tech").inbox, 1);
    assert.equal(fleet.fleetNavCounts("tech").wakes, 2);
    await fleet.detachCrew("tech", "thr_crew");
    assert.equal(fleet.fleetNavCounts("tech").inbox, 0);
    assert.equal(fleet.fleetNavCounts("tech").wakes, 0);
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
