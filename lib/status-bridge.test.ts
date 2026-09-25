import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { StatusBridge } from "./status-bridge";
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

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function checkoutWithStatus(
  taskId: string,
  statusLine: string,
  threadId = "thr_crew",
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-status-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, `${taskId}.status`), `${statusLine}\n`, "utf8");
  await fs.writeFile(
    path.join(stateDir, `${taskId}.meta`),
    `bb_thread_id=${threadId}\n`,
    "utf8",
  );
  return root;
}

function bridgeHarness(options: {
  holds?: { threadId: string; title: string; state: "open" | "resolved" }[];
  deliveryMode?: FleetNode["deliveryMode"];
}) {
  const ledger: { verb: string; threadId: string }[] = [];
  const wakes: { reason: string; threadId: string; dedupeKey: string | null }[] = [];
  const inbox: { title: string; threadId: string; kind: string }[] = [];
  const decisions: { key: string; threadId: string }[] = [];
  const openHoldCalls: { title: string; threadId: string }[] = [];
  let published = 0;
  const holds = [...(options.holds ?? [])];

  const store = {
    appendLedger(row: { verb: string; threadId: string }) {
      ledger.push({ verb: row.verb, threadId: row.threadId });
    },
    recordDecision(input: { key: string; threadId: string }) {
      decisions.push({ key: input.key, threadId: input.threadId });
    },
    listRecordedDecisions() {
      return decisions.map((entry) => ({
        threadId: entry.threadId,
        key: entry.key,
      }));
    },
    enqueueWake(input: {
      reason: string;
      threadId: string;
      dedupeKey?: string | null;
    }): string | null {
      if (input.dedupeKey) {
        const existing = wakes.some(
          (wake) => wake.dedupeKey === input.dedupeKey,
        );
        if (existing) return null;
      }
      wakes.push({
        reason: input.reason,
        threadId: input.threadId,
        dedupeKey: input.dedupeKey ?? null,
      });
      return `wake-${wakes.length}`;
    },
    getHome(homeId: string) {
      return homeId === HOME.homeId ? HOME : undefined;
    },
    getNodeByThread(threadId: string) {
      if (threadId !== CREW.threadId) return undefined;
      return {
        ...CREW,
        deliveryMode: options.deliveryMode ?? CREW.deliveryMode,
      };
    },
    createInboxItem(input: {
      threadId: string;
      kind: string;
      title: string;
    }) {
      inbox.push({
        title: input.title,
        threadId: input.threadId,
        kind: input.kind,
      });
    },
    listHolds(_homeId: string, state: "open" | "resolved") {
      return holds.filter((hold) => hold.state === state);
    },
    listNodes(homeId: string) {
      return homeId === HOME.homeId ? [CREW] : [];
    },
  };

  const fleet = {
    async syncCrewsFromStateMeta() {},
    fsmForThread() {
      return "working" as const;
    },
    openHold(input: { threadId: string; title: string }) {
      openHoldCalls.push({ title: input.title, threadId: input.threadId });
      holds.push({
        threadId: input.threadId,
        title: input.title,
        state: "open",
      });
    },
    publish() {
      published += 1;
    },
  };

  let cursors: Record<
    string,
    number | { mtimeMs: number; tail: string | null }
  > = {};
  const bridge = new StatusBridge(
    store as never,
    fleet as never,
    async () => cursors,
    async (next) => {
      cursors = next;
    },
  );

  return {
    bridge,
    ledger,
    wakes,
    inbox,
    decisions,
    openHoldCalls,
    get published() {
      return published;
    },
  };
}

