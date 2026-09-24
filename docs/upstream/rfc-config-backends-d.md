# RFC: `config/backends.d/` multi-backend discovery (U1)

**Status:** Draft for upstream Firstmate · **Owner:** Fleet program · **Date:** 2026-09-24

## Problem

Today each mate checkout sets a single `config/backend` file (`bb`, `tmux`, …).
The BB overlay also writes `config/bb-integration.json`. Adding backends requires
copying shell into `bin/backends/` and patching wrappers.

## Proposal

Introduce optional directory `config/backends.d/*.json`:

```json
{
  "id": "bb",
  "enabled": true,
  "adapter": "bin/backends/bb.sh",
  "integration": "config/bb-integration.json"
}
```

`fm-backend-wrap.sh` loads enabled entries in lexicographic order; explicit
`config/backend` remains the selected default (no auto-detect).

## Non-goals (M1)

- Hot-reload without mate restart
- Cross-backend crew in one home

## Fleet impact

Overlay apply continues to pin `config/backend=bb` and integration JSON.
This RFC documents the upstream shape Fleet will target in M4 sign-off.

## Acceptance (inventory U1)

This file satisfies U1 deliverable for the M1 program parallel track.
