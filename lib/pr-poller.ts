import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FleetService } from "./fleet-service";
import type { FleetStore } from "./db";
import { parsePrUrl } from "./status-verbs";
import {
  lifecycleLedgerVerb,
  lifecycleWakeReason,
  prStateFromSnapshot,
  shouldRetirePollAfterMerge,
  type GhPrSnapshot,
  type PrLifecycleState,
} from "./pr-github-events";

const execFileAsync = promisify(execFile);

type GhCheckState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR";

async function ghPrSnapshot(prUrl: string): Promise<GhPrSnapshot | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        prUrl,
        "--json",
        "statusCheckRollup,mergeStateStatus,state,reviewDecision,headRefOid",
      ],
      { timeout: 15_000 },
    );
    return JSON.parse(stdout) as GhPrSnapshot & {
      statusCheckRollup?: { state?: string }[];
    };
  } catch {
    return null;
  }
}

function checkStateFromSnapshot(
  payload: GhPrSnapshot & { statusCheckRollup?: { state?: string }[] },
): GhCheckState | "unavailable" {
  if (payload.state === "MERGED") {
    return "SUCCESS";
  }
  const rollup = payload.statusCheckRollup ?? [];
  if (rollup.length === 0) return "PENDING";
  if (rollup.some((item) => item.state === "FAILURE")) return "FAILURE";
  if (rollup.every((item) => item.state === "SUCCESS")) return "SUCCESS";
  return "PENDING";
}

export type PrCheckState = GhCheckState | "unavailable";
export type PrCheckStateResolver = (
  prUrl: string,
) => Promise<{ checkState: PrCheckState; snapshot: GhPrSnapshot | null }>;

async function defaultResolveCheckState(
  prUrl: string,
): Promise<{ checkState: PrCheckState; snapshot: GhPrSnapshot | null }> {
  const snapshot = await ghPrSnapshot(prUrl);
  if (!snapshot) {
    return { checkState: "unavailable", snapshot: null };
  }
  return { checkState: checkStateFromSnapshot(snapshot), snapshot };
}

export class PrPoller {
  constructor(
    private readonly store: FleetStore,
    private readonly fleet: FleetService,
    private readonly readSeen: () => Promise<Record<string, string>>,
    private readonly writeSeen: (next: Record<string, string>) => Promise<void>,
    private readonly resolveCheckState: PrCheckStateResolver = defaultResolveCheckState,
  ) {}

  private retirePollKeys(
    seen: Record<string, string>,
    nodeThreadId: string,
    url: string,
  ): void {
    delete seen[`${nodeThreadId}:${url}`];
    delete seen[`${nodeThreadId}:${url}:lifecycle`];
  }

  private async emitLifecycleChange(
    homeId: string,
    nodeThreadId: string,
    url: string,
    lifecycle: PrLifecycleState,
    seen: Record<string, string>,
  ): Promise<boolean> {
    if (!lifecycle || lifecycle === "OPEN") return false;
    const lifeKey = `${nodeThreadId}:${url}:lifecycle`;
    const priorLife = seen[lifeKey];
    if (lifecycle === priorLife) return false;

    seen[lifeKey] = lifecycle;
    const verb = lifecycleLedgerVerb(lifecycle);
    if (verb) {
      this.store.appendLedger({
        homeId,
        threadId: nodeThreadId,
        verb,
        fsmState: this.fleet.fsmForThread(nodeThreadId),
        detail: { url, lifecycle },
      });
    }

    const home = this.store.getHome(homeId);
    const wakeReason = lifecycleWakeReason(lifecycle, url);
    if (wakeReason && home) {
      this.store.enqueueWake({
        homeId,
        threadId: nodeThreadId,
        targetMateId: home.primaryMateId,
        reason: wakeReason,
        priority: lifecycle === "CHANGES_REQUESTED" ? 7 : 5,
        dedupeKey: `${wakeReason}:${nodeThreadId}`,
      });
    }

    if (shouldRetirePollAfterMerge(lifecycle)) {
      this.retirePollKeys(seen, nodeThreadId, url);
      return true;
    }
    return true;
  }

  async pollHome(homeId: string): Promise<number> {
    const nodes = this.store.listNodes(homeId);
    const seen = await this.readSeen();
    let updates = 0;

    for (const node of nodes) {
      const entries = this.store.tailLedger(node.threadId, 100).reverse();
      const prEntry = entries.find(
        (entry) =>
          entry.verb === "pr.opened" &&
          typeof entry.detail?.url === "string",
      );
      if (!prEntry) continue;
      const url = String(prEntry.detail?.url);
      const key = `${node.threadId}:${url}`;
      const prior = seen[key];

      const { checkState: state, snapshot } = await this.resolveCheckState(url);
      if (snapshot) {
        const lifecycle = prStateFromSnapshot(snapshot);
        if (
          lifecycle &&
          (await this.emitLifecycleChange(
            homeId,
            node.threadId,
            url,
            lifecycle,
            seen,
          ))
        ) {
          updates += 1;
        }
        if (lifecycle && shouldRetirePollAfterMerge(lifecycle)) {
          continue;
        }
      }

      if (state === "unavailable" || state === prior) continue;

      seen[key] = state;
      updates += 1;

      this.store.appendLedger({
        homeId,
        threadId: node.threadId,
        verb: `pr.checks.${state.toLowerCase()}`,
        fsmState: state === "SUCCESS" ? "done" : "working",
        detail: { url, state },
      });

      const home = this.store.getHome(homeId);
      if (state === "SUCCESS" && home) {
        this.store.enqueueWake({
          homeId,
          threadId: node.threadId,
          targetMateId: home.primaryMateId,
          reason: `pr.checks.green:${url}`,
          priority: 6,
          dedupeKey: `pr.green:${node.threadId}`,
        });
        this.store.createInboxItem({
          homeId,
          threadId: node.threadId,
          kind: "pr",
          urgency: "normal",
          title: `PR checks green: ${node.label}`,
          body: url,
        });
      } else if (state === "FAILURE" && home) {
        this.store.enqueueWake({
          homeId,
          threadId: node.threadId,
          targetMateId: home.primaryMateId,
          reason: `pr.checks.failed:${url}`,
          priority: 7,
          dedupeKey: `pr.failed:${node.threadId}`,
        });
      }
    }

    if (updates > 0) {
      await this.writeSeen(seen);
      this.fleet.publish();
    }
    return updates;
  }
}

export function prUrlFromLedgerDetail(
  detail: Record<string, unknown> | null | undefined,
): string | null {
  if (!detail) return null;
  if (typeof detail.url === "string") return detail.url;
  if (typeof detail.line === "string") return parsePrUrl(detail.line);
  return null;
}

export async function createPrPoller(
  store: FleetStore,
  fleet: FleetService,
  kv: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  },
): Promise<PrPoller> {
  const KEY = "prPoller.seen";
  return new PrPoller(
    store,
    fleet,
    async () => (await kv.get<Record<string, string>>(KEY)) ?? {},
    async (next) => {
      await kv.set(KEY, next);
    },
  );
}
