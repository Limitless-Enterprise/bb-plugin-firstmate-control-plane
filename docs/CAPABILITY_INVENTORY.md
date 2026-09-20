# Capability inventory — all required for M1 program

Nothing in this list is optional for the full program. M1 completes items through Phase 11; M2/M3 add §Multi-home and §Secondmate.

**Legend:** ✅ done · 🔲 not done · ⚠ partial

---

## BB backend overlay (`packages/bb-backend`)

### Wiring & meta

| ID | Capability | M1 | Status |
|---|---|---|---|
| B-W1 | Register `bb` in fm-backend | ✓ | 🔲 |
| B-W2 | `config/backend=bb` when fleet home active | ✓ | ⚠ |
| B-W3 | Required tools: bb, jq | ✓ | 🔲 |
| B-W4 | validate_spawn → fleet home + bb-integration.json | ✓ | 🔲 |
| B-W5 | Explicit-only backend (no auto-detect) | ✓ | 🔲 |
| B-W6 | Meta schema (bb_thread_id, bb_env_id, window, worktree) | ✓ | ⚠ |
| B-W7 | validate_task_endpoint BB arm | ✓ | 🔲 |
| B-W8 | docs/bb-backend.md + AGENTS.bb.md | ✓ | ⚠ |
| B-W9 | Apply to canonical + mate worktree | ✓ | ✅ |
| B-W10 | Version pin overlay ↔ plugin | ✓ | 🔲 |

### Spawn (native fm-spawn)

| ID | Capability | M1 | Status |
|---|---|---|---|
| B-S1 | Full native spawn pipeline | ✓ | 🔲 |
| B-S2 | bb fleet spawn → thread + worktree | ✓ | ⚠ |
| B-S3 | Launch brief in BB thread | ✓ | ⚠ |
| B-S4 | Delivery mode + yolo passthrough | ✓ | 🔲 |
| B-S5 | Dispatch profile passthrough | ✓ | 🔲 |
| B-S6 | --relaunch | ✓ | 🔲 |
| B-S7 | --secondmate | M3 | 🔲 |
| B-S8 | Batch spawn | ✓ | 🔲 |
| B-S9 | Project registration / fleet sync | ✓ | 🔲 |

### fm-backend ops

| ID | Op | M1 | Status |
|---|---|---|---|
| B-O1 | capture | ✓ | 🔲 |
| B-O2 | target_exists | ✓ | 🔲 |
| B-O3 | agent_state / agent_alive | ✓ | 🔲 |
| B-O4 | send_text_submit | ✓ | 🔲 |
| B-O5 | send_key | ✓ | 🔲 |
| B-O6 | kill | ✓ | 🔲 |
| B-O7 | busy_state | ✓ | 🔲 |
| B-O8 | composer_state (proxy) | ✓ | 🔲 |
| B-O9 | visible_capture (fail-closed) | ✓ | 🔲 |
| B-O10 | has_push / wait_transition | ✓ | 🔲 |
| B-O11 | commit/clear_transition | ✓ | 🔲 |

### Control & teardown

| ID | Capability | M1 | Status |
|---|---|---|---|
| B-C1 | fm-control interrupt | ✓ | ⚠ |
| B-C2 | fm-control exit | ✓ | ⚠ |
| B-C3 | fm-control relaunch | ✓ | 🔲 |
| B-C4 | fm-teardown full path | ✓ | 🔲 |
| B-C5 | Teardown refused (holds/dirty) | ✓ | 🔲 |
| B-C6 | Backlog done (native) | ✓ | ✅ |

### Status bridge

| ID | Capability | M1 | Status |
|---|---|---|---|
| B-ST1 | Ingest state/<id>.status | ✓ | 🔲 |
| B-ST2 | All status verbs | ✓ | 🔲 |
| B-ST3 | OPEN DECISIONS fold | ✓ | 🔲 |
| B-ST4 | Status vs backlog divergence | ✓ | 🔲 |
| B-ST5 | PR ready lines → poller | ✓ | 🔲 |
| B-ST6 | Mate wake on terminal states | ✓ | 🔲 |

---

## Fleet plugin (`packages/control-plane`)

