import type { FsmState } from "./types";

const STATUS_PREFIXES = [
  "working:",
  "done:",
  "failed:",
  "blocked:",
  "paused:",
  "needs-decision:",
  "resolved:",
  "note:",
] as const;

export type ParsedStatusLine = {
  raw: string;
  prefix: string;
  detail: string;
  decisionKey?: string;
};

export function parseStatusLine(line: string): ParsedStatusLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const prefix of STATUS_PREFIXES) {
    if (!trimmed.startsWith(prefix)) continue;
    const detail = trimmed.slice(prefix.length).trim();
    const parsed: ParsedStatusLine = { raw: trimmed, prefix, detail };
    if (prefix === "resolved:" && detail) {
      parsed.decisionKey = detail.split(/\s+/)[0];
    }
    return parsed;
  }
  return null;
}

export function fsmFromStatusPrefix(prefix: string): FsmState | null {
  switch (prefix) {
    case "working:":
      return "working";
    case "done:":
      return "done";
    case "failed:":
      return "error";
    case "blocked:":
    case "needs-decision:":
      return "blocked";
    case "paused:":
    case "resolved:":
      return "idle";
    default:
      return null;
  }
}

export function ledgerVerbFromStatus(prefix: string): string {
  const map: Record<string, string> = {
    "working:": "crew.working",
    "done:": "crew.done",
    "failed:": "crew.failed",
    "blocked:": "crew.blocked",
    "paused:": "crew.paused",
    "needs-decision:": "crew.needs-decision",
    "resolved:": "crew.resolved",
    "note:": "crew.note",
  };
  return map[prefix] ?? "crew.status";
}

export function parsePrUrl(detail: string): string | null {
  const match = detail.match(/https:\/\/github\.com\/[^\s)]+/i);
  return match?.[0] ?? null;
}

export function isChecksGreen(detail: string): boolean {
  return /checks green/i.test(detail);
}
