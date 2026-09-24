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
          spawn: async () => {
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
    const { fleet, bbEvents, nodes } = spawnFleet({});
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
