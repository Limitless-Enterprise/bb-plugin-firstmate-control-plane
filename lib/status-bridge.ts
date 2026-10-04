import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FleetService } from "./fleet-service";
import { FleetStore } from "./db";
import {
  fsmFromStatusPrefix,
  ledgerVerbFromStatus,
  parsePrUrl,
  parseStatusLine,
} from "./status-verbs";
import { shouldEnqueuePrReadyWake } from "./fleet-bridge-helpers";
import {
  detectStatusBacklogDivergence,
  DIVERGENCE_LEDGER_VERB,
  formatDivergenceRecord,
  mapOpenHoldsForDivergence,
} from "./status-divergence";
import {
  isProgressOnlyStatusLine,
  PROGRESS_LEDGER_VERB,
  progressDetailFromLine,
} from "./status-progress";
import { heldForMergeStatusLine } from "./pr-github-events";
import { deliverableParkedInboxTitle } from "./fleet-captain-holds";

type BridgeTaskCursor = {
  mtimeMs: number;
  tail: string | null;
};

type BridgeCursor = Record<string, BridgeTaskCursor | number>;

function normalizeBridgeTaskCursor(
  raw: BridgeCursor[string] | undefined,
): BridgeTaskCursor {
  if (raw == null) return { mtimeMs: 0, tail: null };
  if (typeof raw === "number") return { mtimeMs: raw, tail: null };
  return raw;
}

const CURSOR_KEY = "statusBridge.cursors";

export class StatusBridge {
  constructor(
    private readonly store: FleetStore,
    private readonly fleet: FleetService,
    private readonly readCursor: () => Promise<BridgeCursor>,
    private readonly writeCursor: (next: BridgeCursor) => Promise<void>,
  ) {}

  async scanMateHome(
    homeId: string,
    checkoutPaths: string[],
  ): Promise<number> {
    try {
      await this.fleet.reconcileMateWorktreeIntegration(homeId);
    } catch {
      // Best-effort; periodic follow-up from ensureBbIntegration still runs.
    }
    await this.fleet.syncCrewsFromStateMeta(homeId, checkoutPaths);
    let ingested = 0;
    for (const checkoutPath of checkoutPaths) {
      ingested += await this.scanCheckoutPath(homeId, checkoutPath);
    }
    return ingested;
  }

  private async scanCheckoutPath(
    homeId: string,
    checkoutPath: string,
  ): Promise<number> {
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
      const prior = normalizeBridgeTaskCursor(cursors[key]);
      if (stat.mtimeMs <= prior.mtimeMs) continue;

      const advanceCursor = (tailLine: string | null) => {
        cursors[key] = { mtimeMs: stat.mtimeMs, tail: tailLine };
      };

      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim());
      const tail = lines.at(-1);
      if (!tail) {
        advanceCursor(null);
        continue;
      }
      const parsed = parseStatusLine(tail);
      if (!parsed) {
        advanceCursor(tail);
        continue;
      }

      if (prior.tail !== null && prior.tail === tail) {
        advanceCursor(tail);
        continue;
      }

      if (isProgressOnlyStatusLine(parsed.raw)) {
        const threadIdProgress = await this.resolveThreadId(
          homeId,
          checkoutPath,
          taskId,
        );
        if (threadIdProgress) {
          this.store.appendLedger({
            homeId,
            threadId: threadIdProgress,
            verb: PROGRESS_LEDGER_VERB,
            fsmState: this.fleet.fsmForThread(threadIdProgress),
            detail: {
              line: parsed.raw,
              taskId,
              detail: progressDetailFromLine(parsed.raw),
            },
          });
        }
        advanceCursor(tail);
        ingested += 1;
        continue;
      }

      const threadId = await this.resolveThreadId(homeId, checkoutPath, taskId);
      if (!threadId) {
        advanceCursor(tail);
        continue;
      }

      const fsm = fsmFromStatusPrefix(parsed.prefix);
      if (fsm) {
        this.store.appendLedger({
          homeId,
          threadId,
          verb: ledgerVerbFromStatus(parsed.prefix),
          fsmState: fsm,
          detail: { line: parsed.raw, taskId },
        });
      } else if (parsed.prefix === "note:") {
        this.store.appendLedger({
          homeId,
          threadId,
          verb: "crew.note",
          fsmState: this.fleet.fsmForThread(threadId),
          detail: { line: parsed.raw, taskId },
        });
      }

      const home = this.store.getHome(homeId);
      const node = this.store.getNodeByThread(threadId);

      if (parsed.prefix === "resolved:" && parsed.decisionKey) {
        this.store.recordDecision({
          homeId,
          threadId,
          key: parsed.decisionKey,
          raw: parsed.raw,
          resolvedAtMs: Date.now(),
        });
      }

