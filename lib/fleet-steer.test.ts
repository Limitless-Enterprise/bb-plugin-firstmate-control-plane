import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";

describe("bb fleet steer (P-S1)", () => {
  it("refuses steer while interaction is pending", async () => {
    const store = {
      getHome: (homeId: string) =>
        homeId === "tech" ? { homeId: "tech" } : undefined,
      getNodeByThread: () => ({
        id: "n1",
        homeId: "tech",
        threadId: "thr_crew",
      }),
    };
    const fleet = new FleetService(
      {
        sdk: {
          threads: {
            interactions: {
              list: async () => [{ status: "pending" }],
            },
          },
        },
        log: {},
        realtime: { publish: () => {} },
      } as never,
      store as never,
    );
    await assert.rejects(
      () => fleet.steer("tech", "thr_crew", "hello"),
      /interaction is pending/,
    );
  });

  it("sends text and appends steer.sent ledger on success", async () => {
    let sent = false;
    const ledger: { verb: string }[] = [];
    const store = {
      getHome: (homeId: string) =>
        homeId === "tech" ? { homeId: "tech" } : undefined,
      getNodeByThread: () => ({
        id: "n1",
        homeId: "tech",
        threadId: "thr_crew",
      }),
      tailLedger: () => [{ verb: "crew.working", fsmState: "working" }],
      appendLedger: (row: { verb: string }) => ledger.push(row),
      createInboxItem: () => ({ id: "inbox-1" }),
    };
    const fleet = new FleetService(
      {
        sdk: {
          threads: {
            interactions: { list: async () => [] },
            get: async () => ({ status: "idle" }),
            send: async () => {
              sent = true;
            },
          },
        },
        storage: { kv: { set: async () => {}, get: async () => null } },
        log: {},
        realtime: { publish: () => {} },
      } as never,
      store as never,
    );
    await fleet.steer("tech", "thr_crew", "adjust plan");
    assert.equal(sent, true);
    assert.equal(ledger[0]?.verb, "steer.sent");
  });
});
