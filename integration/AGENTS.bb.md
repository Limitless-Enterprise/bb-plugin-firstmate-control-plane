# BB Fleet integration (overlay)

This checkout runs inside **BB** as a Firstmate mate home. The native Firstmate CLI
still works; when `config/bb-integration.json` is enabled, crew dispatch is routed
through the BB Fleet control plane so workers appear in the **Fleet** panel.

## Control plane split

| Layer | Owns |
| --- | --- |
| **Firstmate (this checkout)** | Decomposition, ship vs scout, review bars, backlog, briefs, skills |
| **BB Fleet (`bb fleet …`)** | Crew threads, worktree envs, Fleet tree/board/inbox, liveness, wakes |

## Dispatch (crews)

Keep using **`bin/fm-spawn.sh`** exactly as AGENTS.md describes.

When BB integration is enabled, the wrapper transparently calls
`bb fleet spawn` instead of tmux/herdr/treehouse. You do **not** need a separate
command for normal ship/scout dispatch.

Unsupported modes still use native Firstmate backends:

- `--relaunch`
- `--secondmate`
- batch spawns

## Visibility

After dispatch, crews appear under your mate home in:

- Fleet → **Tree + Chat**
- Fleet → **Board**
- BB thread list (child threads)

Status lines written to `state/<task-id>.status` still work. BB thread lifecycle
events also update the fleet ledger.

## Configuration

Written by the Fleet plugin at apply time:

```json
{
  "enabled": true,
  "homeId": "tech",
  "mateThreadId": "thr_…",
  "version": "1"
}
```

To disable BB routing temporarily (pure CLI Firstmate):

```json
{ "enabled": false }
```

## Troubleshooting

```sh
bb fleet tree --mate <homeId>
bb fleet status --mate <homeId>
cat config/bb-integration.json
```

Re-apply the overlay after upgrading the Fleet plugin:

```sh
bb fleet integration apply --mate <homeId>
```
