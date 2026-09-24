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

function probeFleet(getThread: () => Promise<Record<string, unknown>>) {
  const liveness: {
    threadId: string;
    verdict: string;
    detail: Record<string, unknown>;
  }[] = [];

  const store = {
    getHome: () => HOME,
    getNodeByThread(threadId: string) {
      if (threadId === CREW.threadId) return CREW;
      return undefined;
    },
    getLiveness(threadId: string) {
      const row = liveness.find((item) => item.threadId === threadId);
      return row
        ? {
            verdict: row.verdict,
            probedAtMs: Date.now(),
            detail: row.detail,
          }
        : undefined;
    },
    setLiveness(
      threadId: string,
      _homeId: string,
      verdict: string,
      detail: Record<string, unknown>,
    ) {
      const existing = liveness.find((item) => item.threadId === threadId);
      if (existing) {
        existing.verdict = verdict;
        existing.detail = detail;
      } else {
        liveness.push({ threadId, verdict, detail });
      }
    },
  };

  const fleet = new FleetService(
    {
      sdk: {
        threads: {
          get: async () => getThread(),
        },
      },
      log: { warn: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );

  return { fleet, liveness };
}

describe("probeThread pipeline (P-V3)", () => {
  it("records alive for active crew thread", async () => {
    const { fleet, liveness } = probeFleet(async () => ({
      status: "active",
      environmentId: "env-1",
      runtime: { displayStatus: "working" },
    }));
    assert.equal(await fleet.probeThread("thr_crew"), "alive");
    assert.equal(liveness[0]?.verdict, "alive");
  });

  it("records dead when crew idle without environment", async () => {
    const { fleet } = probeFleet(async () => ({
      status: "idle",
      environmentId: null,
      runtime: { displayStatus: "idle" },
    }));
    assert.equal(await fleet.probeThread("thr_crew"), "dead");
  });

  it("records ambiguous when BB lookup fails", async () => {
    const { fleet } = probeFleet(async () => {
      throw new Error("network");
    });
    assert.equal(await fleet.probeThread("thr_crew"), "ambiguous");
  });

  it("returns missing when thread not in registry", async () => {
    const store = {
      getNodeByThread: () => undefined,
      setLiveness: () => {},
    };
    const fleet = new FleetService(
      { sdk: { threads: { get: async () => ({}) } }, log: {}, realtime: {} } as never,
      store as never,
    );
    assert.equal(await fleet.probeThread("thr_unknown"), "missing");
  });
});
