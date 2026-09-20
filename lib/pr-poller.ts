import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FleetService } from "./fleet-service";
import type { FleetStore } from "./db";
import { parsePrUrl } from "./status-verbs";

const execFileAsync = promisify(execFile);

type GhCheckState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR";

async function ghPrCheckState(
  prUrl: string,
): Promise<GhCheckState | "unavailable"> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        prUrl,
        "--json",
        "statusCheckRollup,mergeStateStatus,state",
      ],
      { timeout: 15_000 },
    );
    const payload = JSON.parse(stdout) as {
      state?: string;
      mergeStateStatus?: string;
      statusCheckRollup?: { state?: string }[];
    };
    if (payload.state === "MERGED") return "SUCCESS";
    const rollup = payload.statusCheckRollup ?? [];
    if (rollup.length === 0) return "PENDING";
    if (rollup.some((item) => item.state === "FAILURE")) return "FAILURE";
    if (rollup.every((item) => item.state === "SUCCESS")) return "SUCCESS";
    return "PENDING";
  } catch {
    return "unavailable";
  }
}

export class PrPoller {
  constructor(
    private readonly store: FleetStore,
    private readonly fleet: FleetService,
    private readonly readSeen: () => Promise<Record<string, string>>,
    private readonly writeSeen: (next: Record<string, string>) => Promise<void>,
  ) {}

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
      const state = await ghPrCheckState(url);
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
