import { z } from "zod";

export const fsmStates = [
  "starting",
  "working",
  "blocked",
  "idle",
  "done",
  "unknown",
  "stopped",
  "error",
] as const;
export type FsmState = (typeof fsmStates)[number];

export const livenessVerdicts = [
  "alive",
  "dead",
  "missing",
  "ambiguous",
] as const;
export type LivenessVerdict = (typeof livenessVerdicts)[number];

export const nodeKinds = ["primary", "secondmate", "crew"] as const;
export type NodeKind = (typeof nodeKinds)[number];

export const crewRoles = ["ship", "scout"] as const;
export type CrewRole = (typeof crewRoles)[number];

export const deliveryModes = [
  "no-mistakes",
  "direct-PR",
  "local-only",
] as const;
export type DeliveryMode = (typeof deliveryModes)[number];

export const urgencies = ["low", "normal", "high"] as const;
export type Urgency = (typeof urgencies)[number];

export const inboxStates = ["open", "snoozed", "resolved"] as const;
export type InboxState = (typeof inboxStates)[number];

export const homeSchema = z.object({
  homeId: z.string(),
  label: z.string(),
  checkoutPath: z.string(),
  primaryMateId: z.string(),
  mateThreadId: z.string(),
  defaultProfileId: z.string().nullable(),
  createdAtMs: z.number(),
});

export const nodeSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  kind: z.enum(nodeKinds),
  parentId: z.string().nullable(),
  threadId: z.string(),
  label: z.string(),
  role: z.enum(crewRoles).nullable(),
  envId: z.string().nullable(),
  deliveryMode: z.enum(deliveryModes),
  yolo: z.boolean(),
  dispatchProfileId: z.string().nullable(),
  createdAtMs: z.number(),
});

export const profileSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  label: z.string(),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  taskClasses: z.array(z.string()),
});

export type TreeNode = FleetNode & {
  fsmState: FsmState;
  liveness: LivenessVerdict | null;
  depth: number;
  children: TreeNode[];
  prUrl?: string | null;
  profileLabel?: string | null;
};

export const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  nodeSchema.extend({
    fsmState: z.enum(fsmStates),
    liveness: z.enum(livenessVerdicts).nullable(),
    depth: z.number(),
    children: z.array(treeNodeSchema),
    prUrl: z.string().nullable().optional(),
    profileLabel: z.string().nullable().optional(),
  }),
);

export const inboxItemSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  holdId: z.string().nullable(),
  threadId: z.string(),
  kind: z.enum(["hold", "wake", "liveness", "stall", "pr"]),
  urgency: z.enum(urgencies),
  title: z.string(),
  body: z.string(),
  state: z.enum(inboxStates),
  snoozedUntilMs: z.number().nullable(),
  createdAtMs: z.number(),
  resolvedAtMs: z.number().nullable(),
});

export const holdSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  mateId: z.string(),
  threadId: z.string(),
  title: z.string(),
  body: z.string(),
  urgency: z.enum(urgencies),
  state: z.enum(["open", "resolved"]),
  createdAtMs: z.number(),
  resolvedAtMs: z.number().nullable(),
});

export const wakeSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  threadId: z.string().nullable(),
  targetMateId: z.string().nullable(),
  reason: z.string(),
  priority: z.number(),
  dedupeKey: z.string().nullable(),
  acked: z.boolean(),
  createdAtMs: z.number(),
});

export const digestSchema = z.object({
  homeId: z.string(),
  label: z.string(),
  generatedAtMs: z.number(),
  summary: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(nodeKinds),
      fsmState: z.enum(fsmStates),
      liveness: z.enum(livenessVerdicts).nullable(),
      role: z.enum(crewRoles).nullable(),
    }),
  ),
  openInbox: z.number(),
  unackedWakes: z.number(),
  openHolds: z.number(),
});

export const bearingsSchema = z.object({
  homeId: z.string(),
  label: z.string(),
  generatedAtMs: z.number(),
  summary: z.string(),
  lines: z.array(z.string()),
  digest: digestSchema,
  openHolds: z.number(),
  unackedWakes: z.number(),
  prLinks: z.array(
    z.object({
      label: z.string(),
      url: z.string(),
      threadId: z.string(),
    }),
  ),
});

export type Home = z.infer<typeof homeSchema>;
export type FleetNode = z.infer<typeof nodeSchema>;
export type DispatchProfile = z.infer<typeof profileSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type Hold = z.infer<typeof holdSchema>;
export type Wake = z.infer<typeof wakeSchema>;
export type Digest = z.infer<typeof digestSchema>;
export type Bearings = z.infer<typeof bearingsSchema>;
