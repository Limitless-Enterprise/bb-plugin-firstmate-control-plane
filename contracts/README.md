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

## Fleet tree node (UI / RPC projection)

`bb fleet tree --json` and plugin RPCs return registry nodes plus live projection
fields. Crew nodes may include display chips derived from ledger and dispatch
profiles:

```ts
{
  // …registry node fields…
  fsmState: FsmState;
  liveness: LivenessVerdict | null;
  depth: number;
  children: TreeNode[];
  prUrl?: string | null;       // latest done: PR link from status ledger
  profileLabel?: string | null; // dispatch profile label when set
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

## Crew spawn (`bb fleet spawn`)

- The Fleet panel does not expose a manual spawn form; an empty tree shows
  mate-dispatch guidance. Crews appear when the mate checkout runs native
  `fm-spawn` (overlay → `bb fleet spawn`) or when an operator uses CLI.
- `threads.spawn` uses mate default `providerId` and `model` from plugin settings
  when no profile applies. `--profile <id>` selects a home dispatch profile;
  model-only or provider-only profiles merge with mate defaults (not full substitution).
- `--ship-project-id <bbProjectId>` sets the BB project for the crew thread, stores
  `fleet.crewProjectId.<threadId>` in plugin KV, and `bb fleet relaunch` reuses that
  project for the replacement spawn.
- `--mode`, `--yolo`, and `--batch-file` behave as in README CLI examples.

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

CLI: `bb fleet hold open --mate <homeId> --thread <id> --title … --body …`
(enqueues mate wake + Fleet Inbox item); `bb fleet hold list [--mate <homeId>] [--thread <id>] [--json]`
returns `{ holds, openCount }`; `bb fleet hold resolve <id> [--mate <homeId>]`.
Resolving the last open hold on a thread appends `mark.idle` and clears blocked FSM.

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

**Fleet panel Inbox (P-H10):** **Resolve** and **Snooze** call `resolveInbox` /
`snoozeInbox` RPCs. **Reply** opens an inline composer; the operator must enter a
non-empty steer comment (title and body are not sent alone). Submit builds steer
text via `lib/fleet-ui.ts` `inboxReplySteerText` (`Subject:` / `Context:` from the
item, then `Reply:` with the comment) and calls the `steer` RPC for the item’s
`threadId`. Empty or whitespace-only comments do not steer. Per-item drafts persist
while switching rows; the composer stays open until steer succeeds or shows an error.

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
- Holds via `bb fleet hold open|list|resolve` (see [Hold](#hold)).
- Orphan cleanup via `bb fleet sweep [--mate <homeId>] [--json]` — `{ removed, skipped }`;
  removes registry crew nodes whose BB thread is archived (or missing with safe
  meta), including stale nodes left after detach, when no open holds block removal.
- Dispatch profiles via `bb fleet profiles --mate <homeId>`.
- Captain attention via **Fleet Inbox** only — not Command Center inbox.

**Fleet panel RPCs** (see `contract.ts`): `fleetSnapshot` returns
`{ digest, bearings, generatedAtMs }` for a home; `fleetNavCounts` returns
`{ inbox, wakes, dead }` for sidebar badges when scoped to a home. `inboxBadge`:
with a selected home, returns `count` / `wakes` / `dead` from `fleetNavCounts`
for that home; with no home selected, sums those three fields from
`fleetNavCounts` across every registered home. **Mate thread reset** (Tree UI only,
no CLI): `resetMateThreadPreflight` returns `{ allowed, openChildren, mateThreadId,
mateLabel }` after checking BB archive state for each non-primary node (legacy
`legacy:*` thread ids are ignored; `threads.get` failure fail-closes as blocking).
`resetMateThread` spawns the replacement mate, stops/archives the previous mate
thread (idempotent when the previous mate is already archived), applies integration
on the new thread, then updates the home; rejects when `openChildren` is
non-empty. Integration or home-update failures after the previous mate is archived
roll back the spawned thread and leave the home on the previous mate id until retry
succeeds.

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
refuses (exit 2) while `bb fleet hold list` reports `openCount > 0` for the crew
thread, then skips treehouse pool return, runs `bb fleet detach` (must succeed —
archives the BB thread; aborts teardown on failure), and runs native teardown.
Teardown details: `packages/bb-backend/overlay/AGENTS.bb.md`. If native
teardown fails after meta is cleared but `state/<task>.backlog-close` remains (ad-hoc scouts
absent from tasks-axi), the wrapper removes the marker and exits 0. `fm-spawn --relaunch` and
`--secondmate` still use native Firstmate backends; crew relaunch on BB threads is
via `bb fleet relaunch` or Fleet UI controls. Status bridge resolves mate
registry and environment checkout paths (`lib/mate-checkout-paths.ts`), scans each
`state/<id>.status` for `working:`, `done:`, `failed:`,
`blocked:`, `paused:`, `needs-decision:`, `resolved:`, and `note:` (`note:` appends
`crew.note` ledger entries; other prefixes map per `lib/status-verbs.ts`). Each
scan also runs `syncCrewsFromStateMeta` (B-S9): register missing ship/scout crews
from `state/<id>.meta`, skipping meta with `fleet_detached=1` and skipping when
the linked BB crew thread is archived. Close-out stamps `fleet_detached=1` on task
meta before registry removal (`detachCrew` before BB archive; BB archive sync
before `deleteNode`) so stale meta cannot resurrect nodes.
PR poller watches GitHub checks and PR lifecycle (review, commits, merge retire).

**GitHub webhook (P-P7):** `POST /github/webhook` on the plugin HTTP server.
Configure `githubWebhookSecret` in Fleet settings. When non-empty, requests must
include matching `X-Fleet-Webhook-Secret`; when empty, BB plugin token auth applies
(route auth is `none`; handler enforces one of these). Valid GitHub PR event JSON
(`pull_request.html_url`) enqueues mate wakes only for homes that have a crew whose
ledger includes a matching `pr.opened` URL. Dedupe keys are home-scoped
(`webhook:<homeId>:<action>:<prUrl>`).

Pure CLI use: set `enabled: false` or use a checkout without the overlay.

See `packages/bb-backend/overlay/README.md` for the installed file tree.

## Plugin settings (Fleet panel)

| Setting | Default | Floor |
|---|---|---|
| `probeIntervalSec` | 10 | 5 |
| `statusBridgeIntervalSec` | 3 | 2 |
| `busyAgeSec` | 900 | 60 |
| `staleIdleSec` | 1800 | 60 |
| `maxCrewConcurrency` | 6 | 1 |
| `githubWebhookSecret` | (empty) | — |
| `autoRespawn` | false | — |

Status bridge scans `state/*.status` on every resolved mate checkout path on this
interval; liveness probes
run on `probeIntervalSec`. The `fleet-supervisor` background service holds a
session lock (`fleet.supervisor.lock`), probes threads each cycle, and enqueues
busy-age stall / stale-idle wakes using ledger semantics (semantic blocked and
terminal states suppress spurious wakes; `turn.failed` does not override them).
