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

export function githubWebhookAuthorized(input: {
  configuredSecret: string;
  headerSecret: string | undefined;
  bbPluginToken: string | undefined;
}): boolean {
  const secret = input.configuredSecret.trim();
  if (secret.length > 0) {
    return input.headerSecret === secret;
  }
  return Boolean(input.bbPluginToken?.trim());
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

type LedgerPrRow = {
  verb: string;
  detail: Record<string, unknown> | null;
};

export function homeHasLedgerPrUrl(
  crewThreadIds: string[],
  tailLedger: (threadId: string, limit: number) => LedgerPrRow[],
  prUrl: string,
): boolean {
  for (const threadId of crewThreadIds) {
    for (const entry of tailLedger(threadId, 80)) {
      if (
        entry.verb === "pr.opened" &&
        typeof entry.detail?.url === "string" &&
        entry.detail.url === prUrl
      ) {
        return true;
      }
    }
  }
  return false;
}

export function lifecycleWakeReason(
  state: PrLifecycleState,
  prUrl: string,
): string | null {
  switch (state) {
    case "COMMITS_PUSHED":
      return `pr.commits:${prUrl}`;
    case "REVIEW_REQUESTED":
      return `pr.review:${prUrl}`;
    case "CHANGES_REQUESTED":
      return `pr.changes:${prUrl}`;
    case "MERGED":
    case "CLOSED":
      return `pr.merged:${prUrl}`;
    default:
      return null;
  }
}

export function lifecycleLedgerVerb(state: PrLifecycleState): string | null {
  switch (state) {
    case "COMMITS_PUSHED":
      return "pr.commits.pushed";
    case "REVIEW_REQUESTED":
      return "pr.review.requested";
    case "CHANGES_REQUESTED":
      return "pr.changes.requested";
    case "MERGED":
      return "pr.merged";
    case "CLOSED":
      return "pr.closed";
    default:
      return null;
  }
}
