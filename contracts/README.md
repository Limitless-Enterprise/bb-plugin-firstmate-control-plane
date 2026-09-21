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

`alive | dead | missing | ambiguous`

Never auto-respawn on `ambiguous`.

`bb fleet interrupt` and `bb fleet exit` pin liveness `dead` with
`detail.controlStop: true`. While pinned, probes stay `dead` (including SDK
`idle` with a bound `environmentId`, probe errors, and stale `active`/`running`
reads) until relaunch or detach clears the thread. The fleet supervisor skips
liveness inbox items when `controlStop` is set.

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

- Digest via `bb fleet digest [--mate <homeId>] [--tell-cos]`.
- Bearings snapshot via `bb fleet bearings [--mate <homeId>] [--json]` (digest +
  open holds, unacked wakes, tracked PR links).
- Fleet tree via `bb fleet tree [--mate <homeId>] [--json]` (probes liveness before build).
- Status board via `bb fleet board [--mate <homeId>] [--json]` (FSM lanes; probes liveness).
- Captain inbox via `bb fleet inbox [--mate <homeId>] [--json] [--limit N]` — JSON
  `{ items, totalOpen, limit }`; default limit 100, max 500.
- Captain attention via **Fleet Inbox** only — not Command Center inbox.

## Isolation

Every RPC enforces `homeId`. Cross-home reads/writes fail closed.

## Firstmate checkout overlay

After clone/bootstrap, the plugin applies overlay **v3** from `packages/bb-backend/overlay/`:

- Backs up native `bin/fm-spawn.sh`, `bin/fm-backend.sh`, and `bin/fm-teardown.sh`
  under `.bb-integration/native/` (creates `fm-backend-native.sh` alias at apply)
- Installs wrappers as `bin/fm-spawn.sh`, `bin/fm-backend.sh`, and `bin/fm-teardown.sh`
- Copies adapter scripts (including `treehouse` shim) into `.bb-integration/bin/`
  and `bin/backends/bb.sh`
- Patches `bin/fm-control-lib.sh` so `fm-control interrupt` on `backend=bb` crews
  accepts Escape|C-c (maps to `bb thread stop`)
- Writes `config/backend` (`bb`) and `config/bb-integration.json` with
  `{ enabled, homeId, mateThreadId, version, appliedAtMs }`
- Copies `docs/bb-integration/AGENTS.bb.md` for mate-thread instructions

When `enabled: true`, ship/scout spawns call `bb fleet spawn` and register crew nodes.
For crews with `backend=bb` in task meta (or re-run teardown when meta is already
gone but `state/<task>.backlog-close` or `config/backend=bb` indicates BB), `fm-teardown`
skips treehouse pool return, detaches the BB thread, then runs native teardown. If native
teardown fails after meta is cleared but `state/<task>.backlog-close` remains (ad-hoc scouts
absent from tasks-axi), the wrapper removes the marker and exits 0. `fm-spawn --relaunch` and
`--secondmate` still use native Firstmate backends; crew relaunch on BB threads is
via `bb fleet relaunch` or Fleet UI controls. Status bridge
watches `<mate-checkout>/state/<id>.status` for `working:`, `done:`, `failed:`,
`blocked:`, `paused:`, and `needs-decision:` (`resolved:` / `note:` not yet).
PR poller watches GitHub checks.

Pure CLI use: set `enabled: false` or use a checkout without the overlay.

See `packages/bb-backend/overlay/README.md` for the installed file tree.

## Plugin settings (Fleet panel)

| Setting | Default | Floor |
|---|---|---|
| `probeIntervalSec` | 10 | 5 |
| `statusBridgeIntervalSec` | 3 | 2 |

Status bridge scans mate checkout `state/*.status` on this interval; liveness probes
run on `probeIntervalSec`.
