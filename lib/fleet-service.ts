import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { FleetStore } from "./db";
import { projectFsm, verbForMark } from "./fsm";
import {
  applyFirstmateIntegration,
  INTEGRATION_VERSION,
  matePromptWithBbIntegration,
  runIntegrationSelfCheck,
} from "./apply-firstmate-integration";
import {
  checkoutPathForHome,
  DEFAULT_FIRSTMATE_REPO_URL,
  DEFAULT_PARENT_DIR,
  ensureFirstmateCheckout,
  pathExists,
  pathIsGitCheckout,
} from "./firstmate-checkout";
import {
  formatOpenChildBlockMessage,
  isBbThreadArchived,
  openChildBlockersFromNodes,
  type OpenChildBlocker,
} from "./mate-thread-reset";
import {
  mateEnvironmentPath,
  resolveMateCheckoutPaths,
  resolveMateStateRoot,
} from "./mate-checkout-paths";
import {
  fsmFromStatusPrefix,
  ledgerVerbFromStatus,
  parseStatusLine,
} from "./status-verbs";
import { wakeIdsToAckThrough } from "./fleet-bridge-helpers";
import {
  DEFAULT_MATE_DEFAULTS,
  MATE_DEFAULTS_KV_KEY,
  normalizeMateDefaults,
  type MateDefaults,
} from "./mate-defaults";
import type {
  Bearings,
  Digest,
  FleetNode,
  FsmState,
  HoldKind,
  Home,
  LivenessVerdict,
  TreeNode,
} from "./types";
import type { BatchSpawnSpec } from "./fleet-batch-spawn";
import {
  canDispatchCrew,
  countActiveCrewSlots,
  DEFAULT_MAX_CREW_CONCURRENCY,
  dispatchWaitMessage,
} from "./fleet-dispatch-limit";
import {
  authorityEscalationWakeReason,
  captainHoldDefaultUrgency,
  normalizeHoldKind,
  routeHoldNotifyThreadId,
} from "./fleet-captain-holds";
import {
  detectLivenessDesync,
  DESYNC_LEDGER_VERB,
  livenessDesyncCursorKvKey,
  reconcileDesyncFsm,
} from "./liveness-desync";
import { latestSemanticWorkingAtMs } from "./supervisor-wakes";
import {
  CAPTAIN_ATTACH_LEDGER_VERB,
  doorbellNudgeText,
  isThreadReadyForSteer,
  shouldFirePostSteerStallWatchdog,
  shouldQueueSteerWhileBusy,
  shouldRetryUnconfirmedSubmit,
  steerInboxTitle,
} from "./fleet-steer-delivery";
import {
  appendMetaFleetDetached,
  isMetaFleetDetached,
} from "./fleet-meta-closeout";
import { DIVERGENCE_LEDGER_VERB } from "./status-divergence";

export const FLEET_CHANGED = "fleet-changed";

