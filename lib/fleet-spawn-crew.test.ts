import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import type { FleetNode } from "./types";

const HOME = {
  homeId: "tech",
  label: "tech",
  checkoutPath: "/tmp/tech",
  primaryMateId: "mate-1",
  mateThreadId: "thr_mate",
  defaultProfileId: null,
  createdAtMs: 1,
};

const PRIMARY: FleetNode = {
  id: "mate-1",
  homeId: "tech",
  kind: "primary",
  parentId: null,
  threadId: "thr_mate",
  label: "cto",
  role: null,
  envId: null,
  deliveryMode: "no-mistakes",
  yolo: false,
  dispatchProfileId: null,
  createdAtMs: 1,
};

function spawnFleet(options: {
  sendError?: Error;
  archiveError?: Error;
  onSend?: () => void;
  onAttach?: () => void;
  onSpawnProject?: (projectId: string) => void;
}) {
  const bbEvents: string[] = [];
  const nodes = new Map<string, FleetNode>([["mate-1", { ...PRIMARY }]]);

  const store = {
    getHome(homeId: string) {
      return homeId === HOME.homeId ? HOME : undefined;
    },
    listProfiles() {
      return [];
    },
    getNode(id: string) {
      return nodes.get(id);
    },
    getNodeByThread(threadId: string) {
      return [...nodes.values()].find((n) => n.threadId === threadId);
    },
    appendLedger() {},
    insertNode(input: Omit<FleetNode, "id" | "createdAtMs">) {
      options.onAttach?.();
      const node: FleetNode = {
        ...input,
        id: "n-new-crew",
        createdAtMs: Date.now(),
      };
      nodes.set(node.id, node);
      bbEvents.push(`insertNode:${input.threadId}`);
      return node;
    },
  };

  const fleet = new FleetService(
    {
      sdk: {
        projects: {
          list: async () => [{ id: "proj-1", kind: "standard" }],
        },
        hosts: {
          list: async () => [{ id: "host-1" }],
        },
        threads: {
          get: async () => ({
            id: "thr_mate",
            projectId: "proj-1",
          }),
          spawn: async (input: { projectId: string }) => {
            options.onSpawnProject?.(input.projectId);
            bbEvents.push("spawn:thr_spawned");
            return { id: "thr_spawned", environmentId: "env-1" };
          },
          send: async () => {
            bbEvents.push("send:thr_spawned");
            options.onSend?.();
            if (options.sendError) throw options.sendError;
          },
          stop: async ({ threadId }: { threadId: string }) => {
            bbEvents.push(`stop:${threadId}`);
          },
          archive: async ({ threadId }: { threadId: string }) => {
            bbEvents.push(`archive:${threadId}`);
            if (options.archiveError) throw options.archiveError;
          },
        },
      },
      log: { warn: () => {} },
      realtime: { publish: () => {} },
    } as never,
    store as never,
  );

  return { fleet, bbEvents, nodes };
}

