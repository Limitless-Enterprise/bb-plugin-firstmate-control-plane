# BB Fleet integration (overlay)

This checkout runs inside **BB** as a Firstmate mate home with `config/backend=bb`.
Native Firstmate scripts (`fm-spawn`, `fm-send`, `fm-control`, `fm-teardown`, `fm-watch`)
still work; crews run as BB child threads and appear in the **Fleet** panel.

## Dispatch

Use **`bin/fm-spawn.sh`** as documented in AGENTS.md. Ship/scout crews call
`bb fleet spawn` and write durable `state/<task>.meta` with `backend=bb`.

Unsupported until M3: `--secondmate`. Use native path for `--relaunch` today.

## Visibility

```sh
bb fleet tree --mate <homeId>
bb fleet inbox --mate <homeId>
bb fleet digest --mate <homeId>
```

## Re-apply overlay

```sh
bb fleet integration apply --mate <homeId>
bb fleet integration check --mate <homeId>
```