      if (parsed.prefix === "needs-decision:") {
        if (home) {
          const title = parsed.detail.slice(0, 120) || taskId;
          const hasOpenHold = this.store
            .listHolds(homeId, "open")
            .some((hold) => hold.threadId === threadId && hold.title === title);
          if (!hasOpenHold) {
            this.fleet.openHold({
              homeId,
              mateId: home.primaryMateId,
              threadId,
              title,
              body: parsed.raw,
              urgency: "high",
            });
          }
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

      if (parsed.prefix === "done:" || parsed.prefix === "failed:") {
        if (home) {
          this.store.enqueueWake({
            homeId,
            threadId: home.mateThreadId,
            targetMateId: home.primaryMateId,
            reason: `terminal:${parsed.prefix}${taskId}`,
            priority: parsed.prefix === "failed:" ? 8 : 5,
            dedupeKey: `terminal:${threadId}:${parsed.prefix}`,
          });
        }
      }

      if (parsed.prefix === "done:") {
        const prUrl = parsePrUrl(parsed.detail);
        if (prUrl) {
          this.store.appendLedger({
            homeId,
            threadId,
            verb: "pr.opened",
            fsmState: "done",
            detail: { url: prUrl, taskId },
          });
          const mode = node?.deliveryMode ?? "no-mistakes";
          if (shouldEnqueuePrReadyWake(mode, parsed.detail)) {
            this.store.enqueueWake({
              homeId,
              threadId,
              targetMateId: home?.primaryMateId ?? null,
              reason: `pr.ready:${prUrl}`,
              priority: 6,
              dedupeKey: `pr.ready:${threadId}`,
            });
          }
        }
        const openHolds = mapOpenHoldsForDivergence(
          this.store.listHolds(homeId, "open"),
          this.store.listRecordedDecisions(homeId),
        );
        const divergence = detectStatusBacklogDivergence({
          threadId,
          taskId,
          statusPrefix: parsed.prefix,
          openHolds,
          fsmState: this.fleet.fsmForThread(threadId),
        });
        if (divergence && home) {
          const record = formatDivergenceRecord(divergence);
          const divergenceWakeId = this.store.enqueueWake({
            homeId,
            threadId: home.mateThreadId,
            targetMateId: home.primaryMateId,
            reason: `divergence:${threadId}`,
            priority: 8,
            dedupeKey: `divergence:${threadId}:${divergence.kind}`,
          });
          if (divergenceWakeId) {
            this.store.appendLedger({
              homeId,
              threadId,
              verb: DIVERGENCE_LEDGER_VERB,
              fsmState: this.fleet.fsmForThread(threadId),
              detail: { record, ...divergence },
            });
            this.store.createInboxItem({
              homeId,
              threadId,
              kind: "wake",
              urgency: "high",
              title: "Status vs backlog divergence",
              body: record,
            });
          }
        }
        const captainHolds = this.store
          .listHolds(homeId, "open")
          .filter((hold) => hold.threadId === threadId);
        if (captainHolds.length > 0 && home) {
          this.store.createInboxItem({
            homeId,
            threadId,
            kind: "hold",
            urgency: "normal",
            title: deliverableParkedInboxTitle(taskId),
            body: parsed.raw,
          });
        }
      }

      if (parsed.prefix === "held-for-merge:") {
        this.store.appendLedger({
          homeId,
          threadId,
          verb: "pr.held-for-merge",
          fsmState: "done",
          detail: { line: parsed.raw, taskId },
        });
        if (home) {
          this.store.createInboxItem({
            homeId,
            threadId,
            kind: "pr",
            urgency: "normal",
            title: `Held for merge: ${taskId}`,
            body: heldForMergeStatusLine(parsePrUrl(parsed.detail) ?? parsed.detail),
          });
        }
      }

      if (parsed.prefix === "resolved:" && parsed.decisionKey) {
        const openHolds = mapOpenHoldsForDivergence(
          this.store.listHolds(homeId, "open"),
          this.store.listRecordedDecisions(homeId),
        );
        const divergence = detectStatusBacklogDivergence({
          threadId,
          taskId,
          statusPrefix: parsed.prefix,
          decisionKey: parsed.decisionKey,
          openHolds,
          fsmState: this.fleet.fsmForThread(threadId),
        });
        if (divergence && home) {
          const record = formatDivergenceRecord(divergence);
          const divergenceWakeId = this.store.enqueueWake({
            homeId,
            threadId: home.mateThreadId,
            targetMateId: home.primaryMateId,
            reason: `divergence:${threadId}`,
            priority: 8,
            dedupeKey: `divergence:${threadId}:${divergence.kind}`,
          });
          if (divergenceWakeId) {
            this.store.appendLedger({
              homeId,
              threadId,
              verb: DIVERGENCE_LEDGER_VERB,
              fsmState: this.fleet.fsmForThread(threadId),
              detail: { record, ...divergence },
            });
            this.store.createInboxItem({
              homeId,
              threadId,
              kind: "wake",
              urgency: "high",
              title: "Status vs backlog divergence",
              body: record,
            });
          }
        }
      }

      advanceCursor(tail);
      ingested += 1;
    }
    await this.writeCursor(cursors);
    if (ingested > 0) this.fleet.publish();
    return ingested;
  }

  private async resolveThreadId(
    homeId: string,
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
      // no meta file
    }

    const matches = this.store
      .listNodes(homeId)
      .filter((node) => node.label === taskId);
    if (matches.length === 0) return null;
    return matches.reduce((newest, node) =>
      node.createdAtMs > newest.createdAtMs ? node : newest,
    ).threadId;
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
