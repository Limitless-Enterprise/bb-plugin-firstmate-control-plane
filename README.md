# bb-plugin-firstmate-control-plane

BB-native Firstmate Fleet control plane. Replaces Herdr/tmux semantics with BB child threads, worktree environments, semantic FSM, liveness probes, Fleet Inbox, and multi Mate homes.

## Install

```sh
cd /workspace/Codes/bb-plugin-firstmate-control-plane
pnpm install
bb plugin install .
```

## CLI

```sh
bb fleet home bootstrap cto --label CTO --parent /workspace/Codes
bb fleet home create cto --label CTO --parent /workspace/Codes --thread <mateThreadId>
bb fleet spawn --mate cto --role ship --label auth --prompt "Ship the auth fix"
bb fleet tree --mate cto
bb fleet board --mate cto
bb fleet inbox --mate cto [--limit 100]
bb fleet digest --mate cto --tell-cos
bb fleet bearings --mate cto
bb fleet steer --mate cto --thread <threadId> --text "Continue on the PR feedback"
bb fleet interrupt|exit|relaunch|detach --mate cto --thread <threadId>
bb fleet integration apply --mate cto
bb fleet integration check --mate cto
```

## Panel

Open **Fleet** in the BB sidebar: home switcher, tree + ThreadChat (mobile tree toggle),
Inbox, status board, and crew overflow controls (interrupt, exit, relaunch, detach).

## Implementation plan

See [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) and [docs/CAPABILITY_INVENTORY.md](./docs/CAPABILITY_INVENTORY.md).

## Contracts

See [contracts/README.md](./contracts/README.md) (also [contracts.md](./contracts.md) at repo root during migration).

## Firstmate BB integration overlay

After cloning Firstmate for a mate home, the plugin applies a portable overlay under
`.bb-integration/` in the checkout. This keeps native Firstmate CLI behavior while
routing crew dispatch through `bb fleet spawn` so workers appear in the Fleet UI.

```sh
bb fleet integration apply --mate tech
bb fleet integration check --mate tech
```

See [packages/bb-backend/overlay/README.md](./packages/bb-backend/overlay/README.md)
(install layout) and [integration/README.md](./integration/README.md) (quick start).
