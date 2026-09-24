import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupePrefix,
  shouldEnqueuePrReadyWake,
  wakeIdsToAckThrough,
} from "./fleet-bridge-helpers";

describe("shouldEnqueuePrReadyWake (P-P4)", () => {
  it("requires checks green for no-mistakes mode", () => {
    const url = "https://github.com/org/repo/pull/1";
    assert.equal(
      shouldEnqueuePrReadyWake(
        "no-mistakes",
        `done: ${url} checks green`,
      ),
      true,
    );
    assert.equal(shouldEnqueuePrReadyWake("no-mistakes", `done: ${url}`), false);
  });

  it("accepts PR URL for direct-PR without checks phrase", () => {
    assert.equal(
      shouldEnqueuePrReadyWake(
        "direct-PR",
        "done: https://github.com/org/repo/pull/2",
      ),
      true,
    );
  });

  it("skips local-only delivery", () => {
    assert.equal(
      shouldEnqueuePrReadyWake(
        "local-only",
        "done: https://github.com/org/repo/pull/3 checks green",
      ),
      false,
    );
  });
});

describe("wakeIdsToAckThrough (P-W3)", () => {
  it("acks all wakes sharing dedupe prefix", () => {
    const ids = wakeIdsToAckThrough(
      [
        { id: "a", dedupeKey: "pr.green:thr1", acked: false },
        { id: "b", dedupeKey: "pr.green:thr1:extra", acked: false },
        { id: "c", dedupeKey: "stall:thr2", acked: false },
      ],
      "a",
    );
    assert.deepEqual(ids.sort(), ["a", "b"]);
  });
});

describe("dedupePrefix", () => {
  it("returns segment before first colon", () => {
    assert.equal(dedupePrefix("blocked:thr:line"), "blocked");
    assert.equal(dedupePrefix("solo"), "solo");
    assert.equal(dedupePrefix(null), null);
  });
});
