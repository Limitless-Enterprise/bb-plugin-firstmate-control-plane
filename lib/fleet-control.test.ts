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
  defaultProfileId: null,
  createdAtMs: 1,
};

const CREW: FleetNode = {
  id: "n-crew",
  homeId: "tech",
  kind: "crew",
  parentId: null,
  threadId: "thr_crew",
  label: "ship-1",
  role: "ship",
  envId: null,
  deliveryMode: "no-mistakes",
  yolo: false,
  dispatchProfileId: null,
  createdAtMs: 1,
};

function controlFleet() {
  const events: string[] = [];
  const ledger: { verb: string; threadId: string }[] = [];
  const liveness: { threadId: string; verdict: string; detail: Record<string, unknown> }[] =
    [];
  let crewThreadId = CREW.threadId;

  const store = {
    getHome: () => HOME,
    getNodeByThread(threadId: string) {
      if (threadId === crewThreadId) {
        return { ...CREW, threadId: crewThreadId };
      }
      return undefined;
    },
    getNode(id: string) {
      return id === CREW.id ? { ...CREW, threadId: crewThreadId } : undefined;
    },
    listProfiles: () => [],
    countOpenHolds: () => 0,
    appendLedger(row: { verb: string; threadId: string }) {
      ledger.push(row);
    },
    setLiveness(
      threadId: string,
      _homeId: string,
      verdict: string,
      detail: Record<string, unknown>,
    ) {
      liveness.push({ threadId, verdict, detail });
    },
    updateNodeThread(id: string, threadId: string, envId: string | null) {
      if (id !== CREW.id) return undefined;
      crewThreadId = threadId;
      return { ...CREW, threadId, envId };
    },
  };

  const fleet = new FleetService(
    {
      sdk: {
        projects: { list: async () => [{ id: "proj-1", kind: "standard" }] },
        threads: {
          get: async ({ threadId }: { threadId: string }) => ({
            id: threadId,
            projectId: "proj-1",
          }),
          stop: async ({ threadId }: { threadId: string }) => {
            events.push(`stop:${threadId}`);
          },
          spawn: async () => {
            events.push("spawn:thr_new");
            return { id: "thr_new", environmentId: "env-new" };
          },
        },
        hosts: { list: async () => [{ id: "host-1" }] },
        environments: {
          create: async () => ({ id: "env-new", path: "/wt" }),
        },
      },
      log: { warn: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );

  return { fleet, events, ledger, liveness, get crewThreadId() { return crewThreadId; } };
}

describe("exitThread (B-C2)", () => {
  it("marks control stop dead and stops BB thread", async () => {
    const { fleet, events, ledger, liveness } = controlFleet();
    await fleet.exitThread("tech", "thr_crew");
    assert.ok(events.includes("stop:thr_crew"));
    assert.ok(ledger.some((row) => row.verb === "control.exit"));
    assert.equal(liveness[0]?.verdict, "dead");
    assert.equal(liveness[0]?.detail.controlStop, true);
  });
});

describe("relaunch (B-C3)", () => {
  it("spawns replacement thread and records control.relaunch", async () => {
    const { fleet, events, ledger } = controlFleet();
    await fleet.relaunch("tech", "thr_crew", "continue work");
    assert.ok(events.includes("stop:thr_crew"));
    assert.ok(events.includes("spawn:thr_new"));
    assert.ok(
      ledger.some(
        (row) => row.verb === "control.relaunch" && row.threadId === "thr_new",
      ),
    );
  });
});
