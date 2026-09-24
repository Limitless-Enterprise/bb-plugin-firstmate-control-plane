# BB Fleet integration (overlay)

This checkout runs inside **BB** as a Firstmate mate home with `config/backend=bb`.
Native Firstmate scripts (`fm-spawn`, `fm-send`, `fm-control`, `fm-teardown`, `fm-watch`)
still work; crews run as BB child threads and appear in the **Fleet** panel.

## Control plane split

| Layer | Owns |
| --- | --- |
| **Firstmate (this checkout)** | Decomposition, ship vs scout, review bars, backlog, briefs, skills |
| **BB Fleet (`bb fleet …`)** | Crew threads, worktree envs, Fleet tree/board/inbox, liveness, wakes |

## Dispatch

Use **`bin/fm-spawn.sh`** as documented in AGENTS.md. Ship/scout crews call
`bb fleet spawn` and write durable `state/<task>.meta` with `backend=bb`.

Unsupported until M3: `--secondmate` (still uses the native backend).

`fm-spawn --relaunch` also uses the native backend. To relaunch a crew on BB
threads, use **`bb fleet relaunch`** or the Fleet panel overflow controls.

## Control

`fm-control interrupt` on `backend=bb` crews uses Escape|C-c (BB `thread stop`). Other
keys are not supported on the bb backend.

After stop, bound threads (non-empty `envId` / `environmentId`) still report
`alive` in `fm_backend_bb_agent_state` when status is `stopped` or `error`, so
interrupt postconditions succeed while the worktree binding persists.

## Teardown

Use **`bin/fm-teardown.sh`** as documented in AGENTS.md.

When integration is enabled and `state/<task>.meta` has `backend=bb`, the wrapper
refuses (exit 2) while `bb fleet hold list` reports open holds on the crew thread,
then skips treehouse pool return (BB owns the worktree env), runs `bb fleet detach`
for the crew thread (must succeed — archives the BB thread; exits non-zero on failure,
skipping native teardown), then runs native teardown. Re-run teardown with meta already
cleared still uses the BB path when `state/<task>.backlog-close` exists or
`config/backend=bb`. If native teardown fails after meta is gone but
`state/<task>.backlog-close` remains, the wrapper clears that marker and exits 0
(ad-hoc scouts often absent from tasks-axi). Other backends (e.g. relaunch crews)
keep the normal treehouse return path.

## Visibility

```sh
bb fleet tree --mate <homeId>
bb fleet board --mate <homeId>
bb fleet inbox --mate <homeId> [--limit 100]
bb fleet digest --mate <homeId>
bb fleet bearings --mate <homeId>
```

`tree` and `board` probe liveness before returning JSON.

The status bridge watches `state/<task-id>.status` on this mate checkout.
Ledger updates: `working:`, `done:` (incl. PR URLs), `failed:`, `blocked:`,
`paused:`, `needs-decision:` (opens holds), and `resolved:`. `note:` lines are
not ingested yet.

## Configuration

Written by the Fleet plugin at apply time:

```json
{
  "enabled": true,
  "homeId": "tech",
  "mateThreadId": "thr_…",
  "version": 3
}
```

To disable BB routing temporarily (pure CLI Firstmate):

```json
{ "enabled": false }
```

## Re-apply overlay

```sh
bb fleet integration apply --mate <homeId>
bb fleet integration check --mate <homeId>
```
