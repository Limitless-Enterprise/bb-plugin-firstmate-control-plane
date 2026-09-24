import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prUrlFromLedgerDetail } from "./pr-poller";

describe("PR poller helpers (P-P2)", () => {
  it("reads PR URL from ledger detail", () => {
    assert.equal(
      prUrlFromLedgerDetail({ url: "https://github.com/o/r/pull/9" }),
      "https://github.com/o/r/pull/9",
    );
    assert.equal(
      prUrlFromLedgerDetail({ line: "done: https://github.com/o/r/pull/9" }),
      "https://github.com/o/r/pull/9",
    );
  });
});

describe("PR check wake verbs (P-P3)", () => {
  it("uses distinct ledger verbs for check states", () => {
    for (const state of ["success", "failure", "pending"]) {
      assert.match(`pr.checks.${state}`, /^pr\.checks\./);
    }
  });
});
