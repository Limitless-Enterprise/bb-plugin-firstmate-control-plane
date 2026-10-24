import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import {
  FLEET_REALTIME_TOPIC,
  fleetOverflowRpcCall,
  fleetPanelFromSubPath,
  fleetSteerPayload,
  inboxReplySteerText,
  findFleetTreeNode,
  needsDecisionRailLine,
} from "./fleet-ui";
import type { TreeNode } from "./types";

describe("fleetPanelFromSubPath (P-H11)", () => {
  it("opens inbox tab from /fleet/inbox deep link", () => {
    assert.deepEqual(fleetPanelFromSubPath("inbox"), {
      tab: "inbox",
      threadId: null,
    });
  });

  it("selects thread from thread subPath", () => {
    assert.deepEqual(fleetPanelFromSubPath("thread/thr_crew"), {
      tab: "fleet",
      threadId: "thr_crew",
    });
  });
});

describe("needsDecisionRailLine (P-H14)", () => {
  it("returns null when no holds", () => {
    assert.equal(needsDecisionRailLine([]), null);
  });

  it("summarizes single and multiple open holds", () => {
    assert.equal(
      needsDecisionRailLine([{ title: "pick merge strategy" }]),
      "Needs decision: pick merge strategy",
    );
    assert.equal(
      needsDecisionRailLine([
        { title: "auth model" },
        { title: "deploy window" },
      ]),
      "Needs decision: auth model (+1)",
    );
  });
});

describe("Fleet UI panel actions (P-U12, P-U13)", () => {
  it("builds steer payload only when text is non-empty", () => {
    assert.equal(fleetSteerPayload("tech", "thr_crew", "  "), null);
    assert.deepEqual(fleetSteerPayload("tech", "thr_crew", " ship it "), {
      homeId: "tech",
      threadId: "thr_crew",
      text: "ship it",
    });
  });

  it("maps overflow buttons to RPC methods", () => {
    assert.deepEqual(fleetOverflowRpcCall("interrupt", "tech", "thr_crew"), {
      method: "interrupt",
      params: { homeId: "tech", threadId: "thr_crew" },
    });
    assert.deepEqual(fleetOverflowRpcCall("relaunch", "tech", "thr_crew"), {
      method: "relaunch",
      params: { homeId: "tech", threadId: "thr_crew" },
    });
  });
});

describe("findFleetTreeNode", () => {
  const tree: TreeNode[] = [
    {
      id: "m",
      homeId: "tech",
      parentId: null,
      envId: null,
      createdAtMs: 1,
      depth: 0,
      threadId: "thr_mate",
      label: "mate",
      kind: "primary",
      role: null,
      fsmState: "idle",
      liveness: null,
      deliveryMode: "no-mistakes",
      yolo: false,
      dispatchProfileId: null,
      profileLabel: null,
      prUrl: null,
      children: [
        {
          id: "c",
          homeId: "tech",
          parentId: "m",
          envId: null,
          createdAtMs: 2,
          depth: 1,
          threadId: "thr_crew",
          label: "crew",
          kind: "crew",
          role: "ship",
          fsmState: "working",
          liveness: "alive",
          deliveryMode: "no-mistakes",
          yolo: false,
          dispatchProfileId: null,
          profileLabel: null,
          prUrl: null,
          children: [],
        },
      ],
    },
  ];

  it("finds nested nodes by thread id", () => {
    assert.equal(findFleetTreeNode(tree, "thr_crew")?.label, "crew");
    assert.equal(findFleetTreeNode(tree, "missing"), null);
  });
});

describe("inboxReplySteerText (P-H10 reply)", () => {
  it("requires operator comment and includes inbox context", () => {
    assert.equal(inboxReplySteerText({ title: "blocked", body: "waiting", comment: "  " }), null);
    const text = inboxReplySteerText({
      title: "API down",
      body: "crew stalled on deploy",
      comment: "Try rollback and ping me.",
    });
    assert.ok(text?.includes("Subject: API down"));
    assert.ok(text?.includes("crew stalled on deploy"));
    assert.ok(text?.includes("Try rollback and ping me."));
  });
});

describe("FleetService.publish realtime (P-U9)", () => {
  it("publishes fleet-changed when mutating fleet state", async () => {
    let topic: string | null = null;
    const fleet = new FleetService(
      {
        sdk: {
          threads: { stop: async () => {} },
        },
        log: { warn: () => {} },
        realtime: {
          publish: (t: string) => {
            topic = t;
          },
        },
      } as never,
      {
        getHome: () => ({
          homeId: "tech",
          label: "tech",
          checkoutPath: "/tmp",
          primaryMateId: "m1",
          mateThreadId: "thr_mate",
          defaultProfileId: null,
          createdAtMs: 1,
        }),
        appendLedger: () => {},
        setLiveness: () => {},
      } as never,
    );
    await fleet.exitThread("tech", "thr_crew");
    assert.equal(topic, FLEET_REALTIME_TOPIC);
  });
});
