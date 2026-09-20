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

## Visibility

```sh
bb fleet tree --mate <homeId>
bb fleet inbox --mate <homeId>
bb fleet digest --mate <homeId>
bb fleet bearings --mate <homeId>
```

The status bridge watches `state/<task-id>.status` on this mate checkout.
Ledger updates: `working:`, `done:` (incl. PR URLs), `failed:`, `blocked:`,
`paused:`, and `needs-decision:` (opens holds). `resolved:` and `note:` lines are
not ingested yet.

## Configuration

Written by the Fleet plugin at apply time:

```json
{
  "enabled": true,
  "homeId": "tech",
  "mateThreadId": "thr_…",
  "version": 2
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
