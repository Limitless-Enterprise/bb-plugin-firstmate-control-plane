import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  digestSchema,
  bearingsSchema,
  holdSchema,
  homeSchema,
  inboxItemSchema,
  nodeSchema,
  profileSchema,
  treeNodeSchema,
  wakeSchema,
} from "./lib/types";

export const rpcContract = defineRpcContract({
  listHomes: {
    input: z.null(),
    output: z.object({
      homes: z.array(homeSchema),
      selectedHomeId: z.string().nullable(),
    }),
  },
  selectHome: {
    input: z.object({ homeId: z.string() }),
    output: z.null(),
  },
  registerHome: {
    input: z.object({
      homeId: z.string(),
      label: z.string(),
      checkoutPath: z.string(),
      mateThreadId: z.string(),
      defaultProfileId: z.string().nullable().optional(),
    }),
    output: homeSchema,
  },
  createHome: {
    input: z.object({
      homeId: z.string(),
      label: z.string(),
      parentDir: z.string().optional(),
      checkoutPath: z.string().optional(),
      mateThreadId: z.string(),
      defaultProfileId: z.string().nullable().optional(),
    }),
    output: homeSchema,
  },
  createHomeWithMateThread: {
    input: z.object({
      homeId: z.string(),
      label: z.string(),
      parentDir: z.string().optional(),
      checkoutPath: z.string().optional(),
      projectId: z.string().nullable().optional(),
      prompt: z.string().optional(),
    }),
    output: homeSchema,
  },
  getHomeCreateDefaults: {
    input: z.null(),
    output: z.object({
      defaultParentDir: z.string(),
      firstmateRepoUrl: z.string(),
    }),
  },
  getMateDefaults: {
    input: z.null(),
    output: z.object({
      providerId: z.string(),
      model: z.string(),
    }),
  },
  setMateDefaults: {
    input: z.object({
      providerId: z.string(),
      model: z.string(),
    }),
    output: z.object({
      providerId: z.string(),
      model: z.string(),
    }),
  },
  previewHomeCheckout: {
    input: z.object({
      homeId: z.string(),
      parentDir: z.string().optional(),
    }),
    output: z.object({
      checkoutPath: z.string(),
      exists: z.boolean(),
      isGitRepo: z.boolean(),
      parentDir: z.string(),
      repoUrl: z.string(),
    }),
  },
  updateHome: {
    input: z.object({
      homeId: z.string(),
      label: z.string().optional(),
      checkoutPath: z.string().optional(),
      mateThreadId: z.string().optional(),
      defaultProfileId: z.string().nullable().optional(),
    }),
    output: homeSchema,
  },
  deleteHome: {
    input: z.object({ homeId: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  },
  resetMateThreadPreflight: {
    input: z.object({ homeId: z.string() }),
    output: z.object({
      allowed: z.boolean(),
      openChildren: z.array(
        z.object({
          threadId: z.string(),
          label: z.string(),
          kind: z.enum(["primary", "secondmate", "crew"]),
        }),
      ),
      mateThreadId: z.string(),
      mateLabel: z.string(),
    }),
  },
  resetMateThread: {
    input: z.object({
      homeId: z.string(),
      prompt: z.string().optional(),
    }),
    output: z.object({
      home: homeSchema,
      previousMateThreadId: z.string(),
      mateThreadId: z.string(),
    }),
  },
  listThreadCandidates: {
    input: z.object({ limit: z.number().optional() }).optional(),
    output: z.object({
      threads: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          projectId: z.string(),
        }),
      ),
    }),
  },
  pickCheckoutFolder: {
    input: z.object({ clientHostId: z.string().optional() }),
    output: z.object({
      path: z.string().nullable(),
      useDirectoryBrowser: z.boolean(),
    }),
  },
  browseHostDirectory: {
    input: z.object({ path: z.string().optional() }),
    output: z.object({
      directory: z.string(),
      parent: z.string().nullable(),
      entries: z.array(
        z.object({
          kind: z.enum(["file", "directory"]),
          name: z.string(),
          path: z.string(),
        }),
      ),
    }),
  },
  getTree: {
    input: z.object({ homeId: z.string() }),
    output: z.object({ tree: z.array(treeNodeSchema) }),
  },
  listNodes: {
    input: z.object({ homeId: z.string() }),
    output: z.object({ nodes: z.array(nodeSchema) }),
  },
  attachCrew: {
    input: z.object({
      homeId: z.string(),
      threadId: z.string(),
      label: z.string(),
      role: z.enum(["ship", "scout"]),
      parentId: z.string().nullable().optional(),
      envId: z.string().nullable().optional(),
      deliveryMode: z
        .enum(["no-mistakes", "direct-PR", "local-only"])
        .optional(),
      yolo: z.boolean().optional(),
      dispatchProfileId: z.string().nullable().optional(),
    }),
    output: nodeSchema,
  },
  createSecondmate: {
    input: z.object({
      homeId: z.string(),
      threadId: z.string(),
      label: z.string(),
      envId: z.string().nullable().optional(),
      dispatchProfileId: z.string().nullable().optional(),
    }),
    output: nodeSchema,
  },
  spawnCrew: {
    input: z.object({
      homeId: z.string(),
      label: z.string(),
      role: z.enum(["ship", "scout"]),
      prompt: z.string(),
      parentId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      profileId: z.string().nullable().optional(),
      deliveryMode: z
        .enum(["no-mistakes", "direct-PR", "local-only"])
        .optional(),
      yolo: z.boolean().optional(),
    }),
    output: nodeSchema,
  },
  markThread: {
    input: z.object({
      homeId: z.string(),
      threadId: z.string(),
      state: z.enum([
        "starting",
        "working",
        "blocked",
        "idle",
        "done",
        "unknown",
        "stopped",
        "error",
      ]),
      detail: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    output: z.null(),
  },
  steer: {
    input: z.object({
      homeId: z.string(),
      threadId: z.string(),
      text: z.string().min(1),
    }),
    output: z.null(),
  },
  interrupt: {
    input: z.object({ homeId: z.string(), threadId: z.string() }),
    output: z.null(),
  },
  exitThread: {
    input: z.object({ homeId: z.string(), threadId: z.string() }),
    output: z.null(),
  },
  relaunch: {
    input: z.object({
      homeId: z.string(),
      threadId: z.string(),
      prompt: z.string().optional(),
    }),
    output: nodeSchema,
  },
  detachCrew: {
    input: z.object({ homeId: z.string(), threadId: z.string() }),
    output: z.null(),
  },
  listProfiles: {
    input: z.object({ homeId: z.string() }),
    output: z.object({ profiles: z.array(profileSchema) }),
  },
  upsertProfile: {
    input: z.object({
      id: z.string().optional(),
      homeId: z.string(),
      label: z.string(),
      providerId: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      effort: z.string().nullable().optional(),
      taskClasses: z.array(z.string()).optional(),
    }),
    output: profileSchema,
  },
  listWakes: {
    input: z.object({
      homeId: z.string(),
      acked: z.boolean().optional(),
    }),
    output: z.object({ wakes: z.array(wakeSchema) }),
  },
  ackWake: {
    input: z.object({ id: z.string(), homeId: z.string() }),
    output: z.null(),
  },
  openHold: {
    input: z.object({
      homeId: z.string(),
      mateId: z.string(),
      threadId: z.string(),
      title: z.string(),
      body: z.string(),
      urgency: z.enum(["low", "normal", "high"]).optional(),
    }),
    output: holdSchema,
  },
  resolveHold: {
    input: z.object({ homeId: z.string(), holdId: z.string() }),
    output: z.null(),
  },
  listHolds: {
    input: z.object({
      homeId: z.string(),
      state: z.enum(["open", "resolved"]).optional(),
    }),
    output: z.object({ holds: z.array(holdSchema) }),
  },
  listInbox: {
    input: z.object({
      homeId: z.string(),
      state: z.enum(["open", "snoozed", "resolved"]).optional(),
      kind: z
        .enum(["all", "hold", "wake", "liveness", "stall", "pr"])
        .optional(),
    }),
    output: z.object({ items: z.array(inboxItemSchema) }),
  },
  snoozeInbox: {
    input: z.object({
      homeId: z.string(),
      id: z.string(),
      untilMs: z.number(),
    }),
    output: z.null(),
  },
  resolveInbox: {
    input: z.object({ homeId: z.string(), id: z.string() }),
    output: z.null(),
  },
  probe: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ verdict: z.string() }),
  },
  probeHome: {
    input: z.object({ homeId: z.string() }),
    output: z.object({
      results: z.array(
        z.object({ threadId: z.string(), verdict: z.string() }),
      ),
    }),
  },
  digest: {
    input: z.object({ homeId: z.string() }),
    output: digestSchema,
  },
  bearings: {
    input: z.object({ homeId: z.string() }),
    output: bearingsSchema,
  },
  fleetSnapshot: {
    input: z.object({ homeId: z.string() }),
    output: z.object({
      digest: digestSchema,
      bearings: bearingsSchema,
      generatedAtMs: z.number(),
    }),
  },
  fleetNavCounts: {
    input: z.object({ homeId: z.string() }),
    output: z.object({
      inbox: z.number(),
      wakes: z.number(),
      dead: z.number(),
    }),
  },
  status: {
    input: z.object({ homeId: z.string().optional() }),
    output: z.object({
      homes: z.array(homeSchema),
      selectedHomeId: z.string().nullable(),
      openInbox: z.number(),
      tree: z.array(treeNodeSchema),
    }),
  },
  inboxBadge: {
    input: z.null(),
    output: z.object({
      count: z.number(),
      wakes: z.number(),
      dead: z.number(),
    }),
  },
});

export type RpcContract = typeof rpcContract;
