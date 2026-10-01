import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode, Home } from "./types";

const HOME: Home = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/unused",
  primaryMateId: "mate-1",
  mateThreadId: "thr_mate",
  defaultProfileId: null,
  createdAtMs: 1,
};

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function checkoutWithMeta(taskId: string, meta: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-sweep-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  await fs.writeFile(path.join(root, "state", `${taskId}.meta`), meta, "utf8");
  return root;
}

describe("sweepOrphans (P-SYNC-1)", () => {
  it("removes crew node when BB thread is archived (registry lag after detach)", async () => {
    const checkout = await checkoutWithMeta(
      "ship-1",
      ["fleet_detached=1", "kind=ship", "bb_thread_id=thr_arch"].join("\n"),
    );
    HOME.checkoutPath = checkout;

    const crew: FleetNode = {
      id: "n-crew",
      homeId: "tech",
      kind: "crew",
      parentId: "mate-1",
      threadId: "thr_arch",
      label: "ship-1",
      role: "ship",
      envId: null,
      deliveryMode: "no-mistakes",
      yolo: false,
      dispatchProfileId: null,
      createdAtMs: 1,
    };

    const nodes = new Map<string, FleetNode>([["n-crew", crew]]);
    const deleted: string[] = [];

    const store = {
      getHome: (homeId: string) => (homeId === "tech" ? HOME : undefined),
      listNodes: (homeId: string) =>
        [...nodes.values()].filter((node) => node.homeId === homeId),
      getNodeByThread: (threadId: string) =>
        [...nodes.values()].find((node) => node.threadId === threadId),
      deleteNode: (id: string) => {
        deleted.push(id);
        nodes.delete(id);
      },
      appendLedger: () => {},
      listHolds: () => [],
      countOpenHolds: () => 0,
      resolveHold: () => {},
      listInbox: () => [],
      resolveInbox: () => {},
      listWakes: () => [],
      ackWake: () => {},
    };

    const fleet = new FleetService(
      {
        sdk: {
          threads: {
            get: async ({ threadId }: { threadId: string }) => ({
              id: threadId,
              projectId: "proj-1",
              archivedAt: Date.now(),
            }),
          },
        },
        log: { warn: () => {} },
        realtime: { publish: () => {} },
      } as never,
      store as never,
    );

    const result = await fleet.sweepOrphans("tech");
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0]?.threadId, "thr_arch");
    assert.deepEqual(deleted, ["n-crew"]);
    assert.equal(nodes.size, 0);
  });
});
