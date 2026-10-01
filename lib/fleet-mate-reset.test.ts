import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { FleetService } from "./fleet-service";
import { isMetaFleetDetached } from "./fleet-meta-closeout";
import type { FleetNode, Home } from "./types";

const execFileAsync = promisify(execFile);

const BASE_HOME: Home = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/unused",
  primaryMateId: "mate-1",
  mateThreadId: "thr_mate_old",
  defaultProfileId: null,
  createdAtMs: 1,
};

const PRIMARY: FleetNode = {
  id: "mate-1",
  homeId: "tech",
  kind: "primary",
  parentId: null,
  threadId: "thr_mate_old",
  label: "cto",
  role: null,
  envId: null,
  deliveryMode: "no-mistakes",
  yolo: false,
  dispatchProfileId: null,
  createdAtMs: 1,
};

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function minimalGitCheckout(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-mate-reset-"));
  tempRoots.push(root);
  await execFileAsync("git", ["init"], { cwd: root });
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const stub = "#!/usr/bin/env bash\nexit 0\n";
  for (const name of ["fm-spawn.sh", "fm-backend.sh", "fm-teardown.sh"]) {
    await fs.writeFile(path.join(binDir, name), stub, { mode: 0o755 });
  }
  const controlLib = [
    "#!/usr/bin/env bash",
    "supports_key() {",
    "  case \"$1\" in",
    "    tmux|herdr|zellij|cmux)",
    "      case \"$key\" in Escape|Enter|C-c|C-u) return 0 ;; esac",
    "      ;;",
    "  esac",
    "}",
    "state_verified() {",
    "  case \"$1\" in",
    "    tmux|herdr) return 0 ;;",
    "  esac",
    "}",
    "",
  ].join("\n");
  await fs.writeFile(path.join(binDir, "fm-control-lib.sh"), controlLib, { mode: 0o755 });
  return root;
}

