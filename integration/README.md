# Firstmate ↔ BB integration overlay

**Authoritative docs:** [packages/bb-backend/README.md](../packages/bb-backend/README.md)
and [packages/bb-backend/overlay/README.md](../packages/bb-backend/overlay/README.md).

The plugin applies overlay v2 from `packages/bb-backend/overlay/` via
`bb fleet integration apply`. The `integration/bin/` scripts here are the
retired v1 stub reference only — do not install them manually.

## Quick start

```sh
bb fleet integration apply --mate tech
bb fleet integration check --mate tech
```

Automatic on `bb fleet home bootstrap` / checkout clone.
