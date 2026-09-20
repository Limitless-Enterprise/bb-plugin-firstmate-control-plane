import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FleetService } from "./fleet-service";
import { FleetStore } from "./db";
import {
  fsmFromStatusPrefix,
  ledgerVerbFromStatus,
  parsePrUrl,
  parseStatusLine,
  isChecksGreen,
} from "./status-verbs";

type BridgeCursor = Record<string, number>;

const CURSOR_KEY = "statusBridge.cursors";

export class StatusBridge {
  constructor(
    private readonly store: FleetStore,
    private readonly fleet: FleetService,
    private readonly readCursor: () => Promise<BridgeCursor>,
    private readonly writeCursor: (next: BridgeCursor) => Promise<void>,
  ) {}

  async scanHome(homeId: string, checkoutPath: string): Promise<number> {
    const stateDir = path.join(checkoutPath, "state");
    let entries: string[];
    try {
      entries = await fs.readdir(stateDir);
    } catch {
      return 0;
    }
    const cursors = await this.readCursor();
    let ingested = 0;
    for (const name of entries) {
      if (!name.endsWith(".status")) continue;
      const taskId = name.slice(0, -".status".length);
      const filePath = path.join(stateDir, name);
      const stat = await fs.stat(filePath);
      const key = `${homeId}:${taskId}`;
      const lastMs = cursors[key] ?? 0;
      if (stat.mtimeMs <= lastMs) continue;

      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim());
      const tail = lines.at(-1);
      if (!tail) continue;
      const parsed = parseStatusLine(tail);
      if (!parsed) continue;

      const threadId = await this.resolveThreadId(checkoutPath, taskId);
      if (!threadId) continue;

      const fsm = fsmFromStatusPrefix(parsed.prefix);
      if (fsm) {
        this.store.appendLedger({
          homeId,
          threadId,
          verb: ledgerVerbFromStatus(parsed.prefix),
          fsmState: fsm,
          detail: { line: parsed.raw, taskId },
        });
      }

      if (parsed.prefix === "needs-decision:") {
        const home = this.store.getHome(homeId);
        if (home) {
          this.fleet.openHold({
            homeId,
            mateId: home.primaryMateId,
            threadId,
            title: parsed.detail.slice(0, 120) || taskId,
            body: parsed.raw,
            urgency: "high",
          });
        }
      }

      if (parsed.prefix === "blocked:") {
        this.store.enqueueWake({
          homeId,
          threadId,
          targetMateId: this.store.getHome(homeId)?.primaryMateId ?? null,
          reason: `blocked:${taskId}`,
          priority: 7,
          dedupeKey: `blocked:${threadId}:${parsed.raw}`,
        });
      }

      if (parsed.prefix === "done:") {
        const prUrl = parsePrUrl(parsed.detail);
        if (prUrl) {
          this.store.appendLedger({
            homeId,
            threadId,
            verb: "pr.opened",
            fsmState: "working",
            detail: { url: prUrl, taskId },
          });
          if (isChecksGreen(parsed.detail)) {
            this.store.enqueueWake({
              homeId,
              threadId,
              targetMateId: this.store.getHome(homeId)?.primaryMateId ?? null,
              reason: `pr.ready:${prUrl}`,
              priority: 6,
              dedupeKey: `pr.ready:${threadId}`,
            });
          }
        }
      }

      cursors[key] = stat.mtimeMs;
      ingested += 1;
    }
    await this.writeCursor(cursors);
    if (ingested > 0) this.fleet.publish();
    return ingested;
  }

  private async resolveThreadId(
    checkoutPath: string,
    taskId: string,
  ): Promise<string | null> {
    const metaPath = path.join(checkoutPath, "state", `${taskId}.meta`);
    try {
      const meta = await fs.readFile(metaPath, "utf8");
      const bbMatch = meta.match(/^bb_thread_id=(.+)$/m);
      if (bbMatch?.[1]) return bbMatch[1].trim();
      const windowMatch = meta.match(/^window=@thread:(.+)$/m);
      if (windowMatch?.[1]) return windowMatch[1].trim();
    } catch {
      // fall through to registry lookup
    }
    for (const home of this.store.listHomes()) {
      if (home.checkoutPath !== checkoutPath) continue;
      const match = this.store
        .listNodes(home.homeId)
        .find((n) => n.label === taskId);
      if (match) return match.threadId;
    }
    return null;
  }
}

export async function createStatusBridge(
  store: FleetStore,
  fleet: FleetService,
  kv: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  },
): Promise<StatusBridge> {
  return new StatusBridge(
    store,
    fleet,
    async () => (await kv.get<BridgeCursor>(CURSOR_KEY)) ?? {},
    async (next) => {
      await kv.set(CURSOR_KEY, next);
    },
  );
}
