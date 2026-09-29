## Run a mate-led fleet inside BB

Use **Fleet** to register **mate homes** (Firstmate checkouts), watch crew threads move through a semantic state machine, triage **Fleet Inbox** (holds, wakes, liveness, stalls, PR signals), and steer or relaunch work from the sidebar panel or `bb fleet` CLI.

## What you get

- **Mate homes** — bootstrap or attach a Firstmate worktree per home; switch homes from the Fleet header.
- **Crew tree + chat** — ship, scout, and secondmate child threads with status dots, thread chat, and overflow actions (interrupt, exit, relaunch, detach).
- **Inbox** — filter by kind, resolve, snooze, or reply with a required steer comment.
- **Board** — columns by FSM state (working, blocked, idle, done, failed).
- **CLI** — `bb fleet spawn`, `steer`, `digest`, `integration apply`, holds, sweep, and related commands.

Crew threads are created when the mate delegates work (including via the Firstmate integration overlay); the panel does not expose a manual spawn form.

## How it works

The plugin registers a **Fleet** nav panel, a `bb fleet` command tree, background services (supervisor, PR poller, status bridge), and SQLite-backed fleet state. Applying **Firstmate integration** copies a portable overlay into each mate checkout under `.bb-integration/` so native Firstmate dispatch can route through `bb fleet spawn` and appear in the tree.

## Requirements

- **BB** `>= 0.43` and a compatible `@get-bb/plugin-sdk` (see `engines` in `package.json`).
- **Firstmate** — a git checkout per mate home; run `bb fleet integration apply --mate <homeId>` after install or upgrade.
- **Optional on mate worktrees** — `bb` and `jq` on PATH for overlay backend wrap (documented in the overlay README).
- **GitHub** — PR poller features need reachable GitHub metadata for linked PRs; other fleet features work without it.

Install from Git using CalVer tags (`vYYYY.MM.MICRO`) or a local path; the install pipeline runs `bb plugin build` for git sources when needed. See [docs/VERSIONING.md](./docs/VERSIONING.md).
