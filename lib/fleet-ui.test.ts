import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLEET_CHANGED } from "./fleet-service";
import {
  FLEET_REALTIME_TOPIC,
  fleetOverflowRpcCall,
  fleetPanelFromSubPath,
  fleetSteerPayload,
  mobileTreeDrawerHidden,
  needsDecisionRailLine,
} from "./fleet-ui";

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

describe("mobileTreeDrawerHidden (P-U8)", () => {
  it("hides drawer on small screens when closed", () => {
    assert.equal(mobileTreeDrawerHidden(false), "max-md:hidden");
    assert.equal(mobileTreeDrawerHidden(true), "");
  });
});

describe("FLEET realtime topic (P-U9)", () => {
  it("matches server publish topic", () => {
    assert.equal(FLEET_REALTIME_TOPIC, FLEET_CHANGED);
  });
});
