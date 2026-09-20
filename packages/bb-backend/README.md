# firstmate-bb-backend

Firstmate overlay package: registers `bb` as a runtime backend so native
`fm-spawn`, `fm-send`, `fm-control`, `fm-teardown`, and `fm-watch` work on BB
threads/worktrees without replacing Firstmate brain scripts.

Installed into a mate checkout by `bb fleet integration apply` (see
`lib/apply-firstmate-integration.ts`).

## Source layout

```
overlay/
  AGENTS.bb.md              # Copied to docs/bb-integration/ on apply
  README.md                 # Copied to docs/bb-integration/ on apply
  bin/
    fm-bb-lib.sh            # Shared helpers
    fm-bb-spawn.sh          # BB fleet spawn adapter
    fm-spawn-wrap.sh        # Installed as bin/fm-spawn.sh
    fm-backend-wrap.sh      # Installed as bin/fm-backend.sh
    backends/bb.sh          # fm-backend adapter (also bin/backends/bb.sh)
```

## Installed layout (mate checkout)

See [overlay/README.md](./overlay/README.md) for the full post-apply tree.

## M1 target

Replace the v1 `integration/bin/fm-spawn.sh` stub with:

1. `config/backend=bb`
2. Native `bin/fm-spawn.sh` backed up under `.bb-integration/native/` and replaced by the wrapper
3. Full `bb.sh` backend implementing capture, spawn hooks, steer, kill, agent_state

See `docs/IMPLEMENTATION_PLAN.md` Phase 1.
