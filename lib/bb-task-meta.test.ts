import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBbTaskMeta } from "./bb-task-meta";

describe("validateBbTaskMeta (B-W7, P-V9)", () => {
  it("accepts complete bb meta with matching endpoint_task_id", () => {
    const result = validateBbTaskMeta(
      {
        backend: "bb",
        window: "@thread:thr_crew",
        worktree: "/wt/ship-1",
        project: "/proj",
        endpoint_task_id: "ship-1",
      },
      "ship-1",
    );
    assert.equal(result.ok, true);
  });

  it("rejects incomplete bb meta without project (P-R7)", () => {
    const result = validateBbTaskMeta(
      {
        backend: "bb",
        window: "@thread:thr_crew",
        worktree: "/wt",
        endpoint_task_id: "ship-1",
      },
      "ship-1",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /incomplete/);
  });

  it("rejects endpoint_task_id mismatch", () => {
    const result = validateBbTaskMeta(
      {
        backend: "bb",
        window: "@thread:thr_crew",
        worktree: "/wt",
        project: "/proj",
        endpoint_task_id: "other",
      },
      "ship-1",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /mismatch/);
  });
});
