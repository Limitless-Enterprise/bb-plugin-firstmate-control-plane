import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { FleetService } from "./fleet-service";

const HOME = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/tech",
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

async function checkoutWithMeta(
  taskId: string,
  meta: string,
  statusLine?: string,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-sync-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, `${taskId}.meta`), meta, "utf8");
  if (statusLine) {
    await fs.writeFile(
      path.join(stateDir, `${taskId}.status`),
      `${statusLine}\n`,
      "utf8",
    );
  }
  return root;
}

describe("syncCrewsFromStateMeta (B-S9)", () => {
  it("registers ship crew from state meta and seeds ledger", async () => {
    const checkout = await checkoutWithMeta(
      "ship-1",
      [
        "kind=ship",
        "bb_thread_id=thr_ship",
        "mode=no-mistakes",
      ].join("\n"),
      "working: onboarding",
    );

    const inserted: { threadId: string; label: string }[] = [];
    const ledger: { verb: string; threadId: string }[] = [];

    const store = {
      getHome: () => HOME,
      listNodes: () => [],
      insertNode(input: { threadId: string; label: string }) {
        inserted.push({ threadId: input.threadId, label: input.label });
      },
      appendLedger(row: { verb: string; threadId: string }) {
        ledger.push(row);
      },
      setLiveness: () => {},
    };

    const fleet = new FleetService(
      { sdk: {}, log: { warn: () => {} }, realtime: { publish: () => {} } } as never,
      store as never,
    );

    const synced = await fleet.syncCrewsFromStateMeta("tech", [checkout]);
    assert.equal(synced, 1);
    assert.deepEqual(inserted, [{ threadId: "thr_ship", label: "ship-1" }]);
    assert.ok(ledger.some((row) => row.verb === "crew.working"));
  });
});