describe("spawnCrew launch brief (B-S3)", () => {
  it("sends launch brief before attachCrew registers node", async () => {
    let spawnProjectId: string | undefined;
    const { fleet, bbEvents, nodes } = spawnFleet({
      onSpawnProject: (id) => {
        spawnProjectId = id;
      },
    });
    const node = await fleet.spawnCrew({
      homeId: "tech",
      label: "alpha",
      role: "ship",
      prompt: "do work",
    });
    assert.equal(node.threadId, "thr_spawned");
    assert.ok(nodes.has("n-new-crew"));
    const sendIdx = bbEvents.indexOf("send:thr_spawned");
    const insertIdx = bbEvents.indexOf("insertNode:thr_spawned");
    assert.ok(sendIdx >= 0);
    assert.ok(insertIdx >= 0);
    assert.ok(sendIdx < insertIdx);
    assert.equal(spawnProjectId, "proj-1");
  });

  it("binds crew spawn to mate thread project (P-R7)", async () => {
    let spawnProjectId: string | undefined;
    const { fleet } = spawnFleet({
      onSpawnProject: (id) => {
        spawnProjectId = id;
      },
    });
    await fleet.spawnCrew({
      homeId: "tech",
      label: "alpha",
      role: "ship",
      prompt: "do work",
      projectId: "proj-override-should-not-win",
    });
    assert.equal(spawnProjectId, "proj-1");
  });

  it("uses home default dispatch profile when profileId omitted (P-D4)", async () => {
    let spawnModel: string | undefined;
    const nodes = new Map<string, FleetNode>([
      [
        "mate-1",
        {
          id: "mate-1",
          homeId: "tech",
          kind: "primary",
          parentId: null,
          threadId: "thr_mate",
          label: "cto",
          role: null,
          envId: null,
          deliveryMode: "no-mistakes",
          yolo: false,
          dispatchProfileId: null,
          createdAtMs: 1,
        },
      ],
    ]);
    const fleet2 = new FleetService(
      {
        sdk: {
          projects: { list: async () => [{ id: "proj-1", kind: "standard" }] },
          hosts: { list: async () => [{ id: "host-1" }] },
          environments: {
            create: async () => ({ id: "env-1", path: "/wt" }),
          },
          threads: {
            get: async () => ({ id: "thr_mate", projectId: "proj-1" }),
            spawn: async (input: { model?: string }) => {
              spawnModel = input.model;
              return { id: "thr_spawned", environmentId: "env-1" };
            },
            send: async () => {},
            stop: async () => {},
            archive: async () => {},
          },
        },
        log: { warn: () => {} },
        realtime: { publish: () => {} },
      } as never,
      {
        getHome: () => ({ ...HOME, defaultProfileId: "prof-1" }),
        listProfiles: () => [
          {
            id: "prof-1",
            homeId: "tech",
            label: "Ship",
            providerId: "openai",
            model: "gpt-test",
            effort: null,
            taskClasses: [],
          },
        ],
        getNode: (id: string) => nodes.get(id),
        getNodeByThread: () => undefined,
        appendLedger: () => {},
        insertNode: (input: Omit<FleetNode, "id" | "createdAtMs">) => {
          const node: FleetNode = {
            ...input,
            id: "n-new",
            createdAtMs: 1,
          };
          nodes.set(node.id, node);
          return node;
        },
      } as never,
    );
    await fleet2.spawnCrew({
      homeId: "tech",
      label: "alpha",
      role: "ship",
      prompt: "work",
      deliveryMode: "direct-PR",
      yolo: true,
    });
    assert.equal(spawnModel, "gpt-test");
    const attached = [...nodes.values()].find((n) => n.threadId === "thr_spawned");
    assert.equal(attached?.deliveryMode, "direct-PR");
    assert.equal(attached?.yolo, true);
    assert.equal(attached?.dispatchProfileId, "prof-1");
  });

  it("stops and archives spawned thread when send fails", async () => {
    const { fleet, bbEvents, nodes } = spawnFleet({
      sendError: new Error("send failed"),
    });
    await assert.rejects(
      () =>
        fleet.spawnCrew({
          homeId: "tech",
          label: "alpha",
          role: "ship",
          prompt: "do work",
        }),
      /send failed/,
    );
    assert.equal(nodes.size, 1);
    assert.ok(!bbEvents.some((e) => e.startsWith("insertNode:")));
    assert.deepEqual(
      bbEvents.filter((e) => e.includes("thr_spawned")),
      ["spawn:thr_spawned", "send:thr_spawned", "archive:thr_spawned", "stop:thr_spawned"],
    );
  });

  it("stops spawned thread and throws when rollback archive fails", async () => {
    const { fleet, bbEvents, nodes } = spawnFleet({
      sendError: new Error("send failed"),
      archiveError: new Error("archive down"),
    });
    await assert.rejects(
      () =>
        fleet.spawnCrew({
          homeId: "tech",
          label: "alpha",
          role: "ship",
          prompt: "do work",
        }),
      /rollback archive failed.*archive down/,
    );
    assert.equal(nodes.size, 1);
    assert.ok(bbEvents.includes("stop:thr_spawned"));
    assert.ok(bbEvents.includes("archive:thr_spawned"));
  });
});
