# Fleet control plane

Use `bb fleet` to manage Firstmate mate homes, crews, holds, and inbox.

## Register a mate home

```sh
bb fleet home bootstrap cto --label CTO --parent /workspace/Codes
```

## Spawn crew (worktree child thread)

```sh
bb fleet spawn --mate cto --role ship --label auth --prompt "Ship the auth fix"
```

## Lead secondmate (M3)

```sh
bb fleet secondmate create --mate cto --thread <threadId> --label platform-lead
```

## Operations

- `bb fleet tree --mate cto` — fleet tree
- `bb fleet steer --mate cto --thread <id> --text "..."` — data-plane steer
- `bb fleet interrupt|exit --mate cto --thread <id>` — control plane
- `bb fleet inbox --mate cto` — Captain inbox
- `bb fleet digest --mate cto --tell-cos` — CoS digest

Open the **Fleet** panel in BB for tree + chat, inbox, and status board.
