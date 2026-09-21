import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fsmFromStatusPrefix,
  isChecksGreen,
  ledgerVerbFromStatus,
  parsePrUrl,
  parseStatusLine,
} from "./status-verbs";

describe("parseStatusLine", () => {
  it("parses working lines", () => {
    const parsed = parseStatusLine("working: implementing auth fix");
    assert.ok(parsed);
    assert.equal(parsed.prefix, "working:");
    assert.equal(parsed.detail, "implementing auth fix");
  });

  it("returns null for unknown prefixes", () => {
    assert.equal(parseStatusLine("random: noise"), null);
  });
});

describe("fsmFromStatusPrefix", () => {
  it("maps blocked and needs-decision to blocked FSM", () => {
    assert.equal(fsmFromStatusPrefix("blocked:"), "blocked");
    assert.equal(fsmFromStatusPrefix("needs-decision:"), "blocked");
  });

  it("maps paused and resolved to idle FSM", () => {
    assert.equal(fsmFromStatusPrefix("paused:"), "idle");
    assert.equal(fsmFromStatusPrefix("resolved:"), "idle");
  });
});

describe("ledgerVerbFromStatus", () => {
  it("maps working to crew.working", () => {
    assert.equal(ledgerVerbFromStatus("working:"), "crew.working");
  });
});

describe("parsePrUrl", () => {
  it("extracts github PR URLs from done detail", () => {
    const url = parsePrUrl(
      "PR https://github.com/org/repo/pull/42 opened (checks green)",
    );
    assert.equal(url, "https://github.com/org/repo/pull/42");
  });
});

describe("isChecksGreen", () => {
  it("detects checks green phrasing", () => {
    assert.equal(isChecksGreen("PR opened — checks green"), true);
    assert.equal(isChecksGreen("PR opened — checks pending"), false);
  });
});
