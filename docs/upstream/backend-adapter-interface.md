# Backend adapter interface (U2)

**Status:** Frozen reference for overlay authors · **Date:** 2026-09-24

Adapters are bash libraries sourced from `bin/backends/<name>.sh` implementing
the native `fm-backend` contract used by `fm-backend-wrap.sh`.

## Required functions (M1 BB path)

| Function | Purpose |
|----------|---------|
| `fm_backend_bb_validate_spawn` | Preconditions before `fm-spawn` |
| `fm_backend_bb_capture` | `fm-peek` output |
| `fm_backend_bb_send_text_submit` | `fm-send` / steer injection |
| `fm_backend_bb_send_key` | Interrupt keys (Escape/C-c → `bb thread stop`) |
| `fm_backend_bb_kill` | Hard stop |
| `fm_backend_bb_target_exists` | Spawn / relaunch guards |
| `fm_backend_bb_agent_state` / `_alive` | Liveness for control scripts |
| `fm_backend_bb_busy_state` | Semantic busy probe |
| `fm_backend_bb_composer_state` | May return `unknown` on BB |
| `fm_backend_bb_visible_capture` | Fail-closed (no viewport) |
| `fm_backend_bb_has_push` / `_wait_transition` / commit helpers | Fail-closed on BB |

Reference implementation: `packages/bb-backend/overlay/bin/backends/bb.sh`.

## Versioning

Overlay version is pinned in `config/bb-integration.json` and checked by
`bb fleet integration check`.

## Acceptance (inventory U2)

This document satisfies U2 for the M1 program parallel track. Executable
fail-closed checks for BB adapter arms run via `scripts/bb-backend-m1-contract.sh`
(as part of `pnpm test`).
