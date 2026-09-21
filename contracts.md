# Firstmate Fleet — wire contracts (Phase 0)

**Plugin id:** `firstmate-control-plane`  
**CLI prefix:** `bb fleet`  
**Panel:** Fleet (`/plugins/firstmate-control-plane/fleet`)

## Mate home

```ts
{
  homeId: string;           // slug: cto, cfo
  label: string;            // display: CTO, CFO
  checkoutPath: string;     // absolute path to Firstmate checkout (firstmate-<homeId> under parent)
  primaryMateId: string;    // registry node id
  mateThreadId: string;     // BB thread id
  defaultProfileId: string | null;
  createdAtMs: number;
}
```

## Registry node (primary | secondmate | crew)

```ts
{
  id: string;
  homeId: string;
  kind: "primary" | "secondmate" | "crew";
  parentId: string | null;  // secondmate → primary; crew → primary or secondmate
  threadId: string;
  label: string;
  role: "ship" | "scout" | null;  // crews only
  envId: string | null;
  deliveryMode: "no-mistakes" | "direct-PR" | "local-only";
  yolo: boolean;
  dispatchProfileId: string | null;
  createdAtMs: number;
}
```

## Dispatch profile

```ts
{
  id: string;
  homeId: string;
  label: string;
  providerId: string | null;
  model: string | null;
  effort: string | null;
  taskClasses: string[];
}
```

## Status ledger entry (append-only)

```ts
{
  id: string;
  homeId: string;
  threadId: string;
  verb: string;             // mark.working, mark.blocked, mark.done, native.idle, ...
  fsmState: FsmState;
  detail: Record<string, unknown> | null;
  createdAtMs: number;
}
```

## FSM states

`starting | working | blocked | idle | done | unknown | stopped | error`

Projection rules:
- Semantic `working` is not cleared by native `idle` alone.
- `done` ≠ `idle` ≠ `unknown`.

## Wake queue record

```ts
{
  id: string;
  homeId: string;
  threadId: string | null;
  targetMateId: string | null;
  reason: string;
  priority: number;
  dedupeKey: string | null;
  acked: boolean;
  createdAtMs: number;
}
```

## Liveness verdict

See [contracts/README.md](./contracts/README.md#liveness-verdict) (authoritative).

## Hold

```ts
{
  id: string;
  homeId: string;
  mateId: string;
  threadId: string;
  title: string;
  body: string;
  urgency: "low" | "normal" | "high";
  state: "open" | "resolved";
  createdAtMs: number;
  resolvedAtMs: number | null;
}
```

## Fleet inbox item

```ts
{
  id: string;
  homeId: string;
  holdId: string | null;
  threadId: string;
  kind: "hold" | "wake" | "liveness" | "stall";
  urgency: "low" | "normal" | "high";
  title: string;
  body: string;
  state: "open" | "snoozed" | "resolved";
  snoozedUntilMs: number | null;
  createdAtMs: number;
  resolvedAtMs: number | null;
}
```

## Delivery modes + yolo

- `deliveryMode`: orthogonal to `yolo: boolean`.
- Enforced on spawn; ready projector varies by mode.

## CoS notification

See [contracts/README.md](./contracts/README.md#cos-notification) for CLI
surfaces (tree, board, inbox, digest, bearings). Captain attention via **Fleet
Inbox** only — not Command Center inbox.

## Isolation

Every RPC enforces `homeId`. Cross-home reads/writes fail closed.

## Firstmate checkout overlay

**Authoritative copy:** [contracts/README.md](./contracts/README.md) (this file is
migrating to `contracts/`). See also
[packages/bb-backend/overlay/README.md](./packages/bb-backend/overlay/README.md)
for the installed file tree.
