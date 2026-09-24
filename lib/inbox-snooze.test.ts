import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { FleetStore, migrations } from "./db";

function memoryStore(): FleetStore {
  const db = new Database(":memory:");
  for (const sql of migrations) db.exec(sql);
  return new FleetStore(db);
}

describe("inbox snooze resurface (P-H10)", () => {
  it("returns expired snoozed items in open inbox listing", () => {
    const store = memoryStore();
    store.upsertHome({
      homeId: "tech",
      label: "tech",
      checkoutPath: "/tmp/tech",
      primaryMateId: "mate",
      mateThreadId: "thr_mate",
      defaultProfileId: null,
    });
    const item = store.createInboxItem({
      homeId: "tech",
      threadId: "thr_crew",
      kind: "hold",
      title: "blocked",
      body: "waiting",
    });
    store.snoozeInbox(item.id, Date.now() - 60_000);
    const open = store.listInbox("tech", "open");
    assert.equal(open.length, 1);
    assert.equal(open[0]?.id, item.id);
    assert.equal(open[0]?.state, "open");
    assert.equal(store.countOpenInbox("tech"), 1);
  });
});
