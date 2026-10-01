import { type BbPluginApi } from "@get-bb/plugin-sdk";
import * as fs from "node:fs/promises";
import { rpcContract } from "./contract";
import { FleetStore, migrations } from "./lib/db";
import { FLEET_CHANGED, FleetService, isLegacyFleetThreadId } from "./lib/fleet-service";
import { createStatusBridge } from "./lib/status-bridge";
import { createPrPoller } from "./lib/pr-poller";
import {
  hasIntentionalPauseState,
  hasTerminalLedgerState,
  isSemanticallyBlocked,
  shouldEnqueueBusyAgeStall,
  shouldEnqueueStaleIdleSupervision,
} from "./lib/supervisor-wakes";
import { onThreadIdle } from "./lib/thread-idle-wake";
import {
  livenessWakeDedupeKey,
  shouldSupervisorRespawnWake,
} from "./lib/respawn-policy";
import { shouldEnqueueMateWake } from "./lib/wake-triage";
import {
  awayPostureKvKey,
  buildReturnBrief,
  checkKindWakeReason,
  instructionRefreshCursorKvKey,
  instructionRefreshReason,
  nextWedgeEscalationCount,
  pauseResurfaceDueMs,
  pauseResurfaceWakeReason,
  recoveryEpisodeId,
  recoveryWakeReason,
  shouldDeferStaleIdleForWorktreeMtime,
  shouldEscalateWedge,
  startupInactiveScanReason,
  supervisorDeadAlarmDue,
  wedgeWakeReason,
} from "./lib/supervisor-policy";
import { DIVERGENCE_LEDGER_VERB } from "./lib/status-divergence";
import { PROGRESS_LEDGER_VERB } from "./lib/status-progress";
import { parseBatchSpawnJson } from "./lib/fleet-batch-spawn";
import { filterInboxItems } from "./lib/fleet-inbox-filters";
import {
  githubWebhookAuthorized,
  homeHasLedgerPrUrl,
  parseGithubWebhookEvent,
} from "./lib/pr-github-events";
import { DEFAULT_MAX_CREW_CONCURRENCY } from "./lib/fleet-dispatch-limit";

export type { rpcContract };

