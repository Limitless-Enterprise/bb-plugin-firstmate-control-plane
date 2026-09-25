import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrPoller, prUrlFromLedgerDetail } from "./pr-poller";
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

const PR_URL = "https://github.com/org/repo/pull/9";

function pollerHarness(
  resolveCheckState: (
    url: string,
  ) => Promise<"SUCCESS" | "FAILURE" | "PENDING" | "unavailable">,
  snapshot:
    | Record<string, unknown>
    | (() => Record<string, unknown>) = { state: "OPEN" },
) {
  const ledger: { verb: string; threadId: string; detail?: Record<string, unknown> }[] =
    [];
  const wakes: { reason: string; dedupeKey: string | null; threadId: string | null }[] =
    [];
  const inbox: { title: string; threadId: string }[] = [];
  let seen: Record<string, string> = {};
  let published = 0;

  const store = {
    listNodes(homeId: string) {
      return homeId === HOME.homeId ? [CREW] : [];
    },
    tailLedger(threadId: string) {
      return ledger.filter((row) => row.threadId === threadId);
    },
    appendLedger(row: {
      homeId: string;
      threadId: string;
      verb: string;
      fsmState: string;
      detail?: Record<string, unknown>;
    }) {
      ledger.push({
        verb: row.verb,
        threadId: row.threadId,
        detail: row.detail,
      });
    },
    getHome(homeId: string) {
      return homeId === HOME.homeId ? HOME : undefined;
    },
    enqueueWake(input: {
      homeId: string;
      threadId: string;
      targetMateId: string;
      reason: string;
      dedupeKey: string;
    }) {
      wakes.push({
        reason: input.reason,
        dedupeKey: input.dedupeKey,
        threadId: input.threadId,
      });
    },
    createInboxItem(input: {
      homeId: string;
      threadId: string;
      kind: string;
      title: string;
      body: string;
    }) {
      inbox.push({ title: input.title, threadId: input.threadId });
    },
  };

  const fleet = {
    publish() { published += 1; },
    fsmForThread(_threadId: string) { return "working"; },
  };

  const poller = new PrPoller(
    store as never,
    fleet as never,
    async () => seen,
    async (next) => {
      seen = next;
    },
    async (url) => ({
      checkState: await resolveCheckState(url),
      snapshot: typeof snapshot === "function" ? snapshot() : snapshot,
    }),
  );

  ledger.push({
    verb: "pr.opened",
    threadId: CREW.threadId,
    detail: { url: PR_URL },
  });

  return {
    poller,
    ledger,
    wakes,
    inbox,
    getSeen: () => seen,
    getPublished: () => published,
  };
}

describe("prUrlFromLedgerDetail (P-P2)", () => {
  it("reads PR URL from ledger detail", () => {
    assert.equal(
      prUrlFromLedgerDetail({ url: PR_URL }),
      PR_URL,
    );
    assert.equal(
      prUrlFromLedgerDetail({ line: `done: ${PR_URL}` }),
      PR_URL,
    );
  });
});

describe("PrPoller.pollHome (P-P2, P-P3)", () => {
  it("writes pr.checks.pending ledger on first poll", async () => {
    const { poller, ledger, getPublished } = pollerHarness(async () => "PENDING");
    const updates = await poller.pollHome("tech");
    assert.equal(updates, 1);
    assert.ok(ledger.some((row) => row.verb === "pr.checks.pending"));
    assert.equal(getPublished(), 1);
  });

  it("enqueues pr.green wake and inbox on SUCCESS", async () => {
    const { poller, ledger, wakes, inbox } = pollerHarness(async () => "SUCCESS");
    await poller.pollHome("tech");
    assert.ok(ledger.some((row) => row.verb === "pr.checks.success"));
    assert.ok(wakes.some((wake) => wake.dedupeKey === "pr.green:thr_crew"));
    assert.equal(inbox.length, 1);
  });

  it("enqueues pr.failed wake on FAILURE", async () => {
    const { poller, wakes } = pollerHarness(async () => "FAILURE");
    await poller.pollHome("tech");
    assert.ok(wakes.some((wake) => wake.dedupeKey === "pr.failed:thr_crew"));
  });

  it("does not duplicate ledger when check state unchanged", async () => {
    const { poller, ledger } = pollerHarness(async () => "PENDING");
    await poller.pollHome("tech");
    const countAfterFirst = ledger.filter((row) => row.verb.startsWith("pr.checks.")).length;
    await poller.pollHome("tech");
    assert.equal(
      ledger.filter((row) => row.verb.startsWith("pr.checks.")).length,
      countAfterFirst,
    );
  });
});

describe("PrPoller.pollHome lifecycle (P-P8, P-P9)", () => {
  it("writes review-requested ledger and pr.review wake", async () => {
    const { poller, ledger, wakes } = pollerHarness(
      async () => "PENDING",
      { state: "OPEN", reviewDecision: "REVIEW_REQUIRED" },
    );
    await poller.pollHome("tech");
    assert.ok(ledger.some((row) => row.verb === "pr.review.requested"));
    assert.ok(wakes.some((wake) => wake.reason.startsWith("pr.review:")));
  });

  it("writes commits-pushed ledger and pr.commits wake", async () => {
    const { poller, ledger, wakes } = pollerHarness(
      async () => "PENDING",
      { state: "OPEN", mergeStateStatus: "BEHIND" },
    );
    await poller.pollHome("tech");
    assert.ok(ledger.some((row) => row.verb === "pr.commits.pushed"));
    assert.ok(wakes.some((wake) => wake.reason.startsWith("pr.commits:")));
  });

  it("retires poll keys after merge", async () => {
    let snapshot: Record<string, unknown> = { state: "OPEN" };
    const { poller, ledger, getSeen } = pollerHarness(
      async () => "SUCCESS",
      () => snapshot,
    );
    await poller.pollHome("tech");
    assert.ok(getSeen()[`${CREW.threadId}:${PR_URL}`]);
    snapshot = { state: "MERGED" };
    await poller.pollHome("tech");
    assert.ok(ledger.some((row) => row.verb === "pr.merged"));
    assert.equal(getSeen()[`${CREW.threadId}:${PR_URL}`], undefined);
    assert.equal(getSeen()[`${CREW.threadId}:${PR_URL}:lifecycle`], undefined);
  });
});
