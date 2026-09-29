# Firstmate Fleet control plane (BB plugin)

BB-native **Firstmate Fleet** control plane: mate homes, crew threads (ship / scout / secondmate), semantic FSM, liveness, Fleet Inbox, supervision, and a Fleet sidebar panel. Crew work runs as BB child threads with worktree environments instead of external process managers.

**Repository:** [github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane](https://github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane)

| | |
| --- | --- |
| **BB plugin id** | `firstmate-control-plane` |
| **CLI** | `bb fleet` |
| **Panel** | Fleet (sidebar) |

Store listing copy for the BB Community marketplace lives in [`PLUGIN_OVERVIEW.md`](./PLUGIN_OVERVIEW.md). Versioning: [CalVer (Limitless Enterprise)](./docs/VERSIONING.md). Maintainers: see [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) before tagging or submitting.

## Requirements

| Dependency | Version |
| --- | --- |
| [BB](https://github.com/get-bb/bb) | `>= 0.43` (see `package.json` `engines.bb`) |
| `@get-bb/plugin-sdk` | `>= 0.4.104` (dev dependency; resolved at build) |
| Node.js | LTS recommended |
| pnpm | `10.13.1` (pinned via `packageManager` in `package.json`) |
| Firstmate checkout | One git worktree per **mate home** (see [Firstmate integration](#firstmate-integration)) |

Optional CLI tools on mate worktrees after integration apply: `bb`, `jq` (see overlay backend wrap).

## Installation

### From Git (recommended for end users)

After a stable release tag exists (CalVer, for example `v2026.9.0`):

```sh
bb plugin install git:github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane@^2026.9.0 --yes
```

Track `main` before the first tag:

```sh
bb plugin install git:github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane@main --yes
```

BB validates `engines.bb` / `engines.bbPluginSdk`, builds the plugin from source when needed, and records the resolved commit.

### From source (path install, development)

```sh
git clone https://github.com/Limitless-Enterprise/bb-plugin-firstmate-control-plane.git
cd bb-plugin-firstmate-control-plane
pnpm install
bb plugin build .
bb plugin install . --yes
```

Verify:

```sh
bb plugin list | rg firstmate-control-plane
```

Path installs load UI from this repo’s `dist/` after each `bb plugin build .`.

### Reload after updates

```sh
git pull
pnpm install   # when lockfile changed
bb plugin build .
bb plugin reload firstmate-control-plane
```

## Quick start

1. **Bootstrap a mate home** (creates/links Firstmate checkout + primary mate thread):

   ```sh
   bb fleet home bootstrap <homeId> --label "My mate" --parent /path/to/parent-dir
   ```

2. **Apply Firstmate integration** in that checkout (overlay + `bb fleet spawn` routing):

   ```sh
   bb fleet integration apply --mate <homeId>
   bb fleet integration check --mate <homeId>
   ```

3. Open **Fleet** in the BB sidebar (Ship icon). Select your home, use **Tree + Chat**, **Inbox**, or **Board**.

Crew threads are created when the **mate** delegates work (CLI / spawn skill / `bb fleet spawn`); the panel does not include a manual “spawn crew” form.

## Usage

### Fleet panel

Route prefix: plugin panel **`fleet`** (deep links below).

| Area | What it does |
| --- | --- |
| **Tree + Chat** | Mate/crew tree, thread chat, steer; overflow: interrupt, exit, relaunch, detach |
| **Inbox** | Holds, wakes, liveness, stalls, PR signals — resolve, snooze, reply-with-steer |
| **Board** | Columns by FSM state (working, blocked, idle, done, failed) |
| **Homes** | Create/select mate homes |

Deep links (sub-path): `inbox`, `board`, `homes`, `thread/<threadId>`.

### CLI (`bb fleet`)

```sh
# Homes
bb fleet home bootstrap <homeId> --label <label> --parent <dir>
bb fleet home create <homeId> --label <label> --parent <dir> --thread <mateThreadId>

# Crew dispatch (also used by mate integration)
bb fleet spawn --mate <homeId> --role ship|scout|secondmate --label <name> --prompt "<task>"
bb fleet spawn --mate <homeId> --role ship --label auth --prompt "…" --ship-project-id <projectId>
bb fleet spawn --mate <homeId> --batch-file ./crews.json

# Observability
bb fleet tree --mate <homeId>
bb fleet board --mate <homeId>
bb fleet inbox --mate <homeId> [--limit 100]
bb fleet digest --mate <homeId> --tell-cos
bb fleet bearings --mate <homeId>

# Control
bb fleet steer --mate <homeId> --thread <threadId> --text "Continue on the PR feedback"
bb fleet interrupt|exit|relaunch|detach --mate <homeId> --thread <threadId>
bb fleet hold open|list|resolve --mate <homeId> --thread <threadId> ...
bb fleet sweep --mate <homeId>
bb fleet profiles --mate <homeId>

# Integration
bb fleet integration apply --mate <homeId>
bb fleet integration check --mate <homeId>
```

Batch file shape: JSON array of objects with `label`, `role`, `prompt`, and optional `profileId`, `mode`, `yolo`.

### Firstmate integration

After cloning Firstmate for a mate home, the plugin writes a portable overlay under `.bb-integration/` in that checkout so native Firstmate flows can route crew dispatch through `bb fleet spawn` and appear in the Fleet UI.

- Overlay layout: [packages/bb-backend/overlay/README.md](./packages/bb-backend/overlay/README.md)
- Quick start: [integration/README.md](./integration/README.md)

Re-run **`bb fleet integration apply --mate <homeId>`** after upgrading this plugin when overlay files change.

## Development

```sh
pnpm run typecheck
pnpm test                    # unit tests + contract scripts
./scripts/m1-inventory-gate.sh   # full M1 gate (tests + inventory scan)
```

Docs:

- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)
- [docs/CAPABILITY_INVENTORY.md](./docs/CAPABILITY_INVENTORY.md)
- [docs/M1_ACCEPTANCE_MATRIX.md](./docs/M1_ACCEPTANCE_MATRIX.md)
- [contracts/README.md](./contracts/README.md)

Live acceptance (against a real mate home):

```sh
export FM_HOME=/path/to/firstmate-checkout
export MATE=<homeId>
./scripts/m1-ac-full.sh
```

## Architecture (short)

- **Plugin server** (`server.ts`): RPC for panel, SQLite fleet state, background services (supervisor, PR poller, status bridge).
- **Panel** (`app.tsx`): React UI registered on BB `navPanel` slot `fleet`.
- **CLI**: `bb fleet` command registered by the plugin.
- **Overlay**: Optional Firstmate backend wrap under `packages/bb-backend/overlay/` applied into mate checkouts.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

## Contributing

Issues and pull requests are welcome on GitHub. For large changes, open an issue first to align on scope. Run `pnpm test` and `./scripts/m1-inventory-gate.sh` before submitting PRs that touch fleet behavior.
