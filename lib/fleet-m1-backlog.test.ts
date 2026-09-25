import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBatchSpawnJson } from "./fleet-batch-spawn";
import {
  canDispatchCrew,
  countActiveCrewSlots,
  dispatchWaitMessage,
} from "./fleet-dispatch-limit";
import {
  authorityEscalationWakeReason,
  isCaptainHoldKind,
  normalizeHoldKind,
  routeHoldNotifyThreadId,
} from "./fleet-captain-holds";
import { filterInboxItems, INBOX_FILTER_LABELS } from "./fleet-inbox-filters";
import {
  detectLivenessDesync,
  reconcileDesyncFsm,
} from "./liveness-desync";
import {
  prStateFromSnapshot,
  heldForMergeStatusLine,
  parseGithubWebhookEvent,
  shouldRetirePollAfterMerge,
} from "./pr-github-events";
import {
  detectStatusBacklogDivergence,
  formatDivergenceRecord,
} from "./status-divergence";
import {
  isProgressOnlyStatusLine,
  PROGRESS_LEDGER_VERB,
} from "./status-progress";
import {
  doorbellNudgeText,
  shouldFirePostSteerStallWatchdog,
  shouldQueueSteerWhileBusy,
  shouldRetryUnconfirmedSubmit,
} from "./fleet-steer-delivery";
import {
  pauseResurfaceDueMs,
  shouldDeferStaleIdleForWorktreeMtime,
  shouldEscalateWedge,
  supervisorDeadAlarmDue,
  buildReturnBrief,
} from "./supervisor-policy";
import {
  isActionableWakeReason,
  shouldEnqueueMateWake,
} from "./wake-triage";

describe("M1 backlog modules", () => {
  it("wake triage (P-W4, P-W15)", () => {
    assert.equal(isActionableWakeReason("blocked:task-1"), true);
    assert.equal(isActionableWakeReason("heartbeat:ok"), false);
    assert.equal(
      shouldEnqueueMateWake("stall:thr", true),
      false,
    );
    assert.equal(
      shouldEnqueueMateWake("authority:hold:1", true),
      true,
    );
  });

  it("status divergence (B-ST4, P-L7)", () => {
    const div = detectStatusBacklogDivergence({
      threadId: "thr_c",
      taskId: "task-1",
      statusPrefix: "resolved:",
      decisionKey: "Q1",
      openHolds: [
        { threadId: "thr_c", title: "Q1 ship?", decisionKey: "Q1" },
      ],
      fsmState: "idle",
    });
    assert.ok(div);
    assert.match(formatDivergenceRecord(div!), /RECORD DIVERGENCE/);
  });

  it("progress-only touch (P-L8)", () => {
    assert.equal(isProgressOnlyStatusLine("progress: still coding"), true);
    assert.equal(PROGRESS_LEDGER_VERB, "crew.progress");
  });

  it("dispatch limit (P-D8)", () => {
    const nodes = [
      {
        kind: "crew" as const,
        threadId: "a",
        id: "1",
        homeId: "tech",
        parentId: null,
        label: "a",
        role: "ship" as const,
        envId: null,
        deliveryMode: "no-mistakes" as const,
        yolo: false,
        dispatchProfileId: null,
        createdAtMs: 1,
      },
    ];
    const active = countActiveCrewSlots(nodes, () => "working");
    assert.equal(active, 1);
    assert.equal(canDispatchCrew(active, 1), false);
    assert.match(dispatchWaitMessage(1, 1), /dispatch wait/);
  });

  it("liveness desync (P-V4)", () => {
    const desync = detectLivenessDesync({
      threadId: "thr",
      liveness: "alive",
      threadStatus: "idle",
      semanticWorking: true,
    });
    assert.ok(desync);
    assert.equal(reconcileDesyncFsm("unknown"), "working");
  });

  it("steer delivery (P-S3–S6, S9)", () => {
    assert.equal(
      shouldQueueSteerWhileBusy({
        pendingInteraction: false,
        threadStatus: "running",
      }),
      true,
    );
    assert.equal(shouldRetryUnconfirmedSubmit("unconfirmed", 1), true);
    assert.equal(
      shouldFirePostSteerStallWatchdog({
        steerSentAtMs: 0,
        lastProgressAtMs: null,
        nowMs: 120_000,
        stallSec: 60,
      }),
      true,
    );
    assert.match(doorbellNudgeText("crew-a"), /nudge/);
  });

  it("captain holds (P-H5–H7)", () => {
    assert.equal(normalizeHoldKind("captain"), "captain");
    assert.equal(isCaptainHoldKind("authority"), true);
    assert.equal(
      routeHoldNotifyThreadId({
        holdKind: "authority",
        mateThreadId: "mate",
        cosThreadId: "cos",
      }),
      "cos",
    );
    assert.match(authorityEscalationWakeReason("h1"), /^authority:/);
  });

  it("supervisor policy (P-W7, W9, W10, W12, W16)", () => {
    assert.equal(pauseResurfaceDueMs(0, 60, 61_000), true);
    assert.equal(shouldEscalateWedge(3), true);
    assert.equal(
      shouldDeferStaleIdleForWorktreeMtime({
        lastStatusMs: 100,
        worktreeMtimeMs: 200,
        quietSec: 120,
        nowMs: 250,
      }),
      true,
    );
    assert.equal(
      supervisorDeadAlarmDue({
        lockExpiresMs: 0,
        lastBeaconMs: 0,
        nowMs: 60_000,
        graceMs: 5_000,
      }),
      true,
    );
    assert.match(buildReturnBrief({
      awayStartedMs: 0,
      nowMs: 120_000,
      inboxOpened: 2,
      wakesUnacked: 1,
      divergences: 0,
    }), /Return brief/);
  });

  it("pr github events (P-P5–P-P9, P-P7)", () => {
    assert.equal(
      shouldRetirePollAfterMerge(prStateFromSnapshot({ state: "MERGED" })),
      true,
    );
    assert.match(heldForMergeStatusLine("https://github.com/o/r/pull/1"), /held-for-merge/);
    const wh = parseGithubWebhookEvent({
      action: "closed",
      pull_request: { html_url: "https://github.com/o/r/pull/2" },
    });
    assert.equal(wh?.prUrl?.includes("pull/2"), true);
  });

  it("batch spawn (B-S8)", () => {
    const specs = parseBatchSpawnJson(
      '[{"label":"a","role":"ship","prompt":"go"}]',
    );
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.label, "a");
  });

  it("inbox filters (P-H9)", () => {
    const items = [
      {
        id: "1",
        homeId: "tech",
        holdId: null,
        threadId: "t",
        kind: "hold" as const,
        urgency: "normal" as const,
        title: "x",
        body: "y",
        state: "open" as const,
        snoozedUntilMs: null,
        createdAtMs: 1,
        resolvedAtMs: null,
      },
    ];
    assert.equal(filterInboxItems(items, "hold").length, 1);
    assert.equal(INBOX_FILTER_LABELS.hold, "Decisions");
  });
});