function metaField(meta: string, key: string): string | null {
  const match = meta.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function legacyThreadId(homeId: string, taskId: string): string {
  return `legacy:${homeId}:${taskId}`;
}

function wakeTiedToCrewThread(
  wake: { threadId: string | null; dedupeKey: string | null },
  crewThreadId: string,
  resolvedHoldIds: readonly string[],
): boolean {
  if (wake.threadId === crewThreadId) return true;
  const key = wake.dedupeKey;
  if (!key) return false;
  if (resolvedHoldIds.some((holdId) => key === `hold:${holdId}`)) {
    return true;
  }
  if (key === `thread.idle:${crewThreadId}`) return true;
  if (key.startsWith(`terminal:${crewThreadId}:`)) return true;
  if (key.startsWith(`blocked:${crewThreadId}:`)) return true;
  if (key === `pr.ready:${crewThreadId}`) return true;
  if (key === `pr.green:${crewThreadId}`) return true;
  if (key === `pr.failed:${crewThreadId}`) return true;
  if (key === `liveness:${crewThreadId}`) return true;
  if (key === `stall:${crewThreadId}`) return true;
  if (key === `stale-idle:${crewThreadId}`) return true;
  if (key === `turn.failed:${crewThreadId}`) return true;
  return false;
}

export { wakeTiedToCrewThread };

export function isLegacyFleetThreadId(threadId: string): boolean {
  return threadId.startsWith("legacy:");
}

export type FleetConfig = {
  firstmateRepoUrl: string;
  defaultParentDir: string;
};

export type FleetRuntimeLimits = {
  maxConcurrency: number;
  postSteerStallSec: number;
};

export const DEFAULT_FLEET_RUNTIME_LIMITS: FleetRuntimeLimits = {
  maxConcurrency: DEFAULT_MAX_CREW_CONCURRENCY,
  postSteerStallSec: 300,
};

export const DEFAULT_FLEET_CONFIG: FleetConfig = {
  firstmateRepoUrl: DEFAULT_FIRSTMATE_REPO_URL,
  defaultParentDir: DEFAULT_PARENT_DIR,
};

export class FleetService {
  private runtimeLimits: FleetRuntimeLimits = {
    ...DEFAULT_FLEET_RUNTIME_LIMITS,
  };
  private cosThreadId: string | null = null;

  constructor(
    private readonly bb: BbPluginApi,
    readonly store: FleetStore,
    private readonly config: FleetConfig = DEFAULT_FLEET_CONFIG,
  ) {}

  setCosThreadId(threadId: string | null): void {
    this.cosThreadId = threadId?.trim() ? threadId.trim() : null;
  }

  setRuntimeLimits(partial: Partial<FleetRuntimeLimits>): void {
    this.runtimeLimits = { ...this.runtimeLimits, ...partial };
  }

  getRuntimeLimits(): FleetRuntimeLimits {
    return this.runtimeLimits;
  }

  getConfig(): FleetConfig {
    return this.config;
  }

  async readMateDefaults(): Promise<MateDefaults> {
    const kv = this.bb.storage?.kv;
    if (!kv) {
      return DEFAULT_MATE_DEFAULTS;
    }
    const stored = await kv.get<Partial<MateDefaults>>(MATE_DEFAULTS_KV_KEY);
    return normalizeMateDefaults(stored);
  }

  /** Provider/model for crew spawns when no dispatch profile overrides. */
  private async resolveCrewExecution(
    profile?: { providerId?: string | null; model?: string | null },
  ): Promise<MateDefaults> {
    const defaults = await this.readMateDefaults();
    const providerId = profile?.providerId?.trim();
    const model = profile?.model?.trim();
    if (providerId && model) {
      return { providerId, model };
    }
    if (model) {
      return { providerId: providerId || defaults.providerId, model };
    }
    if (providerId) {
      return { providerId, model: defaults.model };
    }
    return defaults;
  }

  private crewProjectIdKvKey(threadId: string): string {
    return `fleet.crewProjectId.${threadId}`;
  }

  private async readPersistedCrewProjectId(
    threadId: string,
  ): Promise<string | null> {
    const kv = this.bb.storage?.kv;
    if (!kv) return null;
    const stored = await kv.get<string>(this.crewProjectIdKvKey(threadId));
    const trimmed = stored?.trim();
    return trimmed || null;
  }

  private async persistCrewProjectId(
    threadId: string,
    projectId: string,
  ): Promise<void> {
    const kv = this.bb.storage?.kv;
    if (!kv) return;
    await kv.set(this.crewProjectIdKvKey(threadId), projectId);
  }

  private async copyPersistedCrewProjectId(
    fromThreadId: string,
    toThreadId: string,
  ): Promise<void> {
    const projectId = await this.readPersistedCrewProjectId(fromThreadId);
    if (!projectId) return;
    await this.persistCrewProjectId(toThreadId, projectId);
  }

  async writeMateDefaults(input: MateDefaults): Promise<MateDefaults> {
    const next = normalizeMateDefaults(input);
    await this.bb.storage.kv.set(MATE_DEFAULTS_KV_KEY, next);
    return next;
  }

  resolveCheckoutPath(input: {
    homeId: string;
    parentDir?: string | null;
    checkoutPath?: string | null;
  }): string {
    const explicit = input.checkoutPath?.trim();
    if (explicit) return explicit;
    const parentDir =
      input.parentDir?.trim() || this.config.defaultParentDir;
    return checkoutPathForHome(parentDir, input.homeId);
  }

  async prepareFirstmateCheckout(input: {
    homeId: string;
    parentDir?: string | null;
    checkoutPath?: string | null;
    repoUrl?: string | null;
  }): Promise<{ checkoutPath: string; cloned: boolean }> {
    const checkoutPath = this.resolveCheckoutPath(input);
    const result = await ensureFirstmateCheckout({
      checkoutPath,
      repoUrl: input.repoUrl?.trim() || this.config.firstmateRepoUrl,
      log: this.bb.log,
    });
    return result;
  }

  async mateCheckoutPaths(homeId: string): Promise<string[]> {
    const home = this.store.getHome(homeId);
    if (!home) return [];
    return resolveMateCheckoutPaths(this.bb, home);
  }

  async mateStateRoot(homeId: string): Promise<string | null> {
    const home = this.store.getHome(homeId);
    if (!home) return null;
    return resolveMateStateRoot(this.bb, home);
  }

  async ensureBbIntegration(input: {
    homeId: string;
    mateThreadId: string;
    checkoutPath: string;
  }) {
    const checkoutPaths = new Set<string>(
      await resolveMateCheckoutPaths(this.bb, {
        checkoutPath: input.checkoutPath,
        mateThreadId: input.mateThreadId,
      }),
    );

    let last: Awaited<ReturnType<typeof applyFirstmateIntegration>> | null = null;
    for (const checkoutPath of checkoutPaths) {
      last = await applyFirstmateIntegration({
        checkoutPath,
        homeId: input.homeId,
        mateThreadId: input.mateThreadId,
        log: this.bb.log,
      });
    }
    if (!last) {
      throw new Error("No checkout path available for BB integration apply.");
    }
    return last;
  }

  async checkBbIntegration(input: {
    checkoutPath: string;
    mateThreadId?: string | null;
  }) {
    const paths = new Set<string>(
      input.mateThreadId
        ? await resolveMateCheckoutPaths(this.bb, {
            checkoutPath: input.checkoutPath,
            mateThreadId: input.mateThreadId,
          })
        : [input.checkoutPath.trim()],
    );
    const reports = await Promise.all(
      [...paths].map(async (checkoutPath) => ({
        checkoutPath,
        ...(await runIntegrationSelfCheck(checkoutPath)),
      })),
    );
    const issues = reports.flatMap((report) =>
      report.issues.map((issue) => `${report.checkoutPath}: ${issue}`),
    );
    return {
      ok: issues.length === 0,
      issues,
      reports,
      integrationVersion: INTEGRATION_VERSION,
    };
  }

  async previewHomeCheckout(input: {
    homeId: string;
    parentDir?: string | null;
  }): Promise<{
    checkoutPath: string;
    exists: boolean;
    isGitRepo: boolean;
    parentDir: string;
    repoUrl: string;
  }> {
    const homeId = this.normalizeHomeId(input.homeId);
    const parentDir =
      input.parentDir?.trim() || this.config.defaultParentDir;
    const checkoutPath = checkoutPathForHome(parentDir, homeId);
    const exists = await pathExists(checkoutPath);
    const isGitRepo = exists ? await pathIsGitCheckout(checkoutPath) : false;
    return {
      checkoutPath,
      exists,
      isGitRepo,
      parentDir,
      repoUrl: this.config.firstmateRepoUrl,
    };
  }

  publish(): void {
    try {
      this.bb.realtime.publish(FLEET_CHANGED, { at: Date.now() });
    } catch {
      this.bb.log.warn("fleet: realtime publish failed");
    }
  }

  assertHome(homeId: string): void {
    if (!this.store.getHome(homeId)) {
      throw new Error(`Unknown mate home "${homeId}".`);
    }
  }

  assertNodeHome(node: FleetNode, homeId: string): void {
    if (node.homeId !== homeId) {
      throw new Error(
        `Cross-home access denied: node ${node.id} belongs to ${node.homeId}, not ${homeId}.`,
      );
    }
  }

  fsmForThread(threadId: string): FsmState {
    const entries = this.store.tailLedger(threadId, 200).reverse();
    return projectFsm(entries);
  }

  buildTree(homeId: string): TreeNode[] {
    const nodes = this.store.listNodes(homeId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const childrenOf = new Map<string | null, FleetNode[]>();
    for (const node of nodes) {
      const key = node.parentId;
      const list = childrenOf.get(key) ?? [];
      list.push(node);
      childrenOf.set(key, list);
    }

    const primary = nodes.find((node) => node.kind === "primary");
    if (!primary) return [];

    const toTree = (node: FleetNode, depth: number): TreeNode => {
      const liveness = this.store.getLiveness(node.threadId);
      const kids = (childrenOf.get(node.id) ?? []).map((child) =>
        toTree(child, depth + 1),
      );
      const entries = this.store.tailLedger(node.threadId, 80).reverse();
      const prEntry = entries.find(
        (entry) =>
          entry.verb === "pr.opened" &&
          typeof entry.detail?.url === "string",
      );
      const prUrl =
        prEntry && typeof prEntry.detail?.url === "string"
          ? prEntry.detail.url
          : null;
      const profile = node.dispatchProfileId
        ? this.store
            .listProfiles(homeId)
            .find((candidate) => candidate.id === node.dispatchProfileId)
        : null;
      return {
        ...node,
        fsmState: this.fsmForThread(node.threadId),
        liveness: (liveness?.verdict as LivenessVerdict | undefined) ?? null,
        depth,
        children: kids,
        prUrl,
        profileLabel: profile?.label ?? null,
      };
    };

    return [toTree(primary, 0)];
  }

  buildBoard(homeId: string): {
    homeId: string;
    generatedAtMs: number;
    lanes: {
      title: string;
      nodes: {
        id: string;
        label: string;
        kind: FleetNode["kind"];
        fsmState: FsmState;
        liveness: LivenessVerdict | null;
        role: FleetNode["role"];
        threadId: string;
      }[];
    }[];
  } {
    this.assertHome(homeId);
    const tree = this.buildTree(homeId);
    const flat: {
      id: string;
      label: string;
      kind: FleetNode["kind"];
      fsmState: FsmState;
      liveness: LivenessVerdict | null;
      role: FleetNode["role"];
      threadId: string;
    }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        flat.push({
          id: node.id,
          label: node.label,
          kind: node.kind,
          fsmState: node.fsmState,
          liveness: node.liveness,
          role: node.role,
          threadId: node.threadId,
        });
        walk(node.children);
      }
    };
    walk(tree);
    const lanes = [
      {
        title: "Working",
        match: (node: (typeof flat)[number]) => node.fsmState === "working",
      },
      {
        title: "Blocked",
        match: (node: (typeof flat)[number]) => node.fsmState === "blocked",
      },
      {
        title: "Idle",
        match: (node: (typeof flat)[number]) =>
          node.fsmState === "idle" || node.fsmState === "starting",
      },
      {
        title: "Done",
        match: (node: (typeof flat)[number]) => node.fsmState === "done",
      },
      {
        title: "Failed|Unknown",
        match: (node: (typeof flat)[number]) =>
          node.fsmState === "error" ||
          node.fsmState === "unknown" ||
          node.fsmState === "stopped",
      },
    ];
    return {
      homeId,
      generatedAtMs: Date.now(),
      lanes: lanes.map(({ title, match }) => ({
        title,
        nodes: flat.filter(match),
      })),
    };
  }

  markThread(
    homeId: string,
    threadId: string,
    state: FsmState,
    detail?: Record<string, unknown>,
  ): void {
    this.assertHome(homeId);
    const node = this.store.getNodeByThread(threadId);
    if (node) this.assertNodeHome(node, homeId);
    this.store.appendLedger({
      homeId,
      threadId,
      verb: verbForMark(state),
      fsmState: state,
      detail,
    });
    this.publish();
  }

  async resolveProjectId(projectId?: string | null): Promise<string> {
    if (projectId) return projectId;
    const projects = await this.bb.sdk.projects.list({ includePersonal: true });
    const standard = projects.find((project) => project.kind === "standard");
    if (standard) return standard.id;
    throw new Error(
      "No standard BB project available. Create a mate home first so Fleet can register one.",
    );
  }

  private fleetProjectName(homeId: string, label: string): string {
    return `Firstmate: ${label} (${homeId})`;
  }

  async ensureHomeProject(input: {
    homeId: string;
    label: string;
    checkoutPath: string;
  }): Promise<string> {
    const host = await this.resolveHost();
    const projects = await this.bb.sdk.projects.list({ includePersonal: true });
    const targetName = this.fleetProjectName(input.homeId, input.label);
    const byPath = projects.find(
      (project) =>
        project.kind === "standard" &&
        project.sources.some(
          (source) =>
            source.type === "local_path" && source.path === input.checkoutPath,
        ),
    );
    if (byPath) return byPath.id;

    const byName = projects.find(
      (project) => project.kind === "standard" && project.name === targetName,
    );
    if (byName) return byName.id;

    const created = await this.bb.sdk.projects.create({
      name: targetName,
      source: {
        type: "local_path",
        hostId: host.id,
        path: input.checkoutPath,
      },
    });
    return created.id;
  }

  normalizeHomeId(raw: string): string {
    const homeId = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!homeId) {
      throw new Error("Home id must contain letters or digits.");
    }
    return homeId;
  }

  async listThreadCandidates(limit = 40): Promise<
    { id: string; title: string; projectId: string }[]
  > {
    const threads = await this.bb.sdk.threads.list({
      limit,
      archived: false,
    });
    return threads.map((thread) => ({
      id: thread.id,
      title: thread.title ?? thread.titleFallback ?? thread.id,
      projectId: thread.projectId,
    }));
  }

  private async resolveHost() {
    const hosts = await this.bb.sdk.hosts.list();
    const host = hosts[0];
    if (!host) {
      throw new Error("No BB host available.");
    }
    return host;
  }

  private async hostEnvironment(
    workspace:
      | { type: "unmanaged"; path: string }
      | {
          type: "managed-worktree";
          baseBranch: { kind: "default" } | { kind: "named"; name: string };
        },
  ) {
    const host = await this.resolveHost();
    return {
      type: "host" as const,
      hostId: host.id,
      workspace,
    };
  }

  private async resolveCrewSpawnEnvironment(
    node: FleetNode,
    home: { checkoutPath: string; mateThreadId: string },
  ) {
    if (node.envId) {
      return { type: "reuse" as const, environmentId: node.envId };
    }
    const stateRoot = await resolveMateStateRoot(this.bb, home);
    const metaPath = path.join(stateRoot, "state", `${node.label}.meta`);
    try {
      const meta = await fs.readFile(metaPath, "utf8");
      const worktreeMatch = meta.match(/^worktree=(.+)$/m);
      const worktreePath = worktreeMatch?.[1]?.trim();
      if (worktreePath) {
        return await this.hostEnvironment({
          type: "unmanaged",
          path: worktreePath,
        });
      }
    } catch {
      // fall through to fresh managed worktree
    }
    return await this.hostEnvironment({
      type: "managed-worktree",
      baseBranch: { kind: "default" },
    });
  }

  private async updateTaskMetaThreadId(
    checkoutPath: string,
    taskId: string,
    threadId: string,
    envId?: string | null,
  ): Promise<void> {
    const metaPath = path.join(checkoutPath, "state", `${taskId}.meta`);
    try {
      let meta = await fs.readFile(metaPath, "utf8");
      if (!/^backend=.*$/m.test(meta)) {
        meta += `\nbackend=bb\n`;
      } else {
        meta = meta.replace(/^backend=.*$/m, "backend=bb");
      }
      if (/^bb_thread_id=.*$/m.test(meta)) {
        meta = meta.replace(/^bb_thread_id=.*$/m, `bb_thread_id=${threadId}`);
      } else {
        meta += `\nbb_thread_id=${threadId}\n`;
      }
      const windowTarget = `@thread:${threadId}`;
      if (/^window=.*$/m.test(meta)) {
        meta = meta.replace(/^window=.*$/m, `window=${windowTarget}`);
      } else {
        meta += `\nwindow=${windowTarget}\n`;
      }
      if (envId) {
        if (/^bb_env_id=.*$/m.test(meta)) {
          meta = meta.replace(/^bb_env_id=.*$/m, `bb_env_id=${envId}`);
        } else {
          meta += `\nbb_env_id=${envId}\n`;
        }
      }
      await fs.writeFile(metaPath, meta, "utf8");
    } catch {
      // task meta may not exist yet
    }
  }

  async updateTaskMetaThreadIdForHome(
    homeId: string,
    taskId: string,
    threadId: string,
    envId?: string | null,
  ): Promise<void> {
    const home = this.store.getHome(homeId);
    if (!home) return;
    for (const checkoutPath of await resolveMateCheckoutPaths(this.bb, home)) {
      await this.updateTaskMetaThreadId(checkoutPath, taskId, threadId, envId);
    }
  }

  private async markTaskMetaFleetDetached(
    checkoutPath: string,
    taskId: string,
  ): Promise<void> {
    const metaPath = path.join(checkoutPath, "state", `${taskId}.meta`);
    try {
      const meta = await fs.readFile(metaPath, "utf8");
      await fs.writeFile(metaPath, appendMetaFleetDetached(meta), "utf8");
    } catch {
      // no meta for this task
    }
  }

  async markTaskMetaFleetDetachedForHome(
    homeId: string,
    taskId: string,
  ): Promise<void> {
    for (const checkoutPath of await this.mateCheckoutPaths(homeId)) {
      await this.markTaskMetaFleetDetached(checkoutPath, taskId);
    }
  }

  private async isBbThreadOpen(threadId: string): Promise<boolean> {
    if (isLegacyFleetThreadId(threadId)) return false;
    try {
      const thread = await this.bb.sdk.threads.get({ threadId });
      return !isBbThreadArchived(thread);
    } catch {
      return false;
    }
  }

  async syncCrewsFromStateMeta(
    homeId: string,
    checkoutPaths: string[],
  ): Promise<number> {
    const home = this.store.getHome(homeId);
    if (!home) return 0;

    const seenTasks = new Set<string>();
    let synced = 0;

    for (const checkoutPath of checkoutPaths) {
      const stateDir = path.join(checkoutPath, "state");
      let entries: string[];
      try {
        entries = await fs.readdir(stateDir);
      } catch {
        continue;
      }

      for (const name of entries) {
        if (!name.endsWith(".meta")) continue;
        const taskId = name.slice(0, -".meta".length);
        if (seenTasks.has(taskId)) continue;
        seenTasks.add(taskId);

        if (this.store.listNodes(homeId).some((node) => node.label === taskId)) {
          continue;
        }

        let meta = "";
        try {
          meta = await fs.readFile(path.join(stateDir, name), "utf8");
        } catch {
          continue;
        }

        if (isMetaFleetDetached(meta)) {
          continue;
        }

        const kind = metaField(meta, "kind");
        if (kind !== "ship" && kind !== "scout") continue;

        const role = kind as "ship" | "scout";
        const bbThreadId = metaField(meta, "bb_thread_id");
        const windowThread = metaField(meta, "window")?.match(/^@thread:(.+)$/)?.[1];
        const threadId = bbThreadId || windowThread;

        if (threadId && !isLegacyFleetThreadId(threadId)) {
          if (!(await this.isBbThreadOpen(threadId))) {
            continue;
          }
        }

        let statusPrefix: string | null = null;
        let statusFsm: FsmState | null = null;
        try {
          const statusRaw = await fs.readFile(
            path.join(stateDir, `${taskId}.status`),
            "utf8",
          );
          const tail = statusRaw
            .split("\n")
            .filter((line) => line.trim())
            .at(-1);
          const parsed = tail ? parseStatusLine(tail) : null;
          if (parsed) {
            statusPrefix = parsed.prefix;
            statusFsm = fsmFromStatusPrefix(parsed.prefix);
          }
        } catch {
          // no status file
        }

        if (threadId && !isLegacyFleetThreadId(threadId)) {
          this.store.insertNode({
            homeId,
            kind: "crew",
            parentId: home.primaryMateId,
            threadId,
            label: taskId,
            role,
            envId: metaField(meta, "bb_env_id"),
            deliveryMode:
              (metaField(meta, "mode") as FleetNode["deliveryMode"]) ??
              "no-mistakes",
            yolo: metaField(meta, "yolo") === "on",
            dispatchProfileId: null,
          });
          if (statusPrefix && statusFsm) {
            this.store.appendLedger({
              homeId,
              threadId,
              verb: ledgerVerbFromStatus(statusPrefix),
              fsmState: statusFsm,
              detail: { taskId, source: "meta-sync" },
            });
          }
          if (statusFsm === "done") {
            this.store.setLiveness(threadId, homeId, "dead", {
              reason: "historical crew",
            });
          }
          synced += 1;
          continue;
        }

        const legacyId = legacyThreadId(homeId, taskId);
        if (this.store.getNodeByThread(legacyId)) continue;

        this.store.insertNode({
          homeId,
          kind: "crew",
          parentId: home.primaryMateId,
          threadId: legacyId,
          label: taskId,
          role,
          envId: null,
          deliveryMode:
            (metaField(meta, "mode") as FleetNode["deliveryMode"]) ??
            "no-mistakes",
          yolo: metaField(meta, "yolo") === "on",
          dispatchProfileId: null,
        });
        this.store.appendLedger({
          homeId,
          threadId: legacyId,
          verb: statusPrefix
            ? ledgerVerbFromStatus(statusPrefix)
            : "crew.done",
          fsmState: statusFsm ?? "done",
          detail: { taskId, source: "legacy-meta-sync" },
        });
        this.store.setLiveness(legacyId, homeId, "dead", {
          reason: "legacy crew without BB thread",
        });
        synced += 1;
      }
    }

    if (synced > 0) this.publish();
    return synced;
  }

  async pickCheckoutFolder(clientHostId?: string): Promise<{
    path: string | null;
    useDirectoryBrowser: boolean;
  }> {
    const host = await this.resolveHost();
    const resolvedClientHostId = clientHostId ?? host.id;
    try {
      const result = await this.bb.sdk.hosts.pickFolder({
        hostId: host.id,
        clientHostId: resolvedClientHostId,
      });
      return { path: result.path, useDirectoryBrowser: false };
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : String(cause);
      if (
        message.includes("macOS") ||
        message.includes("502") ||
        message.toLowerCase().includes("folder picker")
      ) {
        return { path: null, useDirectoryBrowser: true };
      }
      throw cause;
    }
  }

  async browseHostDirectory(path?: string): Promise<{
    directory: string;
    parent: string | null;
    entries: { kind: "file" | "directory"; name: string; path: string }[];
  }> {
    const host = await this.resolveHost();
    return await this.bb.sdk.hosts.directory({
      hostId: host.id,
      path: path?.trim() || undefined,
    });
  }

  async createHome(input: {
    homeId: string;
    label: string;
    parentDir?: string | null;
    checkoutPath?: string | null;
    mateThreadId: string;
    defaultProfileId?: string | null;
    skipClone?: boolean;
  }) {
    const homeId = this.normalizeHomeId(input.homeId);
    if (this.store.homeExists(homeId)) {
      throw new Error(`Mate home "${homeId}" already exists.`);
    }
    const label = input.label.trim();
    if (!label) throw new Error("Label is required.");
    if (!input.mateThreadId.trim()) {
      throw new Error("Mate thread is required.");
    }
    let checkoutPath = input.checkoutPath?.trim() ?? "";
    if (!input.skipClone) {
      const prepared = await this.prepareFirstmateCheckout({
        homeId,
        parentDir: input.parentDir,
        checkoutPath: input.checkoutPath,
      });
      checkoutPath = prepared.checkoutPath;
    } else if (!checkoutPath) {
      checkoutPath = this.resolveCheckoutPath({
        homeId,
        parentDir: input.parentDir,
        checkoutPath: input.checkoutPath,
      });
      if (!checkoutPath) {
        throw new Error("Checkout path is required.");
      }
    }
    return this.registerHome({
      ...input,
      homeId,
      label,
      checkoutPath,
      mateThreadId: input.mateThreadId.trim(),
    });
  }

  async createHomeWithMateThread(input: {
    homeId: string;
    label: string;
    parentDir?: string | null;
    checkoutPath?: string | null;
    projectId?: string | null;
    prompt?: string;
  }) {
    const homeId = this.normalizeHomeId(input.homeId);
    if (this.store.homeExists(homeId)) {
      throw new Error(`Mate home "${homeId}" already exists.`);
    }
    const label = input.label.trim();
    if (!label) {
      throw new Error("Label is required.");
    }
    const { checkoutPath } = await this.prepareFirstmateCheckout({
      homeId,
      parentDir: input.parentDir,
      checkoutPath: input.checkoutPath,
    });
    const projectId =
      input.projectId ??
      (await this.ensureHomeProject({ homeId, label, checkoutPath }));
    const mateExecution = await this.readMateDefaults();
    const thread = await this.bb.sdk.threads.spawn({
      projectId,
      environment: { type: "project-default" },
      providerId: mateExecution.providerId,
      model: mateExecution.model,
      prompt:
        input.prompt?.trim() ||
        matePromptWithBbIntegration({ label, homeId }),
      title: `${label} mate`,
      pluginMetadata: { fleetHomeId: homeId, fleetRole: "primary" },
    });
    const home = await this.createHome({
      homeId,
      label,
      checkoutPath,
      mateThreadId: thread.id,
      skipClone: true,
    });
    return home;
  }

  updateHome(
    homeId: string,
    patch: {
      label?: string;
      checkoutPath?: string;
      mateThreadId?: string;
      defaultProfileId?: string | null;
    },
  ) {
    this.assertHome(homeId);
    const updated = this.store.updateHome(homeId, {
      label: patch.label?.trim(),
      checkoutPath: patch.checkoutPath?.trim(),
      mateThreadId: patch.mateThreadId?.trim(),
      defaultProfileId: patch.defaultProfileId,
    });
    if (!updated) throw new Error(`Home "${homeId}" not found.`);
    this.publish();
    return updated;
  }

  deleteHome(homeId: string): void {
    this.assertHome(homeId);
    if (!this.store.deleteHome(homeId)) {
      throw new Error(`Home "${homeId}" not found.`);
    }
    this.publish();
  }

  async resolveOpenChildBlockers(homeId: string): Promise<OpenChildBlocker[]> {
    this.assertHome(homeId);
    const nodes = this.store.listNodes(homeId).filter((n) => n.kind !== "primary");
    const archivedByThreadId = new Map<string, boolean>();
    for (const node of nodes) {
      if (archivedByThreadId.has(node.threadId)) continue;
      if (isLegacyFleetThreadId(node.threadId)) {
        archivedByThreadId.set(node.threadId, true);
        continue;
      }
      try {
        const thread = await this.bb.sdk.threads.get({
          threadId: node.threadId,
        });
        archivedByThreadId.set(node.threadId, isBbThreadArchived(thread));
      } catch {
        archivedByThreadId.set(node.threadId, false);
      }
    }
    return openChildBlockersFromNodes(
      this.store.listNodes(homeId),
      archivedByThreadId,
    );
  }

  async resetMateThreadPreflight(homeId: string): Promise<{
    allowed: boolean;
    openChildren: OpenChildBlocker[];
    mateThreadId: string;
    mateLabel: string;
  }> {
    this.assertHome(homeId);
    const home = this.store.getHome(homeId)!;
    const openChildren = await this.resolveOpenChildBlockers(homeId);
    return {
      allowed: openChildren.length === 0,
      openChildren,
      mateThreadId: home.mateThreadId,
      mateLabel: home.label,
    };
  }

  async resetMateThread(homeId: string): Promise<{
    home: Home;
    previousMateThreadId: string;
    mateThreadId: string;
  }> {
    this.assertHome(homeId);
    const home = this.store.getHome(homeId)!;
    const openChildren = await this.resolveOpenChildBlockers(homeId);
    if (openChildren.length > 0) {
      throw new Error(formatOpenChildBlockMessage(openChildren));
    }

    const previousMateThreadId = home.mateThreadId;
    let oldMateProjectId: string;
    try {
      const oldMate = await this.bb.sdk.threads.get({
        threadId: previousMateThreadId,
      });
      oldMateProjectId = oldMate.projectId;
    } catch {
      oldMateProjectId = await this.ensureHomeProject({
        homeId,
        label: home.label,
        checkoutPath: home.checkoutPath,
      });
    }

    const mateExecution = await this.readMateDefaults();
    const thread = await this.bb.sdk.threads.spawn({
      projectId: oldMateProjectId,
      environment: { type: "project-default" },
      providerId: mateExecution.providerId,
      model: mateExecution.model,
      prompt: matePromptWithBbIntegration({ label: home.label, homeId }),
      title: `${home.label} mate`,
      pluginMetadata: { fleetHomeId: homeId, fleetRole: "primary" },
    });

    try {
      try {
        await this.bb.sdk.threads.stop({ threadId: previousMateThreadId });
      } catch {
        // may already be stopped
      }
      await this.archiveBbThread(previousMateThreadId);
    } catch (error) {
      await this.discardBbMateThread(thread.id);
      throw error;
    }

    try {
      await this.ensureBbIntegration({
        homeId,
        mateThreadId: thread.id,
        checkoutPath: home.checkoutPath,
      });

      const updated = this.updateHome(homeId, { mateThreadId: thread.id });
      if (!updated) {
        throw new Error(`Home "${homeId}" not found after mate reset.`);
      }
    } catch (error) {
      await this.discardBbMateThread(thread.id);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Mate reset failed after archiving previous mate (${previousMateThreadId}); home still references that archived thread. Spawned replacement was discarded. ${detail}`,
      );
    }

    const updated = this.store.getHome(homeId)!;

    this.store.appendLedger({
      homeId,
      threadId: previousMateThreadId,
      verb: "control.exit",
      fsmState: "stopped",
      detail: { reason: "mate.reset", replacedBy: thread.id },
    });

    this.publish();
    return {
      home: updated,
      previousMateThreadId,
      mateThreadId: thread.id,
    };
  }

  async registerHome(input: {
    homeId: string;
    label: string;
    checkoutPath: string;
    mateThreadId: string;
    primaryMateId?: string;
    defaultProfileId?: string | null;
  }) {
    const primaryMateId = input.primaryMateId ?? `${input.homeId}-primary`;
    const home = this.store.upsertHome({
      homeId: input.homeId,
      label: input.label,
      checkoutPath: input.checkoutPath,
      primaryMateId,
      mateThreadId: input.mateThreadId,
      defaultProfileId: input.defaultProfileId ?? null,
    });
    const existing = this.store.getNode(primaryMateId);
    if (!existing) {
      this.store.insertNode({
        id: primaryMateId,
        homeId: input.homeId,
        kind: "primary",
        parentId: null,
        threadId: input.mateThreadId,
        label: input.label,
        role: null,
        envId: null,
        deliveryMode: "no-mistakes",
        yolo: false,
        dispatchProfileId: input.defaultProfileId ?? null,
      });
    }
    if (!this.store.getSelectedHomeId()) {
      this.store.setSelectedHomeId(input.homeId);
    }
    await this.ensureBbIntegration({
      homeId: input.homeId,
      mateThreadId: input.mateThreadId,
      checkoutPath: input.checkoutPath,
    });
    this.publish();
    return home;
  }

  attachCrew(input: {
    homeId: string;
    threadId: string;
    label: string;
    role: "ship" | "scout";
    parentId?: string | null;
    envId?: string | null;
    deliveryMode?: "no-mistakes" | "direct-PR" | "local-only";
    yolo?: boolean;
    dispatchProfileId?: string | null;
  }): FleetNode {
    this.assertHome(input.homeId);
    const home = this.store.getHome(input.homeId);
    if (!home) throw new Error(`Home ${input.homeId} not found.`);
    const parentId = input.parentId ?? home.primaryMateId;
    const parent = this.store.getNode(parentId);
    if (!parent || parent.homeId !== input.homeId) {
      throw new Error(`Invalid parent for crew in home ${input.homeId}.`);
    }
    const node = this.store.insertNode({
      homeId: input.homeId,
      kind: "crew",
      parentId,
      threadId: input.threadId,
      label: input.label,
      role: input.role,
      envId: input.envId ?? null,
      deliveryMode: input.deliveryMode ?? "no-mistakes",
      yolo: input.yolo ?? false,
      dispatchProfileId: input.dispatchProfileId ?? null,
    });
    this.markThread(input.homeId, input.threadId, "starting");
    this.publish();
    return node;
  }

  createSecondmate(input: {
    homeId: string;
    threadId: string;
    label: string;
    envId?: string | null;
    dispatchProfileId?: string | null;
  }): FleetNode {
    this.assertHome(input.homeId);
    const home = this.store.getHome(input.homeId);
    if (!home) throw new Error(`Home ${input.homeId} not found.`);
    const node = this.store.insertNode({
      homeId: input.homeId,
      kind: "secondmate",
      parentId: home.primaryMateId,
      threadId: input.threadId,
      label: input.label,
      role: null,
      envId: input.envId ?? null,
      deliveryMode: "no-mistakes",
      yolo: false,
      dispatchProfileId: input.dispatchProfileId ?? null,
    });
    this.markThread(input.homeId, input.threadId, "starting");
    this.publish();
    return node;
  }

  openHold(input: {
    homeId: string;
    mateId: string;
    threadId: string;
    title: string;
    body: string;
    urgency?: "low" | "normal" | "high";
    holdKind?: HoldKind;
  }) {
    this.assertHome(input.homeId);
    const holdKind = normalizeHoldKind(input.holdKind);
    const urgency =
      input.urgency ?? captainHoldDefaultUrgency(holdKind);
    const hold = this.store.createHold({ ...input, holdKind, urgency });
    this.store.upsertInboxFromHold(hold);
    this.markThread(input.homeId, input.threadId, "blocked", {
      holdId: hold.id,
      holdKind,
    });
    const home = this.store.getHome(input.homeId);
    if (home) {
      const notifyThreadId = routeHoldNotifyThreadId({
        holdKind,
        mateThreadId: home.mateThreadId,
        cosThreadId: this.cosThreadId,
      });
      const wakeReason =
        holdKind === "authority"
          ? authorityEscalationWakeReason(hold.id)
          : `hold:${hold.id}`;
      this.store.enqueueWake({
        homeId: input.homeId,
        threadId: notifyThreadId,
        targetMateId: home.primaryMateId,
        reason: wakeReason,
        priority: urgency === "high" ? 10 : 5,
        dedupeKey: `hold:${hold.id}`,
      });
    }
    this.publish();
    return hold;
  }

  resolveHold(homeId: string, holdId: string): void {
    this.assertHome(homeId);
    const holdsBefore = this.store.listHolds(homeId, "open");
    const hold = holdsBefore.find((candidate) => candidate.id === holdId);
    this.store.resolveHold(holdId);
    for (const wake of this.store.listWakes(homeId, false)) {
      if (wake.dedupeKey === `hold:${holdId}`) {
        this.store.ackWake(wake.id);
      }
    }
    if (hold) {
      this.store.upsertInboxFromHold({
        ...hold,
        state: "resolved",
        resolvedAtMs: Date.now(),
      });
      if (!this.hasOpenHolds(homeId, hold.threadId)) {
        this.markThread(homeId, hold.threadId, "idle", {
          holdResolved: holdId,
        });
      }
    }
    this.publish();
  }

  hasOpenHolds(homeId: string, threadId?: string): boolean {
    this.assertHome(homeId);
    return this.store.countOpenHolds(homeId, threadId) > 0;
  }

  ackWake(homeId: string, wakeId: string): void {
    this.assertHome(homeId);
    const wakes = this.store.listWakes(homeId, false);
    const ids = wakeIdsToAckThrough(wakes, wakeId);
    for (const id of ids) {
      this.store.ackWake(id);
    }
    if (ids.length > 0) this.publish();
  }

  fleetSnapshot(homeId: string): {
    digest: Digest;
    bearings: Bearings;
    generatedAtMs: number;
  } {
    return {
      digest: this.buildDigest(homeId),
      bearings: this.buildBearings(homeId),
      generatedAtMs: Date.now(),
    };
  }

  fleetNavCounts(homeId: string): {
    inbox: number;
    wakes: number;
    dead: number;
  } {
    this.assertHome(homeId);
    return {
      inbox: this.store.countOpenInbox(homeId),
      wakes: this.store.countUnackedWakes(homeId),
      dead: this.store.countDeadNodes(homeId),
    };
  }

  buildBearings(homeId: string): Bearings {
    const digest = this.buildDigest(homeId);
    const home = this.store.getHome(homeId)!;
    const wakes = this.store.listWakes(homeId, false);
    const holds = this.store.listHolds(homeId, "open");
    const prLinks: { label: string; url: string; threadId: string }[] = [];
    for (const node of this.store.listNodes(homeId)) {
      const entries = this.store.tailLedger(node.threadId, 80).reverse();
      const pr = entries.find(
        (entry) =>
          entry.verb === "pr.opened" &&
          typeof entry.detail?.url === "string",
      );
      if (pr && typeof pr.detail?.url === "string") {
        prLinks.push({
          label: node.label,
          url: pr.detail.url,
          threadId: node.threadId,
        });
      }
    }
    const lines = [
      digest.summary,
      holds.length
        ? `Open decisions (${holds.length}): ${holds.map((h) => h.title).join("; ")}`
        : "Open decisions: none",
      wakes.length
        ? `Unacked wakes (${wakes.length}): ${wakes.map((w) => w.reason).join("; ")}`
        : "Unacked wakes: none",
      prLinks.length
        ? `PRs: ${prLinks.map((p) => `${p.label} → ${p.url}`).join(" · ")}`
        : "PRs: none tracked",
    ];
    return {
      homeId,
      label: home.label,
      generatedAtMs: Date.now(),
      summary: lines.join("\n"),
      lines,
      digest,
      openHolds: holds.length,
      unackedWakes: wakes.length,
      prLinks,
    };
  }

  buildDigest(homeId: string): Digest {
    this.assertHome(homeId);
    const home = this.store.getHome(homeId)!;
    const tree = this.buildTree(homeId);
    const flat: Digest["nodes"] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        flat.push({
          id: node.id,
          label: node.label,
          kind: node.kind,
          fsmState: node.fsmState,
          liveness: node.liveness,
          role: node.role,
        });
        walk(node.children);
      }
    };
    walk(tree);
    const openInbox = this.store.countOpenInbox(homeId);
    const unackedWakes = this.store.listWakes(homeId, false).length;
    const openHolds = this.store.listHolds(homeId, "open").length;
    const working = flat.filter((node) => node.fsmState === "working").length;
    const blocked = flat.filter((node) => node.fsmState === "blocked").length;
    const primary = this.store.listNodes(homeId).find((n) => n.kind === "primary");
    const mateLive = primary
      ? this.store.getLiveness(primary.threadId)
      : null;
    const mateDown =
      mateLive?.verdict === "dead" || mateLive?.verdict === "missing";
    const summaryParts = [
      `${home.label} fleet digest`,
      `${working} working, ${blocked} blocked`,
      `${openInbox} inbox, ${openHolds} holds, ${unackedWakes} wakes`,
    ];
    if (mateDown) summaryParts.unshift("MATE DOWN");
    const divergences = this.store
      .listNodes(homeId)
      .flatMap((node) => this.store.tailLedger(node.threadId, 30))
      .filter((entry) => entry.verb === DIVERGENCE_LEDGER_VERB).length;
    if (divergences > 0) {
      summaryParts.push(`${divergences} divergence(s)`);
    }
    const summary = summaryParts.join(" · ");
    return {
      homeId,
      label: home.label,
      generatedAtMs: Date.now(),
      summary,
      nodes: flat,
      openInbox,
      unackedWakes,
      openHolds,
    };
  }

  async probeThread(threadId: string): Promise<LivenessVerdict> {
    if (isLegacyFleetThreadId(threadId)) {
      const node = this.store.getNodeByThread(threadId);
      if (node) {
        this.store.setLiveness(threadId, node.homeId, "dead", {
          reason: "legacy crew",
        });
        return "dead";
      }
      return "missing";
    }
    const node = this.store.getNodeByThread(threadId);
    if (!node) return "missing";
    try {
      const thread = await this.bb.sdk.threads.get({ threadId });
      if (!thread) {
        this.store.setLiveness(threadId, node.homeId, "missing", {
          reason: "thread not found",
        });
        return "missing";
      }
      const status = thread.status;
      const runtimeStatus = thread.runtime?.displayStatus;
      const prev = this.store.getLiveness(threadId);
      const prevDetail = prev?.detail;
      if (prevDetail?.controlStop === true) {
        this.store.setLiveness(threadId, node.homeId, "dead", {
          ...prevDetail,
          status,
          runtimeStatus,
          environmentId: thread.environmentId,
        });
        return "dead";
      }
      let verdict: LivenessVerdict = "alive";
      if (status === "error" || status === "stopping") {
        verdict = "dead";
      } else if (
        node.kind !== "primary" &&
        status === "idle" &&
        !thread.environmentId &&
        runtimeStatus === "idle"
      ) {
        // BB thread stop releases the runtime but leaves the thread id idle.
        verdict = "dead";
      }
      this.store.setLiveness(threadId, node.homeId, verdict, {
        status,
        runtimeStatus,
        environmentId: thread.environmentId,
      });
      const semanticWorking =
        typeof this.store.tailLedger === "function" &&
        latestSemanticWorkingAtMs(this.store, threadId) !== null;
      const desync = detectLivenessDesync({
        threadId,
        liveness: verdict,
        threadStatus: status,
        semanticWorking,
      });
      const desyncCursorKey = livenessDesyncCursorKvKey(threadId);
      const desyncEpisodeOpen =
        (await this.bb.storage.kv.get<boolean>(desyncCursorKey)) === true;
      if (desync) {
        if (!desyncEpisodeOpen) {
          try {
            const reconciled = reconcileDesyncFsm(this.fsmForThread(threadId));
            this.store.appendLedger({
              homeId: node.homeId,
              threadId,
              verb: DESYNC_LEDGER_VERB,
              fsmState: reconciled,
              detail: { status, semanticWorking: true },
            });
            this.markThread(node.homeId, threadId, reconciled, {
              desyncReconciled: true,
            });
            await this.bb.storage.kv.set(desyncCursorKey, true);
          } catch {
            // probe path must stay fail-soft on partial stores
          }
        }
      } else if (desyncEpisodeOpen) {
        await this.bb.storage.kv.set(desyncCursorKey, false);
      }
      return verdict;
    } catch (error) {
      const prev = this.store.getLiveness(threadId);
      const prevDetail = prev?.detail;
      const detail: Record<string, unknown> = { error: String(error) };
      if (prevDetail?.controlStop === true) {
        detail.controlStop = true;
        this.store.setLiveness(threadId, node.homeId, "dead", detail);
        return "dead";
      }
      this.store.setLiveness(threadId, node.homeId, "ambiguous", detail);
      return "ambiguous";
    }
  }

  private async threadSteerProbe(threadId: string): Promise<{
    pendingInteraction: boolean;
    threadStatus: string;
  }> {
    const interactions = await this.bb.sdk.threads.interactions.list({
      threadId,
    });
    const pendingInteraction = interactions.some(
      (item) => item.status === "pending",
    );
    let threadStatus = "unknown";
    try {
      const thread = await this.bb.sdk.threads.get({ threadId });
      threadStatus = thread?.status ?? "unknown";
    } catch {
      threadStatus = "unknown";
    }
    return { pendingInteraction, threadStatus };
  }

  private async sendSteerText(
    threadId: string,
    text: string,
  ): Promise<"sent" | "unconfirmed"> {
    try {
      await this.bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
      return "sent";
    } catch {
      return "unconfirmed";
    }
  }

  async processSteerQueues(homeId: string): Promise<number> {
    this.assertHome(homeId);
    let sent = 0;
    for (const row of this.store.listPendingSteer(homeId)) {
      const probe = await this.threadSteerProbe(row.threadId);
      if (probe.pendingInteraction) continue;
      if (!isThreadReadyForSteer(probe)) continue;
      let attempts = row.attempts;
      let result: "sent" | "unconfirmed" = "unconfirmed";
      while (shouldRetryUnconfirmedSubmit(result, attempts)) {
        result = await this.sendSteerText(row.threadId, row.text);
        attempts = this.store.incrementSteerAttempt(row.id);
      }
      if (result !== "sent") {
        this.store.markSteerFailed(row.id);
        const node = this.store.getNodeByThread(row.threadId);
        const label = node?.label ?? row.threadId;
        if (typeof this.store.createInboxItem === "function") {
          this.store.createInboxItem({
            homeId,
            threadId: row.threadId,
            kind: "wake",
            urgency: "high",
            title: `Steer delivery failed: ${label}`,
            body: row.text,
          });
        }
        this.store.appendLedger({
          homeId,
          threadId: row.threadId,
          verb: "steer.failed",
          fsmState: this.fsmForThread(row.threadId),
          detail: { queued: true, attempts },
        });
        continue;
      }
      this.store.markSteerSent(row.id);
      const sentAtMs = Date.now();
      this.store.appendLedger({
        homeId,
        threadId: row.threadId,
        verb: "steer.sent",
        fsmState: "working",
        detail: { queued: true, sentAtMs },
      });
      await this.bb.storage.kv.set(`fleet.steerSent.${row.threadId}`, sentAtMs);
      sent += 1;
    }
    if (sent > 0) this.publish();
    return sent;
  }

  async steer(homeId: string, threadId: string, text: string): Promise<void> {
    this.assertHome(homeId);
    const node = this.store.getNodeByThread(threadId);
    if (node) this.assertNodeHome(node, homeId);
    const probe = await this.threadSteerProbe(threadId);
    if (probe.pendingInteraction) {
      throw new Error("Cannot steer while interaction is pending.");
    }
    const state = this.fsmForThread(threadId);
    if (state === "unknown") {
      throw new Error("Cannot steer thread in unknown state.");
    }
    const label = node?.label ?? threadId;
    if (typeof this.store.createInboxItem === "function") {
      this.store.createInboxItem({
        homeId,
        threadId,
        kind: "wake",
        urgency: "normal",
        title: steerInboxTitle(label),
        body: text,
      });
    }
    if (shouldQueueSteerWhileBusy(probe)) {
      this.store.enqueueSteer({ homeId, threadId, text });
      this.publish();
      return;
    }
    const readyDeadline = Date.now() + 30_000;
    while (
      !isThreadReadyForSteer(await this.threadSteerProbe(threadId)) &&
      Date.now() < readyDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    let attempts = 0;
    let result: "sent" | "unconfirmed" = "unconfirmed";
    while (shouldRetryUnconfirmedSubmit(result, attempts)) {
      result = await this.sendSteerText(threadId, text);
      attempts += 1;
    }
    if (result !== "sent") {
      this.store.enqueueSteer({ homeId, threadId, text });
      this.publish();
      return;
    }
    const sentAtMs = Date.now();
    this.store.appendLedger({
      homeId,
      threadId,
      verb: "steer.sent",
      fsmState: "working",
      detail: { sentAtMs },
    });
    await this.bb.storage.kv.set(`fleet.steerSent.${threadId}`, sentAtMs);
    this.publish();
  }

  async nudgeThread(homeId: string, threadId: string): Promise<void> {
    const node = this.store.getNodeByThread(threadId);
    const label = node?.label ?? threadId;
    await this.steer(homeId, threadId, doorbellNudgeText(label));
  }

  recordCaptainAttach(homeId: string, threadId: string): void {
    this.assertHome(homeId);
    this.store.appendLedger({
      homeId,
      threadId,
      verb: CAPTAIN_ATTACH_LEDGER_VERB,
      fsmState: this.fsmForThread(threadId),
      detail: { attachedAtMs: Date.now() },
    });
    this.publish();
  }

  async checkPostSteerStalls(homeId: string): Promise<void> {
    const stallSec = this.runtimeLimits.postSteerStallSec;
    const nowMs = Date.now();
    for (const node of this.store.listNodes(homeId)) {
      if (node.kind !== "crew") continue;
      const sentAt = await this.bb.storage.kv.get<number>(
        `fleet.steerSent.${node.threadId}`,
      );
      if (!sentAt) continue;
      const lastProgress = this.store
        .tailLedger(node.threadId, 20)
        .find((entry) => entry.verb === "crew.progress" || entry.verb === "crew.working");
      if (
        shouldFirePostSteerStallWatchdog({
          steerSentAtMs: sentAt,
          lastProgressAtMs: lastProgress?.createdAtMs ?? null,
          nowMs,
          stallSec,
        })
      ) {
        const home = this.store.getHome(homeId)!;
        this.store.enqueueWake({
          homeId,
          threadId: home.mateThreadId,
          targetMateId: home.primaryMateId,
          reason: `stall:post-steer:${node.threadId}`,
          priority: 5,
          dedupeKey: `stall:post-steer:${node.threadId}`,
        });
      }
    }
  }

  async interrupt(homeId: string, threadId: string): Promise<void> {
    this.assertHome(homeId);
    this.store.setLiveness(threadId, homeId, "dead", {
      reason: "control.interrupt",
      controlStop: true,
    });
    this.store.appendLedger({
      homeId,
      threadId,
      verb: "control.interrupt",
      fsmState: "stopped",
    });
    await this.bb.sdk.threads.stop({ threadId });
    this.publish();
  }

  async exitThread(homeId: string, threadId: string): Promise<void> {
    this.assertHome(homeId);
    this.store.setLiveness(threadId, homeId, "dead", {
      reason: "control.exit",
      controlStop: true,
    });
    this.store.appendLedger({
      homeId,
      threadId,
      verb: "control.exit",
      fsmState: "stopped",
    });
    await this.bb.sdk.threads.stop({ threadId });
    this.publish();
  }

  async relaunch(
    homeId: string,
    threadId: string,
    prompt?: string,
  ): Promise<FleetNode> {
    this.assertHome(homeId);
    const node = this.store.getNodeByThread(threadId);
    if (!node || node.homeId !== homeId) {
      throw new Error(`Unknown crew thread ${threadId} in home ${homeId}.`);
    }
    if (node.kind === "primary") {
      throw new Error("Cannot relaunch the primary mate thread from Fleet.");
    }
    if (this.hasOpenHolds(homeId, threadId)) {
      throw new Error("Cannot relaunch while open holds exist on this crew.");
    }
    const role = node.role ?? "ship";
    const text =
      prompt?.trim() ||
      `Continue Firstmate task "${node.label}" on the existing worktree.`;
    await this.bb.sdk.threads.stop({ threadId });
    const home = this.store.getHome(homeId)!;
    const mateThread = await this.bb.sdk.threads.get({
      threadId: home.mateThreadId,
    });
    const profile = node.dispatchProfileId
      ? this.store
          .listProfiles(homeId)
          .find((p) => p.id === node.dispatchProfileId)
      : undefined;
    const execution = await this.resolveCrewExecution(profile);
    const relaunchProjectId =
      (await this.readPersistedCrewProjectId(threadId)) ??
      mateThread.projectId;
    const thread = await this.bb.sdk.threads.spawn({
      projectId: relaunchProjectId,
      parentThreadId: mateThread.id,
      environment: await this.resolveCrewSpawnEnvironment(node, home),
      prompt: text,
      title: `${role}: ${node.label}`,
      providerId: execution.providerId,
      model: execution.model,
      pluginMetadata: {
        fleetHomeId: homeId,
        fleetRole: role,
        deliveryMode: node.deliveryMode,
        yolo: node.yolo,
        relaunchOf: threadId,
      },
    });
    await this.copyPersistedCrewProjectId(threadId, thread.id);
    await this.updateTaskMetaThreadIdForHome(
      homeId,
      node.label,
      thread.id,
      thread.environmentId ?? null,
    );
    const updated =
      this.store.updateNodeThread(node.id, thread.id, thread.environmentId ?? null) ??
      node;
    this.store.appendLedger({
      homeId,
      threadId: thread.id,
      verb: "control.relaunch",
      fsmState: "starting",
      detail: { previousThreadId: threadId },
    });
    this.markThread(homeId, thread.id, "starting");
    this.publish();
    return updated;
  }

  private holdIdsForThread(homeId: string, threadId: string): string[] {
    const open = this.store.listHolds(homeId, "open");
    const resolved = this.store.listHolds(homeId, "resolved");
    return [...open, ...resolved]
      .filter((hold) => hold.threadId === threadId)
      .map((hold) => hold.id);
  }

  private clearCrewThreadInboxAndWakes(
    homeId: string,
    crewThreadId: string,
    resolvedHoldIds: readonly string[],
  ): void {
    for (const item of this.store.listInbox(homeId)) {
      if (item.threadId === crewThreadId && item.state !== "resolved") {
        this.store.resolveInbox(item.id);
      }
    }
    for (const wake of this.store.listWakes(homeId, false)) {
      if (wakeTiedToCrewThread(wake, crewThreadId, resolvedHoldIds)) {
        this.store.ackWake(wake.id);
      }
    }
  }

  /** BB→Fleet close-out (P-SYNC-1): resolve holds, clear inbox/wakes, remove node. */
  async closeOutRegistryForArchivedThread(threadId: string): Promise<boolean> {
    const node = this.store.getNodeByThread(threadId);
    if (!node || node.kind === "primary") return false;
    const resolvedHoldIds: string[] = [];
    for (const hold of this.store
      .listHolds(node.homeId, "open")
      .filter((candidate) => candidate.threadId === threadId)) {
      resolvedHoldIds.push(hold.id);
      this.resolveHold(node.homeId, hold.id);
    }
    this.clearCrewThreadInboxAndWakes(node.homeId, threadId, resolvedHoldIds);
    this.store.appendLedger({
      homeId: node.homeId,
      threadId,
      verb: "thread.archived",
      fsmState: "stopped",
      detail: { source: "bb.thread.archived" },
    });
    await this.markTaskMetaFleetDetachedForHome(node.homeId, node.label);
    this.store.deleteNode(node.id);
    this.publish();
    return true;
  }

  private async discardBbMateThread(threadId: string): Promise<void> {
    try {
      await this.bb.sdk.threads.stop({ threadId });
    } catch {
      // may already be stopped
    }
    if (isLegacyFleetThreadId(threadId)) return;
    try {
      await this.bb.sdk.threads.archive({ threadId });
    } catch (error) {
      this.bb.log.warn(`fleet: discard BB thread ${threadId} failed: ${error}`);
    }
  }

  async archiveBbThread(threadId: string): Promise<void> {
    if (isLegacyFleetThreadId(threadId)) return;
    try {
      await this.bb.sdk.threads.archive({ threadId });
    } catch (error) {
      this.bb.log.warn(`fleet: archive BB thread ${threadId} failed: ${error}`);
      throw error;
    }
  }

  /** Fleet→BB close-out (P-SYNC-1): stop, archive (must succeed), clear inbox/wakes, delete node. */
  async detachCrew(homeId: string, threadId: string): Promise<void> {
    this.assertHome(homeId);
    const node = this.store.getNodeByThread(threadId);
    if (!node || node.homeId !== homeId) {
      throw new Error(`Unknown crew thread ${threadId} in home ${homeId}.`);
    }
    if (node.kind === "primary") {
      throw new Error("Cannot detach the primary mate thread.");
    }
    if (this.hasOpenHolds(homeId, threadId)) {
      throw new Error("Cannot detach while open holds exist on this crew.");
    }
    await this.markTaskMetaFleetDetachedForHome(homeId, node.label);
    try {
      await this.bb.sdk.threads.stop({ threadId });
    } catch {
      // thread may already be stopped
    }
    await this.archiveBbThread(threadId);
    this.clearCrewThreadInboxAndWakes(
      homeId,
      threadId,
      this.holdIdsForThread(homeId, threadId),
    );
    this.store.deleteNode(node.id);
    this.publish();
  }

  async sweepOrphans(homeId: string): Promise<{
    removed: { threadId: string; label: string }[];
    skipped: { threadId: string; label: string; reason: string }[];
  }> {
    this.assertHome(homeId);
    const checkoutPaths = await this.mateCheckoutPaths(homeId);
    const removed: { threadId: string; label: string }[] = [];
    const skipped: { threadId: string; label: string; reason: string }[] =
      [];

    for (const node of this.store.listNodes(homeId)) {
      if (node.kind === "primary") continue;
      if (isLegacyFleetThreadId(node.threadId)) continue;

      let threadMissing = false;
      let threadLookupFailed = false;
      let threadArchived = false;
      try {
        const thread = await this.bb.sdk.threads.get({
          threadId: node.threadId,
        });
        if (!thread) {
          threadMissing = true;
        } else {
          threadArchived = isBbThreadArchived(thread);
        }
      } catch {
        threadLookupFailed = true;
      }

      if (threadLookupFailed) {
        skipped.push({
          threadId: node.threadId,
          label: node.label,
          reason: "thread lookup failed",
        });
        continue;
      }

      let metaPresent = false;
      let metaRaw: string | null = null;
      for (const checkoutPath of checkoutPaths) {
        const metaPath = path.join(checkoutPath, "state", `${node.label}.meta`);
        if (await pathExists(metaPath)) {
          metaPresent = true;
          try {
            metaRaw = await fs.readFile(metaPath, "utf8");
          } catch {
            metaRaw = null;
          }
          break;
        }
      }

      if (
        metaPresent &&
        (!metaRaw || !isMetaFleetDetached(metaRaw)) &&
        !threadArchived
      ) {
        if (threadMissing) {
          skipped.push({
            threadId: node.threadId,
            label: node.label,
            reason: "meta-without-thread",
          });
        }
        continue;
      }

      if (threadArchived) {
        if (this.hasOpenHolds(homeId, node.threadId)) {
          skipped.push({
            threadId: node.threadId,
            label: node.label,
            reason: "open holds",
          });
          continue;
        }
        if (await this.closeOutRegistryForArchivedThread(node.threadId)) {
          removed.push({ threadId: node.threadId, label: node.label });
        }
        continue;
      }

      if (!threadMissing) {
        skipped.push({
          threadId: node.threadId,
          label: node.label,
          reason: "live-thread-without-meta",
        });
        continue;
      }

      if (this.hasOpenHolds(homeId, node.threadId)) {
        skipped.push({
          threadId: node.threadId,
          label: node.label,
          reason: "open holds",
        });
        continue;
      }

      this.store.deleteNode(node.id);
      removed.push({ threadId: node.threadId, label: node.label });
    }

    if (removed.length > 0) this.publish();
    return { removed, skipped };
  }

  async waitForDispatchSlot(homeId: string, maxWaitMs = 120_000): Promise<void> {
    if (typeof this.store.listNodes !== "function") {
      return;
    }
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const active = countActiveCrewSlots(
        this.store.listNodes(homeId),
        (threadId) => this.fsmForThread(threadId),
      );
      if (canDispatchCrew(active, this.runtimeLimits.maxConcurrency)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const active = countActiveCrewSlots(
      this.store.listNodes(homeId),
      (threadId) => this.fsmForThread(threadId),
    );
    throw new Error(
      dispatchWaitMessage(active, this.runtimeLimits.maxConcurrency),
    );
  }

  async spawnCrew(input: {
    homeId: string;
    label: string;
    role: "ship" | "scout";
    prompt: string;
    parentId?: string | null;
    projectId?: string | null;
    shipProjectId?: string | null;
    profileId?: string | null;
    deliveryMode?: "no-mistakes" | "direct-PR" | "local-only";
    yolo?: boolean;
  }): Promise<FleetNode> {
    this.assertHome(input.homeId);
    await this.waitForDispatchSlot(input.homeId);
    const home = this.store.getHome(input.homeId)!;
    const projectId = await this.resolveProjectId(input.projectId);
    const profile = input.profileId
      ? this.store.listProfiles(input.homeId).find((p) => p.id === input.profileId)
      : home.defaultProfileId
        ? this.store.listProfiles(input.homeId).find(
            (p) => p.id === home.defaultProfileId,
          )
        : undefined;
    const mateThread = await this.bb.sdk.threads.get({
      threadId: home.mateThreadId,
    });
    const shipProjectId = input.shipProjectId?.trim() ?? "";
    const crewProjectId =
      shipProjectId || mateThread.projectId || (await this.resolveProjectId(input.projectId));
    const execution = await this.resolveCrewExecution(profile);
    const thread = await this.bb.sdk.threads.spawn({
      projectId: crewProjectId,
      parentThreadId: mateThread.id,
      environment: await this.hostEnvironment({
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      }),
      prompt: input.prompt,
      title: `${input.role}: ${input.label}`,
      providerId: execution.providerId,
      model: execution.model,
      pluginMetadata: {
        fleetHomeId: input.homeId,
        fleetRole: input.role,
        deliveryMode: input.deliveryMode ?? "no-mistakes",
        yolo: input.yolo ?? false,
      },
    });
    if (shipProjectId) {
      await this.persistCrewProjectId(thread.id, crewProjectId);
    }
    try {
      await this.bb.sdk.threads.send({
        threadId: thread.id,
        mode: "auto",
        input: [
          {
            type: "text",
            text: `Launch brief (${input.role} · ${input.label}):\n\n${input.prompt}`,
            mentions: [],
          },
        ],
      });
    } catch (error) {
      let archiveFailed: unknown;
      try {
        await this.archiveBbThread(thread.id);
      } catch (archiveError) {
        archiveFailed = archiveError;
        this.bb.log.warn(
          `fleet: rollback archive after send failure ${thread.id}: ${archiveError}`,
        );
      } finally {
        try {
          await this.bb.sdk.threads.stop({ threadId: thread.id });
        } catch {
          // thread may already be stopped
        }
      }
      if (archiveFailed !== undefined) {
        const detail =
          archiveFailed instanceof Error
            ? archiveFailed.message
            : String(archiveFailed);
        throw new Error(
          `Launch brief send failed and rollback archive failed for ${thread.id}: ${detail}`,
          { cause: error },
        );
      }
      throw error;
    }
    return this.attachCrew({
      homeId: input.homeId,
      threadId: thread.id,
      label: input.label,
      role: input.role,
      parentId: input.parentId ?? home.primaryMateId,
      deliveryMode: input.deliveryMode,
      yolo: input.yolo,
      dispatchProfileId: profile?.id ?? null,
      envId: thread.environmentId ?? null,
    });
  }

  async spawnCrewWithPaths(input: Parameters<FleetService["spawnCrew"]>[0]): Promise<
    FleetNode & { worktreePath: string | null }
  > {
    const node = await this.spawnCrew(input);
    let worktreePath: string | null = null;
    if (node.envId) {
      try {
        const env = await this.bb.sdk.environments.get({
          environmentId: node.envId,
        });
        worktreePath = env.path?.trim() || null;
      } catch {
        worktreePath = null;
      }
    }
    return { ...node, worktreePath };
  }

  async spawnCrewBatch(
    homeId: string,
    specs: BatchSpawnSpec[],
  ): Promise<FleetNode[]> {
    const nodes: FleetNode[] = [];
    for (const spec of specs) {
      nodes.push(
        await this.spawnCrew({
          homeId,
          label: spec.label,
          role: spec.role,
          prompt: spec.prompt,
          profileId: spec.profileId ?? undefined,
          deliveryMode: spec.deliveryMode,
          yolo: spec.yolo,
        }),
      );
    }
    return nodes;
  }
}
