import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode } from "./types";

type LedgerRow = {
  threadId: string;
  verb: string;
  fsmState: string;
};

function mockFleetService(nodes: Map<string, FleetNode>): {
  fleet: FleetService;
  ledger: LedgerRow[];
  deleted: string[];
} {
  const ledger: LedgerRow[] = [];
  const deleted: string[] = [];
  const store = {
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
      for (const [key, node] of nodes) {
        if (node.id === id) {
          nodes.delete(key);
          deleted.push(id);
        }
      }
    },
  };
  const fleet = new FleetService(
    {
      sdk: { threads: { archive: async () => {} } },
      log: { warn: () => {} },
    } as never,
    store as never,
  );
  return { fleet, ledger, deleted };
}

describe("Fleet archive sync (P-SYNC-1)", () => {
  it("removes crew node when BB archives thread", () => {
    const nodes = new Map<string, FleetNode>([
      [
        "n-crew",
        {
          id: "n-crew",
          homeId: "tech",
          kind: "crew",
          parentId: null,
          threadId: "thr_crew",
          label: "ship-1",
          deliveryMode: "no-mistakes",
          yolo: false,
          createdAtMs: 1,
        },
      ],
    ]);
    const { fleet, ledger, deleted } = mockFleetService(nodes);
    assert.equal(fleet.closeOutRegistryForArchivedThread("thr_crew"), true);
    assert.deepEqual(deleted, ["n-crew"]);
    assert.equal(ledger[0]?.verb, "thread.archived");
    assert.equal(ledger[0]?.fsmState, "stopped");
    assert.equal(nodes.size, 0);
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
});
