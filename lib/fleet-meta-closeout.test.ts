import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendMetaFleetDetached,
  isMetaFleetDetached,
} from "./fleet-meta-closeout";

describe("fleet-meta-closeout", () => {
  it("detects fleet_detached marker", () => {
    assert.equal(isMetaFleetDetached("kind=ship\n"), false);
    assert.equal(isMetaFleetDetached("fleet_detached=1\n"), true);
  });

  it("appends fleet_detached once", () => {
    const next = appendMetaFleetDetached("kind=ship\nbb_thread_id=thr_1\n");
    assert.equal(isMetaFleetDetached(next), true);
    assert.equal(
      appendMetaFleetDetached(next),
      next,
    );
  });
});
