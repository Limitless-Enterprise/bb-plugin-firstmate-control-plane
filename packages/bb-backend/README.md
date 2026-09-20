# firstmate-bb-backend

Firstmate overlay package: registers `bb` as a runtime backend so native
`fm-spawn`, `fm-send`, `fm-control`, `fm-teardown`, and `fm-watch` work on BB
threads/worktrees without replacing Firstmate brain scripts.

Installed into a mate checkout by `bb fleet integration apply`.

## Layout

```
bin/backends/bb.sh          # fm-backend adapter
bin/fm-backend-bb-wrap.sh   # Extends fm-backend known list + source dispatch
docs/bb-backend.md          # Operator + adapter contract
docs/AGENTS.bb.md           # Mate-facing integration notes
overlay/                    # Files copied to .bb-integration/
```

## M1 target

Replace the v1 `fm-spawn.sh` stub path with:

1. `config/backend=bb`
2. Native `bin/fm-spawn.sh` unchanged (no stub wrapper)
3. Full `bb.sh` backend implementing capture, spawn hooks, steer, kill, agent_state

See `docs/IMPLEMENTATION_PLAN.md` Phase 1.