function mateResetFleet(options: {
  home: Home;
  nodes: FleetNode[];
  threadsGet?: (threadId: string) => Promise<{ id: string; projectId: string; archivedAt?: number | null }>;
  threadsGetThrows?: Set<string>;
  spawnFails?: boolean;
}) {
  const bbEvents: string[] = [];
  let home = { ...options.home };
  const nodes = [...options.nodes];

  const store = {
    getHome: () => home,
    listNodes: () => nodes,
    updateHome(homeId: string, patch: Partial<Home>) {
      if (homeId !== home.homeId) return undefined;
      home = {
        ...home,
        label: patch.label ?? home.label,
        checkoutPath: patch.checkoutPath ?? home.checkoutPath,
        mateThreadId: patch.mateThreadId ?? home.mateThreadId,
        defaultProfileId:
          patch.defaultProfileId !== undefined
            ? patch.defaultProfileId
            : home.defaultProfileId,
      };
      if (patch.mateThreadId) {
        bbEvents.push(`persist:${patch.mateThreadId}`);
        const primary = nodes.find((n) => n.kind === "primary");
        if (primary) primary.threadId = patch.mateThreadId;
      }
      return home;
    },
    appendLedger: () => {},
  };

  const fleet = new FleetService(
    {
      sdk: {
        projects: { list: async () => [{ id: "proj-1", kind: "standard" }] },
        threads: {
          get: async ({ threadId }: { threadId: string }) => {
            if (options.threadsGetThrows?.has(threadId)) {
              throw new Error(`lookup failed: ${threadId}`);
            }
            if (options.threadsGet) {
              return options.threadsGet(threadId);
            }
            return {
              id: threadId,
              projectId: "proj-1",
              archivedAt: threadId === "thr_archived" ? Date.now() : null,
            };
          },
          spawn: async () => {
            bbEvents.push("spawn");
            if (options.spawnFails) {
              throw new Error("spawn failed");
            }
            return { id: "thr_mate_new", environmentId: "env-1" };
          },
          stop: async ({ threadId }: { threadId: string }) => {
            bbEvents.push(`stop:${threadId}`);
          },
          archive: async ({ threadId }: { threadId: string }) => {
            bbEvents.push(`archive:${threadId}`);
          },
        },
      },
      storage: {
        kv: {
          get: async () => null,
          set: async () => {},
        },
      },
      log: { warn: () => {}, info: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );

  return { fleet, bbEvents, getHome: () => home };
}

describe("resolveOpenChildBlockers / resetMateThreadPreflight", () => {
  it("blocks reset when a crew thread is still open in BB", async () => {
    const crew: FleetNode = {
      ...PRIMARY,
      id: "c1",
      kind: "crew",
      parentId: "mate-1",
      threadId: "thr_open",
      label: "ship-open",
      role: "ship",
    };
    const { fleet } = mateResetFleet({
      home: BASE_HOME,
      nodes: [PRIMARY, crew],
    });
    const preflight = await fleet.resetMateThreadPreflight("tech");
    assert.equal(preflight.allowed, false);
    assert.equal(preflight.openChildren.length, 1);
    assert.equal(preflight.openChildren[0]?.threadId, "thr_open");
  });

  it("allows reset when crew threads are archived in BB", async () => {
    const crew: FleetNode = {
      ...PRIMARY,
      id: "c1",
      kind: "crew",
      parentId: "mate-1",
      threadId: "thr_archived",
      label: "ship-done",
      role: "ship",
    };
    const { fleet } = mateResetFleet({
      home: BASE_HOME,
      nodes: [PRIMARY, crew],
    });
    const preflight = await fleet.resetMateThreadPreflight("tech");
    assert.equal(preflight.allowed, true);
    assert.equal(preflight.openChildren.length, 0);
  });

  it("fail-closed when BB thread lookup fails for a crew node", async () => {
    const crew: FleetNode = {
      ...PRIMARY,
      id: "c1",
      kind: "crew",
      parentId: "mate-1",
      threadId: "thr_unknown",
      label: "ship-x",
      role: "ship",
    };
    const { fleet } = mateResetFleet({
      home: BASE_HOME,
      nodes: [PRIMARY, crew],
      threadsGetThrows: new Set(["thr_unknown"]),
    });
    const preflight = await fleet.resetMateThreadPreflight("tech");
    assert.equal(preflight.allowed, false);
    assert.equal(preflight.openChildren[0]?.threadId, "thr_unknown");
  });

  it("does not treat legacy fleet thread ids as open blockers", async () => {
    const legacyCrew: FleetNode = {
      ...PRIMARY,
      id: "c-legacy",
      kind: "crew",
      parentId: "mate-1",
      threadId: "legacy:ship-old",
      label: "ship-legacy",
      role: "ship",
    };
    const { fleet } = mateResetFleet({
      home: BASE_HOME,
      nodes: [PRIMARY, legacyCrew],
      threadsGetThrows: new Set(["legacy:ship-old"]),
    });
    const preflight = await fleet.resetMateThreadPreflight("tech");
    assert.equal(preflight.allowed, true);
    assert.equal(preflight.openChildren.length, 0);
  });
});

describe("resetMateThread", () => {
  it("spawns before stop/archive and persists home only after archive succeeds", async () => {
    const checkoutPath = await minimalGitCheckout();
    const home = { ...BASE_HOME, checkoutPath };
    const { fleet, bbEvents, getHome } = mateResetFleet({
      home,
      nodes: [{ ...PRIMARY, threadId: "thr_mate_old" }],
    });

    const result = await fleet.resetMateThread("tech");
    assert.equal(result.mateThreadId, "thr_mate_new");
    assert.equal(result.previousMateThreadId, "thr_mate_old");
    assert.equal(getHome().mateThreadId, "thr_mate_new");

    const spawnIdx = bbEvents.indexOf("spawn");
    const stopIdx = bbEvents.indexOf("stop:thr_mate_old");
    const archiveIdx = bbEvents.indexOf("archive:thr_mate_old");
    const persistIdx = bbEvents.indexOf("persist:thr_mate_new");
    assert.ok(spawnIdx >= 0);
    assert.ok(stopIdx > spawnIdx);
    assert.ok(archiveIdx > spawnIdx);
    assert.ok(persistIdx > archiveIdx);
  });

  it("does not archive the previous mate when spawn fails", async () => {
    const checkoutPath = await minimalGitCheckout();
    const home = { ...BASE_HOME, checkoutPath };
    const { fleet, bbEvents } = mateResetFleet({
      home,
      nodes: [{ ...PRIMARY, threadId: "thr_mate_old" }],
      spawnFails: true,
    });

    await assert.rejects(() => fleet.resetMateThread("tech"), /spawn failed/);
    assert.ok(!bbEvents.some((e) => e.startsWith("archive:")));
    assert.ok(!bbEvents.some((e) => e.startsWith("stop:")));
  });

  it("rejects reset when open child crews remain", async () => {
    const crew: FleetNode = {
      ...PRIMARY,
      id: "c1",
      kind: "crew",
      parentId: "mate-1",
      threadId: "thr_open",
      label: "ship-open",
      role: "ship",
    };
    const { fleet, bbEvents } = mateResetFleet({
      home: BASE_HOME,
      nodes: [PRIMARY, crew],
    });

    await assert.rejects(() => fleet.resetMateThread("tech"), /ship-open/);
    assert.equal(bbEvents.length, 0);
  });
});

describe("fleet_detached on close-out", () => {
  it("stamps fleet_detached on task meta via markTaskMetaFleetDetachedForHome", async () => {
    const checkoutPath = await minimalGitCheckout();
    const stateDir = path.join(checkoutPath, "state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "ship-1.meta"),
      "kind=ship\nbb_thread_id=thr_crew\n",
      "utf8",
    );

    const home = { ...BASE_HOME, checkoutPath };
    const fleet = new FleetService(
      {
        sdk: {
          threads: {
            get: async () => ({
              id: home.mateThreadId,
              environmentId: null,
            }),
          },
        },
        log: { warn: () => {} },
        realtime: { publish: () => {} },
      } as never,
      {
        getHome: () => home,
      } as never,
    );

    await fleet.markTaskMetaFleetDetachedForHome("tech", "ship-1");
    const meta = await fs.readFile(path.join(stateDir, "ship-1.meta"), "utf8");
    assert.equal(isMetaFleetDetached(meta), true);
  });
});
