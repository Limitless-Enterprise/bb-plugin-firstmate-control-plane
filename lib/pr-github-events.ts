/** P-P5–P-P9: GitHub PR lifecycle beyond checks rollup. */

export type PrLifecycleState =
  | "OPEN"
  | "MERGED"
  | "CLOSED"
  | "REVIEW_REQUESTED"
  | "CHANGES_REQUESTED"
  | "COMMITS_PUSHED";

export type GhPrSnapshot = {
  state?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  headRefOid?: string;
  commits?: { oid?: string }[];
};

export function prStateFromSnapshot(snapshot: GhPrSnapshot): PrLifecycleState | null {
  if (snapshot.state === "MERGED") return "MERGED";
  if (snapshot.reviewDecision === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (snapshot.reviewDecision === "REVIEW_REQUIRED") return "REVIEW_REQUESTED";
  if (snapshot.mergeStateStatus === "BEHIND") return "COMMITS_PUSHED";
  return snapshot.state === "OPEN" ? "OPEN" : null;
}

export function shouldRetirePollAfterMerge(state: PrLifecycleState | null): boolean {
  return state === "MERGED" || state === "CLOSED";
}

export function heldForMergeStatusLine(prUrl: string): string {
  return `held-for-merge: ${prUrl} checks green awaiting merge`;
}

export function parseGithubWebhookEvent(body: unknown): {
  action: string;
  prUrl: string | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";
  const pr = payload.pull_request;
  if (!pr || typeof pr !== "object") return null;
  const html = (pr as { html_url?: string }).html_url;
  return { action, prUrl: typeof html === "string" ? html : null };
}

export function webhookWakeReason(action: string, prUrl: string): string {
  return `webhook:${action}:${prUrl}`;
}