type KvLike = {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

function kvAdapter(kv: KvLike) {
  return {
    get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
    set: (key: string, value: unknown) => kv.set(key, value),
  };
}

function parseCliFlags(argv: string[]): {
  positional: string[];
  flags: Map<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("firstmate-control-plane: loading");

  const settings = bb.settings.define({
    probeIntervalSec: {
      type: "string",
      label: "Liveness probe interval (seconds)",
      default: "10",
    },
    autoRespawn: {
      type: "boolean",
      label: "Auto-respawn on proven dead/missing (never ambiguous)",
      default: false,
    },
    busyAgeSec: {
      type: "string",
      label: "Busy-age stall threshold (seconds)",
      default: "900",
    },
    staleIdleSec: {
      type: "string",
      label: "Stale-idle wake threshold (seconds)",
      default: "1800",
    },
    cosThreadId: {
      type: "string",
      label: "CoS thread id for digest delivery (optional)",
      default: "",
    },
    statusBridgeIntervalSec: {
      type: "string",
      label: "Status bridge scan interval (seconds)",
      default: "3",
    },
    firstmateRepoUrl: {
      type: "string",
      label: "Firstmate git repository URL (cloned for each new mate home)",
      default: "https://github.com/kunchenguid/firstmate.git",
    },
    defaultParentDir: {
      type: "string",
      label: "Default parent directory for new mate home checkouts",
      default: "/workspace/Codes",
    },
    maxCrewConcurrency: {
      type: "string",
      label: "Max concurrent active crews per home (dispatch wait)",
      default: String(DEFAULT_MAX_CREW_CONCURRENCY),
    },
    githubWebhookSecret: {
      type: "string",
      label: "GitHub webhook shared secret (X-Fleet-Webhook-Secret header)",
      default: "",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const store = new FleetStore(db);

  const getFleetConfig = async () => {
    const values = await settings.get();
    const firstmateRepoUrl = values.firstmateRepoUrl.trim();
    const defaultParentDir = values.defaultParentDir.trim();
    return {
      firstmateRepoUrl:
        firstmateRepoUrl || "https://github.com/kunchenguid/firstmate.git",
      defaultParentDir: defaultParentDir || "/workspace/Codes",
    };
  };

  const fleet = new FleetService(bb, store, await getFleetConfig());
  const statusBridge = await createStatusBridge(
    store,
    fleet,
    kvAdapter(bb.storage.kv),
  );
  const prPoller = await createPrPoller(store, fleet, kvAdapter(bb.storage.kv));

  const getConfig = async () => {
    const values = await settings.get();
    const probeIntervalSec = Math.max(
      5,
      Number.parseInt(values.probeIntervalSec, 10) || 10,
    );
    const statusBridgeIntervalSec = Math.max(
      2,
      Number.parseInt(values.statusBridgeIntervalSec, 10) || 3,
    );
    const busyAgeSec = Math.max(
      60,
      Number.parseInt(values.busyAgeSec, 10) || 900,
    );
    const staleIdleSec = Math.max(
      60,
      Number.parseInt(values.staleIdleSec, 10) || 1800,
    );
    return {
      probeIntervalMs: probeIntervalSec * 1000,
      statusBridgeIntervalMs: statusBridgeIntervalSec * 1000,
      autoRespawn: values.autoRespawn,
      busyAgeSec,
      staleIdleSec,
      cosThreadId: values.cosThreadId.trim() || null,
      maxCrewConcurrency: Math.max(
        1,
        Number.parseInt(values.maxCrewConcurrency, 10) ||
          DEFAULT_MAX_CREW_CONCURRENCY,
      ),
    };
  };

  const applyRuntimeLimits = async () => {
    const config = await getConfig();
    fleet.setCosThreadId(config.cosThreadId);
    fleet.setRuntimeLimits({ maxConcurrency: config.maxCrewConcurrency });
  };
  await applyRuntimeLimits();

  const resolveHomeId = (homeId?: string | null): string => {
    const id = homeId ?? store.getSelectedHomeId();
    if (!id) throw new Error("No mate home selected. Run bb fleet home create.");
    fleet.assertHome(id);
    return id;
  };

  bb.rpc.register(rpcContract, {
    listHomes: () => ({
      homes: store.listHomes(),
      selectedHomeId: store.getSelectedHomeId(),
    }),
    selectHome: (input) => {
      fleet.assertHome(input.homeId);
      store.setSelectedHomeId(input.homeId);
      fleet.publish();
      return null;
    },
    registerHome: (input) => fleet.registerHome(input),
    createHome: (input) => fleet.createHome(input),
    createHomeWithMateThread: (input) => fleet.createHomeWithMateThread(input),
    getHomeCreateDefaults: async () => {
      const config = await getFleetConfig();
      return {
        defaultParentDir: config.defaultParentDir,
        firstmateRepoUrl: config.firstmateRepoUrl,
      };
    },
    getMateDefaults: async () => await fleet.readMateDefaults(),
    setMateDefaults: async (input) => await fleet.writeMateDefaults(input),
    previewHomeCheckout: async (input) =>
      await fleet.previewHomeCheckout(input),
    updateHome: (input) => fleet.updateHome(input.homeId, input),
    deleteHome: (input) => {
      fleet.deleteHome(input.homeId);
      return { deleted: true };
    },
    resetMateThreadPreflight: async (input) =>
      await fleet.resetMateThreadPreflight(input.homeId),
    resetMateThread: async (input) => await fleet.resetMateThread(input.homeId),
    listThreadCandidates: async (input) => ({
      threads: await fleet.listThreadCandidates(input?.limit ?? 40),
    }),
    pickCheckoutFolder: async (input) =>
      await fleet.pickCheckoutFolder(input.clientHostId ?? undefined),
    browseHostDirectory: async (input) =>
      await fleet.browseHostDirectory(input.path),
    getTree: (input) => ({
      tree: fleet.buildTree(input.homeId),
    }),
    listNodes: (input) => ({
      nodes: store.listNodes(input.homeId),
    }),
    attachCrew: (input) => fleet.attachCrew(input),
    createSecondmate: (input) => fleet.createSecondmate(input),
    spawnCrew: (input) => fleet.spawnCrew(input),
    markThread: (input) => {
      fleet.markThread(input.homeId, input.threadId, input.state, input.detail ?? undefined);
      return null;
    },
    steer: async (input) => {
      await fleet.steer(input.homeId, input.threadId, input.text);
      return null;
    },
    interrupt: async (input) => {
      await fleet.interrupt(input.homeId, input.threadId);
      return null;
    },
    exitThread: async (input) => {
      await fleet.exitThread(input.homeId, input.threadId);
      return null;
    },
    relaunch: async (input) => fleet.relaunch(input.homeId, input.threadId, input.prompt),
    detachCrew: async (input) => {
      await fleet.detachCrew(input.homeId, input.threadId);
      return null;
    },
    listProfiles: (input) => ({
      profiles: store.listProfiles(input.homeId),
    }),
    upsertProfile: (input) =>
      store.upsertProfile({
        id: input.id,
        homeId: input.homeId,
        label: input.label,
        providerId: input.providerId ?? null,
        model: input.model ?? null,
        effort: input.effort ?? null,
        taskClasses: input.taskClasses ?? [],
      }),
    listWakes: (input) => ({
      wakes: store.listWakes(input.homeId, input.acked),
    }),
    ackWake: (input) => {
      fleet.ackWake(input.homeId, input.id);
      return null;
    },
    openHold: (input) => fleet.openHold(input),
    resolveHold: (input) => {
      fleet.resolveHold(input.homeId, input.holdId);
      return null;
    },
    listHolds: (input) => ({
      holds: store.listHolds(input.homeId, input.state),
    }),
    listInbox: (input) => ({
      items: filterInboxItems(
        store.listInbox(input.homeId, input.state),
        input.kind ?? "all",
      ),
    }),
    snoozeInbox: (input) => {
      fleet.assertHome(input.homeId);
      store.snoozeInbox(input.id, input.untilMs);
      fleet.publish();
      return null;
    },
    resolveInbox: (input) => {
      fleet.assertHome(input.homeId);
      store.resolveInbox(input.id);
      fleet.publish();
      return null;
    },
    probe: async (input) => ({
      verdict: await fleet.probeThread(input.threadId),
    }),
    probeHome: async (input) => {
      const nodes = store.listNodes(input.homeId);
      const results = await Promise.all(
        nodes.map(async (node) => ({
          threadId: node.threadId,
          verdict: await fleet.probeThread(node.threadId),
        })),
      );
      fleet.publish();
      return { results };
    },
    digest: (input) => fleet.buildDigest(input.homeId),
    bearings: (input) => fleet.buildBearings(input.homeId),
    fleetSnapshot: (input) => fleet.fleetSnapshot(input.homeId),
    fleetNavCounts: (input) => fleet.fleetNavCounts(input.homeId),
    status: (input) => {
      const homeId = input.homeId ?? store.getSelectedHomeId();
      const homes = store.listHomes();
      if (!homeId) {
        return {
          homes,
          selectedHomeId: null,
          openInbox: store.countOpenInbox(),
          tree: [],
        };
      }
      return {
        homes,
        selectedHomeId: homeId,
        openInbox: store.countOpenInbox(homeId),
        tree: fleet.buildTree(homeId),
      };
    },
    inboxBadge: () => {
      const homeId = store.getSelectedHomeId();
      if (!homeId) {
        let inbox = 0;
        let wakes = 0;
        let dead = 0;
        for (const home of store.listHomes()) {
          const nav = fleet.fleetNavCounts(home.homeId);
          inbox += nav.inbox;
          wakes += nav.wakes;
          dead += nav.dead;
        }
        return { count: inbox, wakes, dead };
      }
      const nav = fleet.fleetNavCounts(homeId);
      return { count: nav.inbox, wakes: nav.wakes, dead: nav.dead };
    },
  });

  bb.events.on("thread.archived", async (event) => {
    const threadId = event.thread.id;
    fleet.closeOutRegistryForArchivedThread(threadId);
  });

  bb.events.on("thread.idle", async (event) => {
    onThreadIdle(store, () => fleet.publish(), event.thread.id);
  });

  bb.events.on("turn.failed", async (event) => {
    const threadId = event.threadId;
    const node = store.getNodeByThread(threadId);
    if (!node) return;
    const hasOpenHolds = fleet.hasOpenHolds(node.homeId, threadId);
    const liveness = store.getLiveness(threadId);
    const suppressTurnFailedWake =
      isSemanticallyBlocked(store, threadId, hasOpenHolds) ||
      liveness?.detail?.controlStop === true ||
      hasTerminalLedgerState(store, threadId);
    store.appendLedger({
      homeId: node.homeId,
      threadId,
      verb: "turn.failed",
      fsmState: "error",
    });
    if (!suppressTurnFailedWake) {
      store.enqueueWake({
        homeId: node.homeId,
        threadId,
        targetMateId: store.getHome(node.homeId)?.primaryMateId ?? null,
        reason: "turn.failed",
        priority: 8,
        dedupeKey: `turn.failed:${threadId}`,
      });
      store.createInboxItem({
        homeId: node.homeId,
        threadId,
        kind: "wake",
        urgency: "high",
        title: "Turn failed",
        body: `Thread ${threadId} failed a turn.`,
      });
    }
    fleet.publish();
  });

  bb.background.service("fleet-status-bridge", {
    async start(signal) {
      while (!signal.aborted) {
        const config = await getConfig();
        for (const home of store.listHomes()) {
          try {
            const checkoutPaths = await fleet.mateCheckoutPaths(home.homeId);
            await statusBridge.scanMateHome(home.homeId, checkoutPaths);
          } catch (error) {
            bb.log.warn(`fleet: status bridge scan failed for ${home.homeId}: ${error}`);
          }
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, config.statusBridgeIntervalMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  bb.background.service("fleet-pr-poller", {
    async start(signal) {
      while (!signal.aborted) {
        for (const home of store.listHomes()) {
          try {
            await prPoller.pollHome(home.homeId);
          } catch (error) {
            bb.log.warn(`fleet: PR poller failed for ${home.homeId}: ${error}`);
          }
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 120_000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  bb.background.service("fleet-supervisor", {
    async start(signal) {
      const SUPERVISOR_LOCK_KEY = "fleet.supervisor.lock";
      const owner = `supervisor-${process.pid}`;
      while (!signal.aborted) {
        const config = await getConfig();
        const now = Date.now();
        const lock = await bb.storage.kv.get<{
          owner: string;
          expiresMs: number;
        }>(SUPERVISOR_LOCK_KEY);
        if (lock && lock.expiresMs > now && lock.owner !== owner) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, config.probeIntervalMs);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          continue;
        }
        const lockTtlMs = config.probeIntervalMs + 2000;
        const refreshSupervisorLock = async () => {
          await bb.storage.kv.set(SUPERVISOR_LOCK_KEY, {
            owner,
            expiresMs: Date.now() + lockTtlMs,
          });
        };
        await refreshSupervisorLock();
        await applyRuntimeLimits();
        const priorBeaconMs =
          (await bb.storage.kv.get<number>("fleet.supervisor.beaconMs")) ?? 0;
        if (
          priorBeaconMs > 0 &&
          supervisorDeadAlarmDue({
            lockExpiresMs: lock?.expiresMs ?? 0,
            lastBeaconMs: priorBeaconMs,
            nowMs: now,
            graceMs: config.probeIntervalMs * 3,
          })
        ) {
          for (const home of store.listHomes()) {
            store.enqueueWake({
              homeId: home.homeId,
              threadId: home.mateThreadId,
              targetMateId: home.primaryMateId,
              reason: `supervisor.dead:${home.homeId}`,
              priority: 10,
              dedupeKey: `supervisor.dead:${home.homeId}`,
            });
          }
        }
        await bb.storage.kv.set("fleet.supervisor.beaconMs", Date.now());
        const startupDone = await bb.storage.kv.get<boolean>(
          "fleet.supervisor.startupScan",
        );
        if (!startupDone) {
          for (const home of store.listHomes()) {
            for (const node of store.listNodes(home.homeId)) {
              if (node.kind === "crew" && fleet.fsmForThread(node.threadId) === "idle") {
                store.enqueueWake({
                  homeId: home.homeId,
                  threadId: home.mateThreadId,
                  targetMateId: home.primaryMateId,
                  reason: startupInactiveScanReason(node.threadId),
                  priority: 2,
                  dedupeKey: `startup-inactive:${node.threadId}`,
                });
              }
            }
            store.enqueueWake({
              homeId: home.homeId,
              threadId: home.mateThreadId,
              targetMateId: home.primaryMateId,
              reason: checkKindWakeReason("startup"),
              priority: 1,
              dedupeKey: `check:startup:${home.homeId}`,
            });
          }
          await bb.storage.kv.set("fleet.supervisor.startupScan", true);
        }

        const homes = store.listHomes();
        for (const home of homes) {
          const nodes = store.listNodes(home.homeId);
          for (const node of nodes) {
            if (isLegacyFleetThreadId(node.threadId)) continue;
            await refreshSupervisorLock();
            const fsm = fleet.fsmForThread(node.threadId);
            const verdict = await fleet.probeThread(node.threadId);
            await refreshSupervisorLock();
            const liveness = store.getLiveness(node.threadId);
            if (
              (verdict === "dead" || verdict === "missing") &&
              liveness?.detail?.controlStop !== true
            ) {
              store.createInboxItem({
                homeId: home.homeId,
                threadId: node.threadId,
                kind: "liveness",
                urgency: "high",
                title: `${node.label} ${verdict}`,
                body: `Liveness probe returned ${verdict}.`,
              });
              if (
                shouldSupervisorRespawnWake({
                  autoRespawn: config.autoRespawn,
                  verdict,
                  controlStop: liveness?.detail?.controlStop === true,
                  hasOpenHolds: fleet.hasOpenHolds(
                    home.homeId,
                    node.threadId,
                  ),
                })
              ) {
                const episodeId = recoveryEpisodeId(node.threadId);
                store.enqueueWake({
                  homeId: home.homeId,
                  threadId: home.mateThreadId,
                  targetMateId: home.primaryMateId,
                  reason: recoveryWakeReason(episodeId),
                  priority: 9,
                  dedupeKey: livenessWakeDedupeKey(node.threadId),
                });
              }
            }
            const awayPosture =
              (await bb.storage.kv.get<boolean>(awayPostureKvKey(home.homeId))) ===
              true;
            const lastPaused = store.latestLedgerByVerbs(node.threadId, [
              "crew.paused",
            ]);
            const pauseCadenceSec = Math.max(
              60,
              Math.floor(config.staleIdleSec / 3),
            );
            if (
              hasIntentionalPauseState(store, node.threadId) &&
              lastPaused &&
              pauseResurfaceDueMs(
                lastPaused.createdAtMs,
                pauseCadenceSec,
                Date.now(),
              )
            ) {
              const resurfaceReason = pauseResurfaceWakeReason(node.threadId);
              if (shouldEnqueueMateWake(resurfaceReason, awayPosture)) {
                store.enqueueWake({
                  homeId: home.homeId,
                  threadId: home.mateThreadId,
                  targetMateId: home.primaryMateId,
                  reason: resurfaceReason,
                  priority: 4,
                  dedupeKey: resurfaceReason,
                });
              }
            }
            const compactProgress = store
              .tailLedger(node.threadId, 8)
              .find((entry) => {
                if (entry.verb !== PROGRESS_LEDGER_VERB) return false;
                const detail = entry.detail
                  ? JSON.stringify(entry.detail)
                  : "";
                return detail.toLowerCase().includes("compact");
              });
            if (compactProgress) {
              const refreshCursorKey = instructionRefreshCursorKvKey(
                node.threadId,
              );
              const handledCompactMs =
                (await bb.storage.kv.get<number>(refreshCursorKey)) ?? 0;
              if (compactProgress.createdAtMs > handledCompactMs) {
                const refreshReason = instructionRefreshReason(node.threadId);
                if (shouldEnqueueMateWake(refreshReason, awayPosture)) {
                  const refreshWakeId = store.enqueueWake({
                    homeId: home.homeId,
                    threadId: home.mateThreadId,
                    targetMateId: home.primaryMateId,
                    reason: refreshReason,
                    priority: 2,
                    dedupeKey: refreshReason,
                  });
                  if (refreshWakeId) {
                    store.appendLedger({
                      homeId: home.homeId,
                      threadId: node.threadId,
                      verb: "instruction.refresh",
                      fsmState: fsm,
                      detail: { signal: "compact" },
                    });
                    await bb.storage.kv.set(
                      refreshCursorKey,
                      compactProgress.createdAtMs,
                    );
                  }
                }
              }
            }
            if (
              shouldEnqueueBusyAgeStall(
                store,
                node.threadId,
                fleet.hasOpenHolds(home.homeId, node.threadId),
                config.busyAgeSec,
              )
            ) {
              store.enqueueWake({
                homeId: home.homeId,
                threadId: home.mateThreadId,
                targetMateId: home.primaryMateId,
                reason: `stall:${node.threadId}`,
                priority: 4,
                dedupeKey: `stall:${node.threadId}`,
              });
            }
            if (
              shouldEnqueueStaleIdleSupervision(
                fsm,
                store,
                node.threadId,
                fleet.hasOpenHolds(home.homeId, node.threadId),
              )
            ) {
              const entries = store.tailLedger(node.threadId, 1);
              const last = entries[0];
              if (
                last &&
                Date.now() - last.createdAtMs > config.staleIdleSec * 1000
              ) {
                let worktreeMtimeMs = 0;
                if (node.envId) {
                  try {
                    const env = await bb.sdk.environments.get({
                      environmentId: node.envId,
                    });
                    const worktreePath = env.path?.trim();
                    if (worktreePath) {
                      const stat = await fs.stat(worktreePath);
                      worktreeMtimeMs = stat.mtimeMs;
                    }
                  } catch {
                    worktreeMtimeMs = 0;
                  }
                }
                const deferStale = shouldDeferStaleIdleForWorktreeMtime({
                  lastStatusMs: last.createdAtMs,
                  worktreeMtimeMs,
                  quietSec: 120,
                });
                if (!deferStale) {
                  const wedgeKey = `fleet.wedge.${node.threadId}`;
                  const wedgeCount =
                    (await bb.storage.kv.get<number>(wedgeKey)) ?? 0;
                  const nextWedge = nextWedgeEscalationCount(wedgeCount);
                  await bb.storage.kv.set(wedgeKey, nextWedge);
                  const escalated = shouldEscalateWedge(nextWedge);
                  const reason = escalated
                    ? wedgeWakeReason(node.threadId)
                    : `stale-idle:${node.threadId}`;
                  const dedupeKey = escalated
                    ? `wedge:${node.threadId}`
                    : `stale-idle:${node.threadId}`;
                  if (shouldEnqueueMateWake(reason, awayPosture)) {
                    store.enqueueWake({
                      homeId: home.homeId,
                      threadId: home.mateThreadId,
                      targetMateId: home.primaryMateId,
                      reason,
                      priority: escalated ? 5 : 3,
                      dedupeKey,
                    });
                  }
                }
              }
            } else {
              await bb.storage.kv.set(`fleet.wedge.${node.threadId}`, 0);
            }
          }
          await fleet.processSteerQueues(home.homeId);
          await fleet.checkPostSteerStalls(home.homeId);
        }
        fleet.publish();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, config.probeIntervalMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  bb.http.route(
    "POST",
    "/github/webhook",
    async (c) => {
      const webhookSettings = await settings.get();
      const webhookSecret = webhookSettings.githubWebhookSecret.trim();
      const bbPluginToken =
        c.req.header("x-bb-plugin-token") ??
        new URL(c.req.url).searchParams.get("token") ??
        undefined;
      if (
        !githubWebhookAuthorized({
          configuredSecret: webhookSecret,
          headerSecret: c.req.header("X-Fleet-Webhook-Secret"),
          bbPluginToken,
        })
      ) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
      let body: unknown = null;
      try {
        body = await c.req.json();
      } catch {
        body = null;
      }
      const parsed = parseGithubWebhookEvent(body);
      if (!parsed?.prUrl) {
        return c.json({ ok: false, error: "invalid payload" }, 400);
      }
      for (const home of store.listHomes()) {
        const crewThreadIds = store
          .listNodes(home.homeId)
          .filter((node) => node.kind === "crew")
          .map((node) => node.threadId);
        if (
          !homeHasLedgerPrUrl(
            crewThreadIds,
            (threadId, limit) => store.tailLedger(threadId, limit),
            parsed.prUrl,
          )
        ) {
          continue;
        }
        store.enqueueWake({
          homeId: home.homeId,
          threadId: home.mateThreadId,
          targetMateId: home.primaryMateId,
          reason: `webhook:${parsed.action}:${parsed.prUrl}`,
          priority: 6,
          dedupeKey: `webhook:${home.homeId}:${parsed.action}:${parsed.prUrl}`,
        });
      }
      fleet.publish();
      return c.json({ ok: true });
    },
    { auth: "none" },
  );

  const usage = [
    "Usage:",
    "  bb fleet status [--mate <homeId>] [--json]",
    "  bb fleet home bootstrap <homeId> --label <name> [--parent <dir>]",
    "  bb fleet home create <homeId> --label <name> --thread <threadId> [--parent <dir>] [--checkout <path>]",
    "  bb fleet home list [--json]",
    "  bb fleet home select <homeId>",
    "  bb fleet tree [--mate <homeId>] [--json]",
    "  bb fleet board [--mate <homeId>] [--json]",
    "  bb fleet crew attach --mate <homeId> --thread <id> --label <name> --role ship|scout",
    "  bb fleet secondmate create --mate <homeId> --thread <id> --label <name>",
    "  bb fleet spawn --mate <homeId> --role ship|scout --label <name> --prompt <text>",
    "  bb fleet mark --mate <homeId> --thread <id> --state <fsm>",
    "  bb fleet steer --mate <homeId> --thread <id> --text <message>",
    "  bb fleet interrupt|exit|relaunch|detach --mate <homeId> --thread <id>",
    "  bb fleet bearings [--mate <homeId>] [--json]",
    "  bb fleet hold open|list|resolve ...",
    "  bb fleet sweep --mate <homeId>",
    "  bb fleet inbox [--mate <homeId>] [--json]",
    "  bb fleet inbox snooze|resolve <id> [--mate <homeId>]",
    "  bb fleet probe [--mate <homeId>] [--thread <id>]",
    "  bb fleet digest [--mate <homeId>] [--tell-cos] [--json]",
    "  bb fleet profiles --mate <homeId>",
    "  bb fleet integration apply [--mate <homeId>]",
    "  bb fleet integration check [--mate <homeId>] [--json]",
  ].join("\n");

  bb.cli.register({
    name: "fleet",
    summary: "Firstmate Fleet control plane",
    commands: [
      { name: "status", summary: "Fleet status", usage: "bb fleet status" },
      { name: "home", summary: "Mate home management", usage: "bb fleet home ..." },
      { name: "tree", summary: "Fleet tree", usage: "bb fleet tree" },
      { name: "board", summary: "Fleet board", usage: "bb fleet board" },
      { name: "crew", summary: "Crew registry", usage: "bb fleet crew ..." },
      { name: "secondmate", summary: "Lead secondmate", usage: "bb fleet secondmate ..." },
      { name: "spawn", summary: "Spawn crew thread", usage: "bb fleet spawn ..." },
      { name: "mark", summary: "Mark FSM state", usage: "bb fleet mark ..." },
      { name: "steer", summary: "Data-plane steer", usage: "bb fleet steer ..." },
      { name: "interrupt", summary: "Interrupt thread", usage: "bb fleet interrupt ..." },
      { name: "exit", summary: "Exit thread", usage: "bb fleet exit ..." },
      { name: "relaunch", summary: "Relaunch crew thread", usage: "bb fleet relaunch ..." },
      { name: "detach", summary: "Detach crew from registry", usage: "bb fleet detach ..." },
      { name: "hold", summary: "Holds", usage: "bb fleet hold ..." },
      { name: "sweep", summary: "Remove orphan registry nodes", usage: "bb fleet sweep ..." },
      { name: "inbox", summary: "Fleet inbox", usage: "bb fleet inbox ..." },
      { name: "probe", summary: "Liveness probe", usage: "bb fleet probe ..." },
      { name: "digest", summary: "CoS digest", usage: "bb fleet digest ..." },
      { name: "bearings", summary: "Fleet bearings", usage: "bb fleet bearings ..." },
      { name: "profiles", summary: "Dispatch profiles", usage: "bb fleet profiles ..." },
      { name: "integration", summary: "Firstmate BB overlay", usage: "bb fleet integration ..." },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const filtered = argv.filter((arg) => arg !== "--json");
      const { positional, flags } = parseCliFlags(filtered);
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });
      const mateFlag = flags.get("mate");
      const homeId = () =>
        resolveHomeId(
          typeof mateFlag === "string" ? mateFlag : store.getSelectedHomeId(),
        );

      const [command, sub, ...rest] = positional;
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "status": {
            const id = flags.has("mate") ? homeId() : store.getSelectedHomeId();
            if (id) {
              const digest = fleet.buildDigest(id);
              return reply(digest, digest.summary);
            }
            const homes = store.listHomes();
            return reply(
              { homes, selectedHomeId: null },
              `Homes: ${homes.map((h) => h.homeId).join(", ") || "none"}`,
            );
          }
          case "home": {
            if (sub === "list") {
              const homes = store.listHomes();
              return reply(
                homes,
                homes.length
                  ? homes.map((h) => `${h.homeId}\t${h.label}`).join("\n")
                  : "No mate homes.",
              );
            }
            if (sub === "select") {
              const id = rest[0];
              if (!id) return { exitCode: 1, stderr: "Usage: bb fleet home select <homeId>" };
              fleet.assertHome(id);
              store.setSelectedHomeId(id);
              fleet.publish();
              return reply({ selectedHomeId: id }, `Selected ${id}`);
            }
            if (sub === "bootstrap") {
              const id = rest[0];
              const label = flags.get("label");
              const parentFlag = flags.get("parent");
              const parent =
                typeof parentFlag === "string" ? parentFlag : undefined;
              if (!id || typeof label !== "string") {
                return {
                  exitCode: 1,
                  stderr:
                    "Usage: bb fleet home bootstrap <homeId> --label <name> [--parent <dir>]",
                };
              }
              const home = await fleet.createHomeWithMateThread({
                homeId: id,
                label,
                parentDir: parent,
              });
              return reply(
                home,
                `Bootstrapped home ${home.homeId} at ${home.checkoutPath}`,
              );
            }
            if (sub === "create") {
              const id = rest[0];
              const label = flags.get("label");
              const checkoutFlag = flags.get("checkout");
              const checkout =
                typeof checkoutFlag === "string" ? checkoutFlag : undefined;
              const parentFlag = flags.get("parent");
              const parent =
                typeof parentFlag === "string" ? parentFlag : undefined;
              const thread = flags.get("thread");
              if (!id || typeof label !== "string" || typeof thread !== "string") {
                return {
                  exitCode: 1,
                  stderr:
                    "Usage: bb fleet home create <homeId> --label <name> --thread <threadId> [--parent <dir>] [--checkout <path>]",
                };
              }
              const home = await fleet.createHome({
                homeId: id,
                label,
                parentDir: parent,
                checkoutPath: checkout,
                mateThreadId: thread,
              });
              return reply(home, `Registered home ${home.homeId}`);
            }
            break;
          }
          case "tree": {
            const id = homeId();
            const nodes = store.listNodes(id);
            await Promise.all(
              nodes.map((node) => fleet.probeThread(node.threadId)),
            );
            const tree = fleet.buildTree(id);
            return reply({ tree }, JSON.stringify(tree, null, 2));
          }
          case "board": {
            const id = homeId();
            const nodes = store.listNodes(id);
            await Promise.all(
              nodes.map((node) => fleet.probeThread(node.threadId)),
            );
            const board = fleet.buildBoard(id);
            return reply(board, JSON.stringify(board, null, 2));
          }
          case "crew": {
            if (sub === "attach") {
              const thread = flags.get("thread");
              const label = flags.get("label");
              const role = flags.get("role");
              if (
                typeof thread !== "string" ||
                typeof label !== "string" ||
                (role !== "ship" && role !== "scout")
              ) {
                return { exitCode: 1, stderr: "Missing --thread --label --role" };
              }
              const node = fleet.attachCrew({
                homeId: homeId(),
                threadId: thread,
                label,
                role,
              });
              return reply(node, `Attached crew ${node.id}`);
            }
            break;
          }
          case "secondmate": {
            if (sub === "create") {
              const thread = flags.get("thread");
              const label = flags.get("label");
              if (typeof thread !== "string" || typeof label !== "string") {
                return { exitCode: 1, stderr: "Missing --thread --label" };
              }
              const node = fleet.createSecondmate({
                homeId: homeId(),
                threadId: thread,
                label,
              });
              return reply(node, `Created secondmate ${node.id}`);
            }
            break;
          }
          case "spawn": {
            const batchFile = flags.get("batch-file");
            if (typeof batchFile === "string") {
              const raw = await fs.readFile(batchFile, "utf8");
              const specs = parseBatchSpawnJson(raw);
              const nodes = await fleet.spawnCrewBatch(homeId(), specs);
              return reply(
                { count: nodes.length, nodes },
                `Batch spawned ${nodes.length} crews`,
              );
            }
            const label = flags.get("label");
            const role = flags.get("role");
            const prompt = flags.get("prompt");
            const modeFlag = flags.get("mode");
            const profileFlag = flags.get("profile");
            const shipProjectFlag = flags.get("ship-project-id");
            if (
              typeof label !== "string" ||
              (role !== "ship" && role !== "scout") ||
              typeof prompt !== "string"
            ) {
              return { exitCode: 1, stderr: "Missing --label --role --prompt" };
            }
            const deliveryMode =
              modeFlag === "no-mistakes" ||
              modeFlag === "direct-PR" ||
              modeFlag === "local-only"
                ? modeFlag
                : undefined;
            const node = await fleet.spawnCrewWithPaths({
              homeId: homeId(),
              label,
              role,
              prompt,
              deliveryMode,
              yolo: flags.has("yolo"),
              profileId:
                typeof profileFlag === "string" ? profileFlag : undefined,
              shipProjectId:
                typeof shipProjectFlag === "string"
                  ? shipProjectFlag
                  : undefined,
            });
            const payload = {
              ...node,
              threadId: node.threadId,
              envId: node.envId,
              environmentId: node.envId,
              worktreePath: node.worktreePath,
              checkoutPath: node.worktreePath,
            };
            return reply(
              payload,
              `Spawned ${role} ${node.threadId}${node.worktreePath ? ` @ ${node.worktreePath}` : ""}`,
            );
          }
          case "mark": {
            const thread = flags.get("thread");
            const state = flags.get("state");
            if (typeof thread !== "string" || typeof state !== "string") {
              return { exitCode: 1, stderr: "Missing --thread --state" };
            }
            fleet.markThread(homeId(), thread, state as Parameters<typeof fleet.markThread>[2]);
            return reply(null, `Marked ${thread} as ${state}`);
          }
          case "steer": {
            const thread = flags.get("thread");
            const text = flags.get("text");
            if (typeof thread !== "string" || typeof text !== "string") {
              return { exitCode: 1, stderr: "Missing --thread --text" };
            }
            await fleet.steer(homeId(), thread, text);
            return reply(null, `Steered ${thread}`);
          }
          case "interrupt":
          case "exit":
          case "relaunch":
          case "detach": {
            const thread = flags.get("thread");
            if (typeof thread !== "string") {
              return { exitCode: 1, stderr: "Missing --thread" };
            }
            const id = homeId();
            if (command === "interrupt") await fleet.interrupt(id, thread);
            else if (command === "exit") await fleet.exitThread(id, thread);
            else if (command === "relaunch") {
              const prompt =
                typeof flags.get("prompt") === "string"
                  ? String(flags.get("prompt"))
                  : undefined;
              const node = await fleet.relaunch(id, thread, prompt);
              return reply(node, `Relaunched ${node.label} as ${node.threadId}`);
            } else {
              await fleet.detachCrew(id, thread);
            }
            return reply(null, `${command} ${thread}`);
          }
          case "hold": {
            const id = homeId();
            if (sub === "open") {
              const thread = flags.get("thread");
              const title = flags.get("title");
              const body = flags.get("body");
              const mate = flags.get("mate-id") ?? store.getHome(id)?.primaryMateId;
              if (
                typeof thread !== "string" ||
                typeof title !== "string" ||
                typeof body !== "string" ||
                typeof mate !== "string"
              ) {
                return { exitCode: 1, stderr: "Missing hold fields" };
              }
              const hold = fleet.openHold({
                homeId: id,
                mateId: mate,
                threadId: thread,
                title,
                body,
              });
              return reply(hold, `Opened hold ${hold.id}`);
            }
            if (sub === "resolve") {
              const holdId = rest[0];
              if (!holdId) return { exitCode: 1, stderr: "Usage: bb fleet hold resolve <id>" };
              fleet.resolveHold(id, holdId);
              return reply(null, `Resolved hold ${holdId}`);
            }
            if (sub === "list" || sub === undefined) {
              const thread = flags.get("thread");
              const stateFlag = flags.get("state");
              let holds = store.listHolds(
                id,
                stateFlag === "open"
                  ? "open"
                  : stateFlag === "resolved"
                    ? "resolved"
                    : undefined,
              );
              if (typeof thread === "string") {
                holds = holds.filter((hold) => hold.threadId === thread);
              }
              const openCount = holds.filter((hold) => hold.state === "open").length;
              return reply(
                { holds, openCount },
                holds.length
                  ? holds.map((h) => `${h.id}\t${h.state}\t${h.title}`).join("\n")
                  : "No holds.",
              );
            }
            break;
          }
          case "sweep": {
            const id = homeId();
            const result = await fleet.sweepOrphans(id);
            return reply(
              result,
              `Removed ${result.removed.length} orphan(s); skipped ${result.skipped.length}.`,
            );
          }
          case "inbox": {
            const id = flags.has("mate") ? homeId() : store.getSelectedHomeId();
            if (!id) return { exitCode: 1, stderr: "No home selected" };
            if (sub === "snooze") {
              const itemId = rest[0];
              const hours = Number(flags.get("hours") ?? "1");
              if (!itemId) return { exitCode: 1, stderr: "Missing inbox id" };
              store.snoozeInbox(itemId, Date.now() + hours * 3600_000);
              fleet.publish();
              return reply(null, `Snoozed ${itemId}`);
            }
            if (sub === "resolve") {
              const itemId = rest[0];
              if (!itemId) return { exitCode: 1, stderr: "Missing inbox id" };
              store.resolveInbox(itemId);
              fleet.publish();
              return reply(null, `Resolved ${itemId}`);
            }
            const limitRaw = flags.get("limit");
            const limit =
              typeof limitRaw === "string"
                ? Math.min(500, Math.max(1, Number.parseInt(limitRaw, 10) || 100))
                : 100;
            const items = store.listInbox(id, "open", limit);
            const totalOpen = store.countOpenInbox(id);
            return reply(
              { items, totalOpen, limit },
              items.length
                ? items.map((item) => `${item.id}\t${item.title}`).join("\n")
                : "Inbox empty.",
            );
          }
          case "probe": {
            const thread = flags.get("thread");
            if (typeof thread === "string") {
              const verdict = await fleet.probeThread(thread);
              return reply({ verdict }, verdict);
            }
            const id = homeId();
            const nodes = store.listNodes(id);
            const results = await Promise.all(
              nodes.map(async (node) => ({
                threadId: node.threadId,
                label: node.label,
                verdict: await fleet.probeThread(node.threadId),
              })),
            );
            return reply(
              results,
              results.map((r) => `${r.label}\t${r.verdict}`).join("\n"),
            );
          }
          case "away": {
            const id = homeId();
            const mode = rest[0];
            if (mode === "on") {
              await bb.storage.kv.set(awayPostureKvKey(id), true);
              await bb.storage.kv.set(`${awayPostureKvKey(id)}.since`, Date.now());
              return reply(null, "Away posture on");
            }
            if (mode === "off") {
              const since =
                (await bb.storage.kv.get<number>(`${awayPostureKvKey(id)}.since`)) ??
                Date.now();
              await bb.storage.kv.set(awayPostureKvKey(id), false);
              const brief = buildReturnBrief({
                awayStartedMs: since,
                nowMs: Date.now(),
                inboxOpened: store.countOpenInbox(id),
                wakesUnacked: store.countUnackedWakes(id),
                divergences: store.countLedgerVerbSince(
                  id,
                  DIVERGENCE_LEDGER_VERB,
                  since,
                ),
              });
              return reply({ brief }, brief);
            }
            return { exitCode: 1, stderr: "Usage: bb fleet away on|off" };
          }
          case "digest": {
            const id = homeId();
            const digest = fleet.buildDigest(id);
            if (flags.has("tell-cos")) {
              const config = await getConfig();
              if (config.cosThreadId) {
                await bb.sdk.threads.send({
                  threadId: config.cosThreadId,
                  mode: "auto",
                  input: [
                    {
                      type: "text",
                      text: digest.summary,
                      mentions: [],
                    },
                  ],
                });
              }
            }
            return reply(digest, digest.summary);
          }
          case "bearings": {
            const id = homeId();
            const bearings = fleet.buildBearings(id);
            if (flags.has("tell-cos")) {
              const config = await getConfig();
              if (config.cosThreadId) {
                await bb.sdk.threads.send({
                  threadId: config.cosThreadId,
                  mode: "auto",
                  input: [
                    {
                      type: "text",
                      text: bearings.summary,
                      mentions: [],
                    },
                  ],
                });
              }
            }
            return reply(bearings, bearings.summary);
          }
          case "profiles": {
            const id = homeId();
            if (sub === "add" || sub === "upsert") {
              const label = flags.get("label");
              if (typeof label !== "string") {
                return { exitCode: 1, stderr: "Missing --label" };
              }
              const profile = store.upsertProfile({
                id: typeof flags.get("id") === "string" ? String(flags.get("id")) : undefined,
                homeId: id,
                label,
                providerId:
                  typeof flags.get("provider") === "string"
                    ? String(flags.get("provider"))
                    : null,
                model:
                  typeof flags.get("model") === "string"
                    ? String(flags.get("model"))
                    : null,
                effort:
                  typeof flags.get("effort") === "string"
                    ? String(flags.get("effort"))
                    : null,
                taskClasses: [],
              });
              fleet.publish();
              return reply(profile, `Profile ${profile.id}`);
            }
            if (sub === "delete" || sub === "rm") {
              const profileId = rest[0];
              if (!profileId) {
                return { exitCode: 1, stderr: "Usage: bb fleet profiles delete <id>" };
              }
              if (!store.deleteProfile(id, profileId)) {
                return { exitCode: 1, stderr: `Unknown profile ${profileId}` };
              }
              fleet.publish();
              return reply(null, `Deleted profile ${profileId}`);
            }
            const profiles = store.listProfiles(id);
            return reply(
              profiles,
              profiles.map((p) => `${p.id}\t${p.label}`).join("\n") || "No profiles.",
            );
          }
          case "integration": {
            const id = homeId();
            const home = store.getHome(id);
            if (!home) {
              return { exitCode: 1, stderr: `Unknown mate home "${id}".` };
            }
            if (sub === "check") {
              const result = await fleet.checkBbIntegration({
                checkoutPath: home.checkoutPath,
                mateThreadId: home.mateThreadId,
              });
              return reply(
                result,
                result.ok
                  ? "BB integration overlay OK."
                  : `BB integration issues:\n- ${result.issues.join("\n- ")}`,
              );
            }
            if (sub === "apply" || sub === undefined) {
              const applied = await fleet.ensureBbIntegration({
                homeId: id,
                mateThreadId: home.mateThreadId,
                checkoutPath: home.checkoutPath,
              });
              return reply(
                applied,
                `Applied BB integration v${applied.integrationVersion} to ${applied.checkoutPath}`,
              );
            }
            return {
              exitCode: 1,
              stderr: "Usage: bb fleet integration apply|check [--mate <homeId>]",
            };
          }
        }
      } catch (error) {
        return { exitCode: 1, stderr: String(error) };
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("firstmate-control-plane: disposed");
  });
}
