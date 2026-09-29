# Fleet control plane

Use `bb fleet` to manage Firstmate mate homes, crews, holds, and inbox.

## Register a mate home

```sh
bb fleet home bootstrap cto --label CTO --parent /workspace/Codes
```

## Spawn crew (worktree child thread)

Crews are spawned by the mate thread (`fm-spawn` → `bb fleet spawn`) or by operators
via CLI — not from a Fleet panel spawn form. Spawns use mate default provider/model
and home dispatch profiles (`--profile`); partial profiles merge with mate defaults.

```sh
bb fleet spawn --mate cto --role ship --label auth --prompt "Ship the auth fix"
bb fleet spawn --mate cto --role ship --label auth --prompt "…" --ship-project-id proj-ship
```

## Lead secondmate (M3)

```sh
bb fleet secondmate create --mate cto --thread <threadId> --label platform-lead
```

## Operations

- `bb fleet tree --mate cto` — fleet tree (live liveness probes)
- `bb fleet board --mate cto` — FSM lanes board (live liveness probes)
- `bb fleet steer --mate cto --thread <id> --text "..."` — data-plane steer
- `bb fleet interrupt|exit|relaunch|detach --mate cto --thread <id>` — control plane
  (`interrupt`/`exit` pin liveness dead; see contracts/README.md)
- `bb fleet inbox --mate cto [--limit 100]` — Captain inbox (JSON: items, totalOpen, limit; max --limit 500)
- `bb fleet hold open|list|resolve --mate cto [--thread <id>]` — holds (list JSON: `{ holds, openCount }`)
- `bb fleet sweep --mate cto` — remove orphan registry nodes
- `bb fleet profiles --mate cto` — dispatch profiles CRUD
- `bb fleet digest --mate cto --tell-cos` — CoS digest
- `bb fleet bearings --mate cto` — CoS bearings snapshot
- `bb fleet integration apply|check --mate cto` — overlay install/verify

Open the **Fleet** panel in BB for tree + chat (mobile tree toggle; mate-dispatch
guidance when the tree is empty), inbox (resolve, snooze, Reply composer with
required steer comment — see
[contracts/README.md](../../contracts/README.md#fleet-inbox-item)), status board, and
crew overflow controls.