### Registry & integration

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-R1 | Mate home registry | ✓ | ✅ |
| P-R2 | Crew attach on spawn | ✓ | ⚠ |
| P-R3 | kind tree (primary/secondmate/crew) | ✓ | ⚠ |
| P-R4 | homeId isolation | ✓ | ✅ |
| P-R5 | integration apply/check | ✓ | ✅ |
| P-R6 | Bootstrap auto-apply | ✓ | ✅ |
| P-R7 | Project/repo binding | ✓ | 🔲 |
| P-R8 | Orphan sweep | ✓ | 🔲 |

### Spawn & dispatch

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-D1 | fleet spawn API | ✓ | ✅ |
| P-D2 | Parent thread linkage | ✓ | ✅ |
| P-D3 | Dispatch profiles CRUD | ✓ | 🔲 |
| P-D4 | Default profile per home | ✓ | 🔲 |
| P-D5 | Per-crew profile override | ✓ | 🔲 |
| P-D6 | Delivery mode + yolo on spawn | ✓ | ⚠ |
| P-D7 | CLI profiles + --profile | ✓ | 🔲 |
| P-D8 | Max concurrency / dispatch wait | ✓ | 🔲 |

### Status ledger & FSM

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-L1 | Append-only ledger | ✓ | ✅ |
| P-L2 | FSM projector | ✓ | ⚠ |
| P-L3 | Ingest Firstmate status verbs | ✓ | 🔲 |
| P-L4 | bb fleet mark | ✓ | ✅ |
| P-L5 | thread.* → wakes | ✓ | ⚠ |
| P-L6 | Unread status cursor | ✓ | 🔲 |
| P-L7 | RECORD DIVERGENCE | ✓ | 🔲 |
| P-L8 | Progress-only touch | ✓ | 🔲 |

### Wake queue & supervisor

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-W1 | Durable wake queue + dedupe | ✓ | 🔲 |
| P-W2 | Priority ordering | ✓ | 🔲 |
| P-W3 | Ack/nack + ack-through | ✓ | 🔲 |
| P-W4 | Actionable vs absorb triage | ✓ | 🔲 |
| P-W5 | Stale idle detector | ✓ | 🔲 |
| P-W6 | Busy-age bound | ✓ | 🔲 |
| P-W7 | Pause resurface | ✓ | 🔲 |
| P-W8 | Turn-end guard | ✓ | 🔲 |
| P-W9 | Wedge escalation | ✓ | 🔲 |
| P-W10 | Worktree mtime deferral | ✓ | 🔲 |
| P-W11 | Supervisor service + beacon | ✓ | ⚠ |
| P-W12 | Supervisor dead alarm | ✓ | 🔲 |
| P-W13 | Session lock / single-flight | ✓ | 🔲 |
| P-W14 | Stale lock reclaim | ✓ | 🔲 |
| P-W15 | Away posture | ✓ | 🔲 |
| P-W16 | Return brief | ✓ | 🔲 |
| P-W17 | Startup inactive scan | ✓ | 🔲 |
| P-W18 | Instruction refresh after compact | ✓ | 🔲 |
| P-W19 | Check-kind wakes | ✓ | 🔲 |
| P-W20 | Recovery episode generation | ✓ | 🔲 |

### Liveness & respawn

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-V1 | bb fleet probe / liveness | ✓ | ⚠ |
| P-V2 | Verdicts alive/dead/missing/ambiguous | ✓ | ⚠ |
| P-V3 | Full probe pipeline | ✓ | 🔲 |
| P-V4 | Desync reconciliation | ✓ | 🔲 |
| P-V5 | Never respawn ambiguous | ✓ | ✅ |
| P-V6 | Auto-respawn dead/missing | ✓ | 🔲 |
| P-V7 | Respawn respects holds/dirty | ✓ | 🔲 |
| P-V8 | Idempotent respawn keys | ✓ | 🔲 |
| P-V9 | Teardown identity proof | ✓ | 🔲 |

### Steering & control

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-S1 | bb fleet steer | ✓ | ⚠ |
| P-S2 | Block on interaction.pending | ✓ | 🔲 |
| P-S3 | Steer queue while busy | ✓ | 🔲 |
| P-S4 | Wait-until-ready | ✓ | 🔲 |
| P-S5 | Submit unconfirmed retry | ✓ | 🔲 |
| P-S6 | Post-steer stall watchdog | ✓ | 🔲 |
| P-S7 | interrupt / exit / relaunch | ✓ | ⚠ |
| P-S8 | Durable steering inbox | ✓ | 🔲 |
| P-S9 | Doorbell / nudge | ✓ | 🔲 |
| P-S10 | Captain attach events | ✓ | 🔲 |

