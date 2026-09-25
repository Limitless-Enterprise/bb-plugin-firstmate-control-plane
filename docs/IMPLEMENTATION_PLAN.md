# Firstmate × BB — consolidated implementation plan

**Status:** Executing · **Target:** M1 complete · **Updated:** 2026-09-24

## 1. What we are building

Firstmate stays the brain and native control scripts. BB is the runtime backend. The Fleet plugin is the BB-side control plane and operator UI.

| Layer | Package | Role |
|---|---|---|
| **Firstmate (unchanged)** | User's `firstmate-<home>` checkout | AGENTS, skills, backlog, `fm-spawn`, `fm-send`, `fm-control`, `fm-teardown`, `fm-watch`, status verbs |
| **BB backend overlay** | `packages/bb-backend` | `bin/backends/bb.sh` — implements `fm-backend` contract via BB APIs |
| **Fleet plugin** | `packages/control-plane` | Registry, supervision, wakes, holds, inbox, UI, CLI, digest |
| **Contracts** | `contracts/` | Shared schemas: meta, integration config, status verb map |

**Success (M1):** One mate home (`cto`) with `config/backend=bb` runs the full Firstmate workflow on BB threads/worktrees, zero Herdr/tmux on the happy path, and full Fleet UI/CLI for operators and CoS.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Replace Firstmate? | **No** — compose, don't fork brain |
| Runtime | BB child threads + managed worktrees |
| Spawn entry | Native `fm-spawn.sh` → backend `bb` (retire v1 stub) |
| Remotes | **None** on this repo during M1 build |
| Git identity | `git-id` (Office default — no LLE remote) |
| Quality gate | `no-mistakes axi` on feature branches |
| Captain attention | Fleet Inbox — not Command Center inbox |

## 3. Guiding rules

1. Data plane ≠ control plane — steer never does interrupt/exit/relaunch.
2. `done` ≠ `idle` ≠ `unknown`.
3. Semantic busy > native thread idle.
4. Fail-closed teardown — dirty/unlanded worktree refuses destroy.
5. Don't steer into `interaction.pending`.
6. Crews = BB threads + worktrees — no PTY scrape/inject in core path.
7. Liveness: never respawn on `ambiguous`.
8. Do not reimplement Firstmate skills inside the plugin.
9. Mate homes are peers — no cross-home leakage (M2+).
10. Firstmate state files remain authoritative — plugin projects for UI.
11. Plain CLI Firstmate users unchanged when overlay not applied.

## 4. Monorepo structure

```
bb-plugin-firstmate-control-plane/
├── packages/
│   ├── control-plane/     # BB plugin (TS)
│   └── bb-backend/        # Firstmate overlay: bin/backends/bb.sh
├── contracts/             # Shared schemas
├── docs/                  # Plan, inventory, M1 matrix, docs/upstream/ (U1–U3)
└── README.md
```

**Retired (Phase 1):** v1 `integration/bin/fm-spawn.sh` stub — overlay lives in
`packages/bb-backend/overlay/` (version in `lib/apply-firstmate-integration.ts`).

## 5. Milestones

| Milestone | Phases | Proof |
|---|---|---|
| **M1 — Single mate home** | 0–11 | All M1 ✓ inventory rows ✅ + `scripts/m1-inventory-gate.sh` (see §8) |
| **M2 — Multi mate homes** | 12 | Peer `cfo`; isolation |
| **M3 — Lead secondmate** | 13 | Primary → lead → sub-crews per home |
| **M4 — Sign-off** | 14–15 | Checklists; upstream RFC |

## 6. Phases (M1 scope: 0–11)

### Phase 0 — Contracts, monorepo, restructure

- Monorepo layout; move plugin → `packages/control-plane/`
- Extract overlay → `packages/bb-backend/`
- Finalize `contracts/` schemas
- Upstream RFC outline (no core merge)

**Exit:** Repo layout frozen; no schema debates.

### Phase 1 — BB backend MVP

