# Extension manifest capability (U3)

**Status:** Draft · **Date:** 2026-09-24

## Goal

Allow BB plugins (Fleet control plane) to declare capabilities consumed by
Firstmate overlays without forking core scripts.

## Proposed manifest fragment

```json
{
  "firstmate": {
    "fleet": {
      "homeId": "tech",
      "integrationVersion": 3,
      "capabilities": [
        "spawn",
        "steer",
        "holds",
        "liveness",
        "digest"
      ]
    }
  }
}
```

BB plugin `plugin.json` would expose this block; overlay apply verifies
`integrationVersion` matches `lib/apply-firstmate-integration.ts`.

## M1 behavior

Fleet plugin ships the manifest implicitly via `bb fleet integration apply`.
Formal upstream schema merge is deferred to M4; this doc captures the contract
Fleet already implements.

## Acceptance (inventory U3)

This file satisfies U3 deliverable for the M1 program parallel track.