describe("StatusBridge scan (M1 bridge gaps)", () => {
  it("appends crew.note for note: status lines", async () => {
    const checkout = await checkoutWithStatus("t1", "note: ship blocked on API");
    const { bridge, ledger } = bridgeHarness({});
    const ingested = await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.equal(ingested, 1);
    assert.equal(ledger.some((row) => row.verb === "crew.note"), true);
  });

  it("records decision on resolved: lines", async () => {
    const checkout = await checkoutWithStatus("t1", "resolved: auth-model use JWT");
    const { bridge, decisions, ledger } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.deepEqual(decisions, [{ key: "auth-model", threadId: "thr_crew" }]);
    assert.ok(ledger.some((row) => row.verb === "crew.resolved"));
  });

  it("does not duplicate divergence ledger or inbox on status mtime rescan", async () => {
    const checkout = await checkoutWithStatus(
      "t1",
      "resolved: auth-model use JWT",
    );
    const { bridge, wakes, inbox, ledger } = bridgeHarness({
      holds: [
        {
          threadId: CREW.threadId,
          title: "auth-model pick JWT",
          state: "open",
        },
      ],
    });
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    const statusPath = path.join(checkout, "state", "t1.status");
    await fs.utimes(statusPath, new Date(), new Date(Date.now() + 1000));
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.equal(
      ledger.filter((row) => row.verb === "ledger.divergence").length,
      1,
    );
    assert.equal(
      inbox.filter((item) => item.title === "Status vs backlog divergence")
        .length,
      1,
    );
    assert.equal(
      wakes.filter(
        (wake) =>
          wake.dedupeKey === "divergence:thr_crew:resolved-with-open-hold",
      ).length,
      1,
    );
  });

  it("enqueues mate wake and inbox on resolved-with-open-hold divergence", async () => {
    const checkout = await checkoutWithStatus(
      "t1",
      "resolved: auth-model use JWT",
    );
    const { bridge, wakes, inbox, ledger } = bridgeHarness({
      holds: [
        {
          threadId: CREW.threadId,
          title: "auth-model pick JWT",
          state: "open",
        },
      ],
    });
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.ok(ledger.some((row) => row.verb === "ledger.divergence"));
    assert.ok(
      wakes.some(
        (wake) =>
          wake.threadId === HOME.mateThreadId &&
          wake.dedupeKey === "divergence:thr_crew:resolved-with-open-hold",
      ),
    );
    assert.ok(
      inbox.some(
        (item) =>
          item.kind === "wake" &&
          item.title === "Status vs backlog divergence",
      ),
    );
  });

  it("appends crew.needs-decision ledger verb", async () => {
    const checkout = await checkoutWithStatus("t1", "needs-decision: pick merge strategy");
    const { bridge, ledger, openHoldCalls } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.equal(openHoldCalls.length, 1);
    assert.ok(ledger.some((row) => row.verb === "crew.needs-decision"));
  });

  it("enqueues mate wake on terminal done:", async () => {
    const checkout = await checkoutWithStatus("t1", "done: finished task");
    const { bridge, wakes } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.ok(
      wakes.some(
        (wake) =>
          wake.threadId === HOME.mateThreadId &&
          wake.dedupeKey === "terminal:thr_crew:done:",
      ),
    );
  });

  it("enqueues pr.ready wake only when mode-aware checks pass", async () => {
    const url = "https://github.com/org/repo/pull/9";
    const checkout = await checkoutWithStatus("t1", `done: ${url} checks green`);
    const { bridge, wakes } = bridgeHarness({ deliveryMode: "no-mistakes" });
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.ok(wakes.some((wake) => wake.reason.startsWith("pr.ready:")));
  });

  it("enqueues blocked: wake tied to crew thread", async () => {
    const line = "blocked: waiting on review";
    const checkout = await checkoutWithStatus("t1", line);
    const { bridge, wakes } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.ok(
      wakes.some(
        (wake) =>
          wake.threadId === CREW.threadId &&
          wake.dedupeKey === `blocked:thr_crew:${line}`,
      ),
    );
  });

  it("enqueues mate wake on terminal failed:", async () => {
    const checkout = await checkoutWithStatus("t1", "failed: pipeline broke");
    const { bridge, wakes } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.ok(
      wakes.some(
        (wake) =>
          wake.threadId === HOME.mateThreadId &&
          wake.dedupeKey === "terminal:thr_crew:failed:",
      ),
    );
  });

  it("does not duplicate captain-hold inbox on done: mtime rescan", async () => {
    const checkout = await checkoutWithStatus("t1", "done: finished task");
    const { bridge, inbox, ledger } = bridgeHarness({
      holds: [{ threadId: CREW.threadId, title: "hold-a", state: "open" }],
    });
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    const statusPath = path.join(checkout, "state", "t1.status");
    await fs.utimes(statusPath, new Date(), new Date(Date.now() + 1000));
    await bridge.scanMateHome(HOME.homeId, [checkout]);
    assert.equal(
      inbox.filter((item) => item.kind === "hold").length,
      1,
    );
    assert.equal(ledger.filter((row) => row.verb === "crew.done").length, 1);
  });

  it("skips unchanged status files using mtime cursor (P-L6)", async () => {
    const checkout = await checkoutWithStatus("t1", "working: first pass");
    const { bridge, ledger } = bridgeHarness({});
    assert.equal(await bridge.scanMateHome(HOME.homeId, [checkout]), 1);
    assert.equal(ledger.filter((row) => row.verb === "crew.working").length, 1);
    assert.equal(await bridge.scanMateHome(HOME.homeId, [checkout]), 0);
    assert.equal(ledger.filter((row) => row.verb === "crew.working").length, 1);
  });

  it("ingests working: and paused: status verbs (B-ST2)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-status-"));
    tempRoots.push(root);
    const stateDir = path.join(root, "state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "t-work.status"),
      "working: shipping\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(stateDir, "t-work.meta"),
      "bb_thread_id=thr_crew\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(stateDir, "t-pause.status"),
      "paused: lunch\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(stateDir, "t-pause.meta"),
      "bb_thread_id=thr_crew\n",
      "utf8",
    );
    const { bridge, ledger } = bridgeHarness({});
    await bridge.scanMateHome(HOME.homeId, [root]);
    assert.ok(ledger.some((row) => row.verb === "crew.working"));
    assert.ok(ledger.some((row) => row.verb === "crew.paused"));
  });
});