- `bin/backends/bb.sh`: spawn, meta, capture, target_exists, agent_state, send_text_submit, kill
- Hook native `fm-spawn` (not stub)
- Overlay apply wired through plugin
- Retire v1 spawn stub

**Exit:** `fm-spawn` → BB thread in Fleet; `fm-peek` works.

### Phase 2 — Status ledger, wake queue, status bridge

- Ingest `state/<id>.status` verbs
- Wake queue: dedupe, priority, ack
- FSM: idle does not clear working

**Exit:** `working:` survives BB idle until `done:`.

### Phase 3 — Fleet UI core + chrome foundation

- Tree, chat, StatusDot, deep links, settings, realtime, mobile drawer
- Needs-decision strip stub

**Exit:** Mate + 2 crews visible; dots follow FSM.

### Phase 4 — Steer + control verbs

- Steer gates (pending, busy); stall watchdog
- interrupt / exit / relaunch via backend + plugin
- UI composer + overflow controls

**Exit:** Full control-plane demo; steer refused while pending.

### Phase 5 — Holds, decisions, Fleet Inbox

- Decision registry; OPEN DECISIONS fold
- Full Inbox tab, badges, deep links, CLI
- Teardown guard while holds open

**Exit:** Hold → Inbox → resolve clears rail + badge; Reply steers the crew thread
with an operator comment (inbox title/body as context only).

### Phase 6 — Supervisor timers + watch integration

- Stale idle, busy-age, pause resurface, turn-end guard
- Backend event push for `fm-watch`
- Session lock / single-flight supervisor

**Exit:** Turn-end matrix tests pass.

### Phase 7 — Liveness + respawn

- Probe pipeline; reconciliation job
- UI liveness pip; never respawn on ambiguous

**Exit:** Kill agent → dead within probe interval.

### Phase 8 — Profiles, delivery modes, PR/CI

- Dispatch profiles CRUD; spawn override
- PR/CI poller; mode-aware ready parsing
- UI profile picker + row chips

**Exit:** Profile A ship + profile B scout; green CI wake.

### Phase 9 — Digest + status board + nav badges

- `bb fleet digest --tell-cos`
- Status board tab; nav badges

**Exit:** One command → CoS-ready digest.

### Phase 10 — Teardown completion

- Full `fm-teardown` + relaunch on BB substrate
- Orphan sweep

**Exit:** End-to-end ship lifecycle.

### Phase 11 — M1 proof

- Inventory gate + smoke scripts (see §8)
- Zero Herdr/tmux verification
- Fix book-call-funnel visibility if work remains

## 7. Complete capability inventory

See `docs/CAPABILITY_INVENTORY.md` for the full B-* / P-* / U-* item list (all required for M1 program; nothing optional).

## 8. M1 acceptance criteria (inventory authoritative)

M1 is **complete** only when **`docs/CAPABILITY_INVENTORY.md` has zero M1 🔲 or ⚠ rows** and **`scripts/m1-inventory-gate.sh`** passes (`pnpm test` including `scripts/bb-backend-m1-contract.sh` and `scripts/spawn-wrap-m1-contract.sh`, typecheck, inventory scan). Until then, the gate **exits 1** on remaining **M1 ✓** **🔲** rows (expected after batch 5 cleared all **M1 ✓** **⚠** partials).

See **`docs/M1_ACCEPTANCE_MATRIX.md`** for traceability. Fast smoke: **`scripts/m1-ac-full.sh`** (24 checks) — required before merge but not sufficient alone.

## 9. Out of scope (only these)

- Relay/voice integration
- Herdr presentation/focus chrome
- GitLab
- Composer TTY pixel fidelity
- Git remotes on this repo (M1 build)

## 10. References

- `contracts.md` — wire formats (Phase 0)
- `~/.bb/thread-storage/thr_4z7fyfj2kr/analysis/firstmate-fleet-implementation-plan.md`
- `~/.bb/thread-storage/thr_4z7fyfj2kr/analysis/firstmate-bb-signal-catalog.md`
