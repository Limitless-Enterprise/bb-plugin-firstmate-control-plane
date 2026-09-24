import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  DeliveryMode,
  FleetNode,
  Hold,
  Home,
  InboxItem,
  InboxState,
  NodeKind,
  Urgency,
  Wake,
} from "./types";
import type { DispatchProfile } from "./types";

export const migrations = [
  `CREATE TABLE IF NOT EXISTS homes (
    home_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    checkout_path TEXT NOT NULL,
    primary_mate_id TEXT NOT NULL,
    mate_thread_id TEXT NOT NULL,
    default_profile_id TEXT,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    parent_id TEXT,
    thread_id TEXT NOT NULL,
    label TEXT NOT NULL,
    role TEXT,
    env_id TEXT,
    delivery_mode TEXT NOT NULL DEFAULT 'no-mistakes',
    yolo INTEGER NOT NULL DEFAULT 0,
    dispatch_profile_id TEXT,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_home ON nodes(home_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_thread ON nodes(thread_id)`,
  `CREATE TABLE IF NOT EXISTS dispatch_profiles (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    label TEXT NOT NULL,
    provider_id TEXT,
    model TEXT,
    effort TEXT,
    task_classes TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    verb TEXT NOT NULL,
    fsm_state TEXT NOT NULL,
    detail_json TEXT,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_thread ON ledger(thread_id, created_at_ms)`,
  `CREATE TABLE IF NOT EXISTS wakes (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    thread_id TEXT,
    target_mate_id TEXT,
    reason TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    dedupe_key TEXT,
    acked INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wakes_home ON wakes(home_id, acked)`,
  `CREATE TABLE IF NOT EXISTS holds (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    mate_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'normal',
    state TEXT NOT NULL DEFAULT 'open',
    created_at_ms INTEGER NOT NULL,
    resolved_at_ms INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    hold_id TEXT,
    thread_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'normal',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    snoozed_until_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    resolved_at_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_home_state ON inbox(home_id, state)`,
  `CREATE TABLE IF NOT EXISTS liveness (
    thread_id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    detail_json TEXT,
    probed_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

type NodeRow = {
  id: string;
  homeId: string;
  kind: NodeKind;
  parentId: string | null;
  threadId: string;
  label: string;
  role: "ship" | "scout" | null;
  envId: string | null;
  deliveryMode: DeliveryMode;
  yolo: number;
  dispatchProfileId: string | null;
  createdAtMs: number;
};

function rowToNode(row: NodeRow): FleetNode {
  return {
    id: row.id,
    homeId: row.homeId,
    kind: row.kind,
    parentId: row.parentId,
    threadId: row.threadId,
    label: row.label,
    role: row.role,
    envId: row.envId,
    deliveryMode: row.deliveryMode,
    yolo: row.yolo === 1,
    dispatchProfileId: row.dispatchProfileId,
    createdAtMs: row.createdAtMs,
  };
}

const NODE_SELECT = `
  id, home_id AS homeId, kind, parent_id AS parentId, thread_id AS threadId,
  label, role, env_id AS envId, delivery_mode AS deliveryMode, yolo,
  dispatch_profile_id AS dispatchProfileId, created_at_ms AS createdAtMs`;

export class FleetStore {
  constructor(private readonly db: Database) {}

  getSelectedHomeId(): string | null {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = 'selectedHomeId'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSelectedHomeId(homeId: string): void {
    this.db
      .prepare(
        "INSERT INTO kv (key, value) VALUES ('selectedHomeId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(homeId);
  }

  upsertHome(input: Omit<Home, "createdAtMs"> & { createdAtMs?: number }): Home {
    const createdAtMs = input.createdAtMs ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO homes (home_id, label, checkout_path, primary_mate_id, mate_thread_id, default_profile_id, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(home_id) DO UPDATE SET
           label = excluded.label,
           checkout_path = excluded.checkout_path,
           primary_mate_id = excluded.primary_mate_id,
           mate_thread_id = excluded.mate_thread_id,
           default_profile_id = excluded.default_profile_id`,
      )
      .run(
        input.homeId,
        input.label,
        input.checkoutPath,
        input.primaryMateId,
        input.mateThreadId,
        input.defaultProfileId,
        createdAtMs,
      );
    return { ...input, createdAtMs };
  }

  getHome(homeId: string): Home | undefined {
    const row = this.db
      .prepare(
        `SELECT home_id AS homeId, label, checkout_path AS checkoutPath,
         primary_mate_id AS primaryMateId, mate_thread_id AS mateThreadId,
         default_profile_id AS defaultProfileId, created_at_ms AS createdAtMs
         FROM homes WHERE home_id = ?`,
      )
      .get(homeId) as Home | undefined;
    return row;
  }

  listHomes(): Home[] {
    return this.db
      .prepare(
        `SELECT home_id AS homeId, label, checkout_path AS checkoutPath,
         primary_mate_id AS primaryMateId, mate_thread_id AS mateThreadId,
         default_profile_id AS defaultProfileId, created_at_ms AS createdAtMs
         FROM homes ORDER BY created_at_ms ASC`,
      )
      .all() as Home[];
  }

  updateHome(
    homeId: string,
    patch: {
      label?: string;
      checkoutPath?: string;
      mateThreadId?: string;
      defaultProfileId?: string | null;
    },
  ): Home | undefined {
    const existing = this.getHome(homeId);
    if (!existing) return undefined;
    const next = {
      label: patch.label ?? existing.label,
      checkoutPath: patch.checkoutPath ?? existing.checkoutPath,
      mateThreadId: patch.mateThreadId ?? existing.mateThreadId,
      defaultProfileId:
        patch.defaultProfileId !== undefined
          ? patch.defaultProfileId
          : existing.defaultProfileId,
    };
    this.db
      .prepare(
        `UPDATE homes SET label = ?, checkout_path = ?, mate_thread_id = ?, default_profile_id = ?
         WHERE home_id = ?`,
      )
      .run(
        next.label,
        next.checkoutPath,
        next.mateThreadId,
        next.defaultProfileId,
        homeId,
      );
    if (patch.label !== undefined || patch.mateThreadId !== undefined) {
      this.db
        .prepare(
          `UPDATE nodes SET label = ?, thread_id = ?
           WHERE id = ? AND home_id = ?`,
        )
        .run(
          next.label,
          next.mateThreadId,
          existing.primaryMateId,
          homeId,
        );
    }
    return this.getHome(homeId);
  }

  deleteHome(homeId: string): boolean {
    const existing = this.getHome(homeId);
    if (!existing) return false;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM nodes WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM dispatch_profiles WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM ledger WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM wakes WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM holds WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM inbox WHERE home_id = ?").run(homeId);
      this.db.prepare("DELETE FROM homes WHERE home_id = ?").run(homeId);
    });
    tx();
    if (this.getSelectedHomeId() === homeId) {
      const remaining = this.listHomes()[0];
      if (remaining) this.setSelectedHomeId(remaining.homeId);
      else this.db.prepare("DELETE FROM kv WHERE key = 'selectedHomeId'").run();
    }
    return true;
  }

  homeExists(homeId: string): boolean {
    return this.getHome(homeId) !== undefined;
  }

  insertNode(
    input: Omit<FleetNode, "id" | "createdAtMs"> & { id?: string },
  ): FleetNode {
    const id = input.id ?? randomUUID();
    const createdAtMs = Date.now();
    this.db
      .prepare(
        `INSERT INTO nodes (id, home_id, kind, parent_id, thread_id, label, role, env_id, delivery_mode, yolo, dispatch_profile_id, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.homeId,
        input.kind,
        input.parentId,
        input.threadId,
        input.label,
        input.role,
        input.envId,
        input.deliveryMode,
        input.yolo ? 1 : 0,
        input.dispatchProfileId,
        createdAtMs,
      );
    return { ...input, id, createdAtMs };
  }

  getNode(id: string): FleetNode | undefined {
    const row = this.db
      .prepare(`SELECT ${NODE_SELECT} FROM nodes WHERE id = ?`)
      .get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : undefined;
  }

  getNodeByThread(threadId: string): FleetNode | undefined {
    const row = this.db
      .prepare(`SELECT ${NODE_SELECT} FROM nodes WHERE thread_id = ?`)
      .get(threadId) as NodeRow | undefined;
    return row ? rowToNode(row) : undefined;
  }

  listNodes(homeId: string): FleetNode[] {
    const rows = this.db
      .prepare(
        `SELECT ${NODE_SELECT} FROM nodes WHERE home_id = ? ORDER BY created_at_ms ASC`,
      )
      .all(homeId) as NodeRow[];
    return rows.map(rowToNode);
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  updateNodeThread(
    id: string,
    threadId: string,
    envId: string | null,
  ): FleetNode | undefined {
    this.db
      .prepare(
        `UPDATE nodes SET thread_id = ?, env_id = ? WHERE id = ?`,
      )
      .run(threadId, envId, id);
    return this.getNode(id);
  }

  countOpenHolds(homeId: string, threadId?: string): number {
    if (threadId) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM holds
           WHERE home_id = ? AND thread_id = ? AND state = 'open'`,
        )
        .get(homeId, threadId) as { count: number };
      return row.count;
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM holds WHERE home_id = ? AND state = 'open'`,
      )
      .get(homeId) as { count: number };
    return row.count;
  }

  deleteProfile(homeId: string, profileId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM dispatch_profiles WHERE home_id = ? AND id = ?`)
      .run(homeId, profileId);
    return result.changes > 0;
  }

  upsertProfile(
    input: Omit<DispatchProfile, "id"> & { id?: string },
  ): DispatchProfile {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO dispatch_profiles (id, home_id, label, provider_id, model, effort, task_classes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           provider_id = excluded.provider_id,
           model = excluded.model,
           effort = excluded.effort,
           task_classes = excluded.task_classes`,
      )
      .run(
        id,
        input.homeId,
        input.label,
        input.providerId,
        input.model,
        input.effort,
        JSON.stringify(input.taskClasses),
      );
    return { ...input, id };
  }

  listProfiles(homeId: string): DispatchProfile[] {
    const rows = this.db
      .prepare(
        `SELECT id, home_id AS homeId, label, provider_id AS providerId,
         model, effort, task_classes AS taskClassesJson FROM dispatch_profiles WHERE home_id = ?`,
      )
      .all(homeId) as {
      id: string;
      homeId: string;
      label: string;
      providerId: string | null;
      model: string | null;
      effort: string | null;
      taskClassesJson: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      homeId: row.homeId,
      label: row.label,
      providerId: row.providerId,
      model: row.model,
      effort: row.effort,
      taskClasses: JSON.parse(row.taskClassesJson) as string[],
    }));
  }

  appendLedger(input: {
    homeId: string;
    threadId: string;
    verb: string;
    fsmState: string;
    detail?: Record<string, unknown> | null;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO ledger (id, home_id, thread_id, verb, fsm_state, detail_json, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.homeId,
        input.threadId,
        input.verb,
        input.fsmState,
        input.detail ? JSON.stringify(input.detail) : null,
        Date.now(),
      );
    return id;
  }

  latestLedgerByVerbs(
    threadId: string,
    verbs: Iterable<string>,
  ): {
    id: string;
    verb: string;
    fsmState: string;
    detail: Record<string, unknown> | null;
    createdAtMs: number;
  } | null {
    const verbList = [...verbs];
    if (verbList.length === 0) return null;
    const placeholders = verbList.map(() => "?").join(", ");
    const row = this.db
      .prepare(
        `SELECT id, verb, fsm_state AS fsmState, detail_json AS detailJson, created_at_ms AS createdAtMs
         FROM ledger WHERE thread_id = ? AND verb IN (${placeholders})
         ORDER BY created_at_ms DESC LIMIT 1`,
      )
      .get(threadId, ...verbList) as
      | {
          id: string;
          verb: string;
          fsmState: string;
          detailJson: string | null;
          createdAtMs: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      verb: row.verb,
      fsmState: row.fsmState,
      detail: row.detailJson ? JSON.parse(row.detailJson) : null,
      createdAtMs: row.createdAtMs,
    };
  }

  tailLedger(threadId: string, limit = 50): {
    id: string;
    verb: string;
    fsmState: string;
    detail: Record<string, unknown> | null;
    createdAtMs: number;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT id, verb, fsm_state AS fsmState, detail_json AS detailJson, created_at_ms AS createdAtMs
         FROM ledger WHERE thread_id = ? ORDER BY created_at_ms DESC LIMIT ?`,
      )
      .all(threadId, limit) as {
      id: string;
      verb: string;
      fsmState: string;
      detailJson: string | null;
      createdAtMs: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      verb: row.verb,
      fsmState: row.fsmState,
      detail: row.detailJson ? JSON.parse(row.detailJson) : null,
      createdAtMs: row.createdAtMs,
    }));
  }

  latestFsmState(threadId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT fsm_state AS fsmState FROM ledger WHERE thread_id = ? ORDER BY created_at_ms DESC LIMIT 1`,
      )
      .get(threadId) as { fsmState: string } | undefined;
    return row?.fsmState ?? null;
  }

  enqueueWake(input: {
    homeId: string;
    threadId?: string | null;
    targetMateId?: string | null;
    reason: string;
    priority?: number;
    dedupeKey?: string | null;
  }): string | null {
    if (input.dedupeKey) {
      const existing = this.db
        .prepare(
          "SELECT id FROM wakes WHERE dedupe_key = ? AND acked = 0 LIMIT 1",
        )
        .get(input.dedupeKey) as { id: string } | undefined;
      if (existing) return null;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO wakes (id, home_id, thread_id, target_mate_id, reason, priority, dedupe_key, acked, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.homeId,
        input.threadId ?? null,
        input.targetMateId ?? null,
        input.reason,
        input.priority ?? 0,
        input.dedupeKey ?? null,
        Date.now(),
      );
    return id;
  }

  listWakes(homeId: string, acked?: boolean): Wake[] {
    const query =
      acked === undefined
        ? `SELECT id, home_id AS homeId, thread_id AS threadId, target_mate_id AS targetMateId,
           reason, priority, dedupe_key AS dedupeKey, acked, created_at_ms AS createdAtMs
           FROM wakes WHERE home_id = ? ORDER BY priority DESC, created_at_ms DESC`
        : `SELECT id, home_id AS homeId, thread_id AS threadId, target_mate_id AS targetMateId,
           reason, priority, dedupe_key AS dedupeKey, acked, created_at_ms AS createdAtMs
           FROM wakes WHERE home_id = ? AND acked = ? ORDER BY priority DESC, created_at_ms DESC`;
    const rows = (acked === undefined
      ? this.db.prepare(query).all(homeId)
      : this.db.prepare(query).all(homeId, acked ? 1 : 0)) as {
      id: string;
      homeId: string;
      threadId: string | null;
      targetMateId: string | null;
      reason: string;
      priority: number;
      dedupeKey: string | null;
      acked: number;
      createdAtMs: number;
    }[];
    return rows.map((row) => ({
      ...row,
      acked: row.acked === 1,
    }));
  }

  ackWake(id: string): void {
    this.db.prepare("UPDATE wakes SET acked = 1 WHERE id = ?").run(id);
  }

  createHold(input: {
    homeId: string;
    mateId: string;
    threadId: string;
    title: string;
    body: string;
    urgency?: Urgency;
  }): Hold {
    const id = randomUUID();
    const createdAtMs = Date.now();
    const urgency = input.urgency ?? "normal";
    this.db
      .prepare(
        `INSERT INTO holds (id, home_id, mate_id, thread_id, title, body, urgency, state, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.homeId,
        input.mateId,
        input.threadId,
        input.title,
        input.body,
        urgency,
        createdAtMs,
      );
    return {
      id,
      homeId: input.homeId,
      mateId: input.mateId,
      threadId: input.threadId,
      title: input.title,
      body: input.body,
      urgency,
      state: "open",
      createdAtMs,
      resolvedAtMs: null,
    };
  }

  resolveHold(id: string): void {
    this.db
      .prepare(
        "UPDATE holds SET state = 'resolved', resolved_at_ms = ? WHERE id = ?",
      )
      .run(Date.now(), id);
  }

  listHolds(homeId: string, state?: "open" | "resolved"): Hold[] {
    const rows = (state
      ? this.db
          .prepare(
            `SELECT id, home_id AS homeId, mate_id AS mateId, thread_id AS threadId,
             title, body, urgency, state, created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM holds WHERE home_id = ? AND state = ? ORDER BY created_at_ms DESC`,
          )
          .all(homeId, state)
      : this.db
          .prepare(
            `SELECT id, home_id AS homeId, mate_id AS mateId, thread_id AS threadId,
             title, body, urgency, state, created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM holds WHERE home_id = ? ORDER BY created_at_ms DESC`,
          )
          .all(homeId)) as Hold[];
    return rows;
  }

  upsertInboxFromHold(hold: Hold): string {
    const existing = this.db
      .prepare("SELECT id FROM inbox WHERE hold_id = ? LIMIT 1")
      .get(hold.id) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE inbox SET title = ?, body = ?, urgency = ?, state = ?, resolved_at_ms = ?
           WHERE id = ?`,
        )
        .run(
          hold.title,
          hold.body,
          hold.urgency,
          hold.state === "open" ? "open" : "resolved",
          hold.resolvedAtMs,
          existing.id,
        );
      return existing.id;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO inbox (id, home_id, hold_id, thread_id, kind, urgency, title, body, state, created_at_ms)
         VALUES (?, ?, ?, ?, 'hold', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        hold.homeId,
        hold.id,
        hold.threadId,
        hold.urgency,
        hold.title,
        hold.body,
        hold.state === "open" ? "open" : "resolved",
        hold.createdAtMs,
      );
    return id;
  }

  createInboxItem(input: {
    homeId: string;
    holdId?: string | null;
    threadId: string;
    kind: InboxItem["kind"];
    urgency?: Urgency;
    title: string;
    body: string;
  }): InboxItem {
    const id = randomUUID();
    const createdAtMs = Date.now();
    const urgency = input.urgency ?? "normal";
    this.db
      .prepare(
        `INSERT INTO inbox (id, home_id, hold_id, thread_id, kind, urgency, title, body, state, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.homeId,
        input.holdId ?? null,
        input.threadId,
        input.kind,
        urgency,
        input.title,
        input.body,
        createdAtMs,
      );
    return {
      id,
      homeId: input.homeId,
      holdId: input.holdId ?? null,
      threadId: input.threadId,
      kind: input.kind,
      urgency,
      title: input.title,
      body: input.body,
      state: "open",
      snoozedUntilMs: null,
      createdAtMs,
      resolvedAtMs: null,
    };
  }

  private resurfaceExpiredSnoozes(homeId?: string): void {
    const now = Date.now();
    if (homeId) {
      this.db
        .prepare(
          `UPDATE inbox SET state = 'open', snoozed_until_ms = NULL
           WHERE home_id = ? AND state = 'snoozed' AND snoozed_until_ms <= ?`,
        )
        .run(homeId, now);
    } else {
      this.db
        .prepare(
          `UPDATE inbox SET state = 'open', snoozed_until_ms = NULL
           WHERE state = 'snoozed' AND snoozed_until_ms <= ?`,
        )
        .run(now);
    }
  }

  listInbox(homeId: string, state?: InboxState, limit?: number): InboxItem[] {
    if (state === "open" || state === undefined) {
      this.resurfaceExpiredSnoozes(homeId);
    }
    const capped =
      limit !== undefined
        ? Math.min(500, Math.max(1, Math.trunc(limit)))
        : undefined;
    const rows = (state
      ? capped !== undefined
        ? this.db
            .prepare(
              `SELECT id, home_id AS homeId, hold_id AS holdId, thread_id AS threadId, kind,
             urgency, title, body, state, snoozed_until_ms AS snoozedUntilMs,
             created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM inbox WHERE home_id = ? AND state = ? ORDER BY created_at_ms DESC LIMIT ?`,
            )
            .all(homeId, state, capped)
        : this.db
            .prepare(
              `SELECT id, home_id AS homeId, hold_id AS holdId, thread_id AS threadId, kind,
             urgency, title, body, state, snoozed_until_ms AS snoozedUntilMs,
             created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM inbox WHERE home_id = ? AND state = ? ORDER BY created_at_ms DESC`,
            )
            .all(homeId, state)
      : capped !== undefined
        ? this.db
            .prepare(
              `SELECT id, home_id AS homeId, hold_id AS holdId, thread_id AS threadId, kind,
             urgency, title, body, state, snoozed_until_ms AS snoozedUntilMs,
             created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM inbox WHERE home_id = ? ORDER BY created_at_ms DESC LIMIT ?`,
            )
            .all(homeId, capped)
        : this.db
            .prepare(
              `SELECT id, home_id AS homeId, hold_id AS holdId, thread_id AS threadId, kind,
             urgency, title, body, state, snoozed_until_ms AS snoozedUntilMs,
             created_at_ms AS createdAtMs, resolved_at_ms AS resolvedAtMs
             FROM inbox WHERE home_id = ? ORDER BY created_at_ms DESC`,
            )
            .all(homeId)) as InboxItem[];
    return rows;
  }

  countOpenInbox(homeId?: string): number {
    this.resurfaceExpiredSnoozes(homeId);
    const row = (homeId
      ? this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM inbox WHERE home_id = ? AND state = 'open'",
          )
          .get(homeId)
      : this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM inbox WHERE state = 'open'",
          )
          .get()) as { count: number };
    return row.count;
  }

  snoozeInbox(id: string, untilMs: number): void {
    this.db
      .prepare(
        "UPDATE inbox SET state = 'snoozed', snoozed_until_ms = ? WHERE id = ?",
      )
      .run(untilMs, id);
  }

  resolveInbox(id: string): void {
    this.db
      .prepare(
        "UPDATE inbox SET state = 'resolved', resolved_at_ms = ? WHERE id = ?",
      )
      .run(Date.now(), id);
  }

  setLiveness(
    threadId: string,
    homeId: string,
    verdict: string,
    detail?: Record<string, unknown> | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO liveness (thread_id, home_id, verdict, detail_json, probed_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           verdict = excluded.verdict,
           detail_json = excluded.detail_json,
           probed_at_ms = excluded.probed_at_ms`,
      )
      .run(
        threadId,
        homeId,
        verdict,
        detail ? JSON.stringify(detail) : null,
        Date.now(),
      );
  }

  getLiveness(threadId: string): {
    verdict: string;
    probedAtMs: number;
    detail: Record<string, unknown> | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT verdict, probed_at_ms AS probedAtMs, detail_json AS detailJson FROM liveness WHERE thread_id = ?`,
      )
      .get(threadId) as
      | { verdict: string; probedAtMs: number; detailJson: string | null }
      | undefined;
    if (!row) return null;
    return {
      verdict: row.verdict,
      probedAtMs: row.probedAtMs,
      detail: row.detailJson ? JSON.parse(row.detailJson) : null,
    };
  }

  recordDecision(input: {
    homeId: string;
    threadId: string;
    key: string;
    raw: string;
    resolvedAtMs: number;
  }): void {
    const kvKey = `decisions:${input.homeId}`;
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(kvKey) as
      | { value: string }
      | undefined;
    const list: unknown[] = row ? JSON.parse(row.value) : [];
    list.push({
      threadId: input.threadId,
      key: input.key,
      raw: input.raw,
      resolvedAtMs: input.resolvedAtMs,
    });
    this.db
      .prepare(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(kvKey, JSON.stringify(list));
  }

  countUnackedWakes(homeId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM wakes WHERE home_id = ? AND acked = 0",
      )
      .get(homeId) as { c: number };
    return row.c;
  }

  countDeadNodes(homeId: string): number {
    const nodes = this.listNodes(homeId);
    let dead = 0;
    for (const node of nodes) {
      const live = this.getLiveness(node.threadId);
      if (live && (live.verdict === "dead" || live.verdict === "missing")) {
        dead += 1;
      }
    }
    return dead;
  }
}