### Holds, decisions, inbox

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-H1 | Holds open/resolve | ✓ | ⚠ |
| P-H2 | Decision registry | ✓ | 🔲 |
| P-H3 | Wake mate on hold | ✓ | 🔲 |
| P-H4 | Teardown guard holds | ✓ | 🔲 |
| P-H5 | Captain-hold lifecycle | ✓ | 🔲 |
| P-H6 | Deliverable parked on hold | ✓ | 🔲 |
| P-H7 | Authority escalation → CoS | ✓ | 🔲 |
| P-H8 | Fleet Inbox tab | ✓ | ⚠ |
| P-H9 | Inbox filters | ✓ | 🔲 |
| P-H10 | Snooze / resolve / reply | ✓ | ⚠ |
| P-H11 | Deep links /fleet/inbox | ✓ | 🔲 |
| P-H12 | Nav badge inbox count | ✓ | 🔲 |
| P-H13 | CLI inbox | ✓ | ⚠ |
| P-H14 | Needs-decision rail strip | ✓ | 🔲 |

### PR / CI

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-P1 | Parse done: PR | ✓ | 🔲 |
| P-P2 | PR/CI poller | ✓ | 🔲 |
| P-P3 | Checks pending/green/failed wakes | ✓ | 🔲 |
| P-P4 | Mode-aware ready | ✓ | 🔲 |
| P-P5 | Merge outcome retire poll | ✓ | 🔲 |
| P-P6 | Held for merge | ✓ | 🔲 |
| P-P7 | GitHub webhook route | ✓ | 🔲 |
| P-P8 | Commits pushed detection | ✓ | 🔲 |
| P-P9 | Review requested / changes requested | ✓ | 🔲 |

### Fleet UI chrome

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-U1 | Tree + ThreadChat | ✓ | ✅ |
| P-U2 | Status board tab | ✓ | ⚠ |
| P-U3 | StatusDot ← FSM | ✓ | ✅ |
| P-U4 | Liveness pip | ✓ | 🔲 |
| P-U5 | Mode + profile + PR chips | ✓ | 🔲 |
| P-U6 | Ship/scout badges | ✓ | ⚠ |
| P-U7 | Deep link /fleet/<threadId> | ✓ | ✅ |
| P-U8 | Mobile drawer | ✓ | 🔲 |
| P-U9 | Realtime refresh | ✓ | ⚠ |
| P-U10 | Fleet settings | ✓ | ⚠ |
| P-U11 | Spawn UI profile picker | ✓ | 🔲 |
| P-U12 | Overflow interrupt/exit/relaunch | ✓ | 🔲 |
| P-U13 | Composer steer in panel | ✓ | 🔲 |
| P-U14 | Nav badges (inbox/wakes/dead) | ✓ | 🔲 |
| P-U15 | Home switcher | M2 | ⚠ |
| P-U16 | Unified cross-home inbox | M2 | 🔲 |
| P-U17 | Secondmate indent tree | M3 | 🔲 |
| P-U18 | Homes panel | ✓ | ✅ |

### CoS / digest

| ID | Capability | M1 | Status |
|---|---|---|---|
| P-C1 | bb fleet digest | ✓ | ⚠ |
| P-C2 | bb fleet bearings | ✓ | 🔲 |
| P-C3 | Full digest builder | ✓ | 🔲 |
| P-C4 | CoS notify mate down | ✓ | 🔲 |
| P-C5 | Fleet snapshot API | ✓ | 🔲 |

---

## Multi-home (M2)

P-M1–P-M4, P-U15–P-U16 — see implementation plan Phase 12.

## Lead secondmate (M3)

P-M5–P-M8, B-S7, P-U17 — see Phase 13.

## Upstream proposal (parallel)

| ID | Deliverable | Status |
|---|---|---|
| U1 | RFC: config/backends.d/ | 🔲 |
| U2 | Backend adapter interface doc | 🔲 |
| U3 | Extension manifest capability | 🔲 |
| U4 | No BB code in Firstmate core | ✅ policy |

---

## Signal catalog mapping

Sections A–K of `firstmate-bb-signal-catalog.md` map to B-* and P-* IDs above. Explicit out-of-scope: Relay/voice (I1–I2), Herdr focus (H8–H9), GitLab (K19), unbounded turn-end churn (D10).
