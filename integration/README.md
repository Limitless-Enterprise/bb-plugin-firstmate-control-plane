# Firstmate ↔ BB integration overlay

Portable patch layer installed into a Firstmate checkout by
`firstmate-control-plane`. Keeps upstream Firstmate behavior intact for pure CLI
use; when enabled, routes crew dispatch through BB Fleet.

## Layout (installed under `<checkout>/.bb-integration/`)

```
.bb-integration/
  manifest.json
  bin/
    fm-spawn.sh       # wrapper entry (delegates to native or BB)
    fm-bb-spawn.sh    # BB fleet spawn adapter
    fm-bb-lib.sh      # shared helpers
  native/
    bin/
      fm-spawn.sh     # pristine copy of upstream fm-spawn.sh
docs/bb-integration/
  AGENTS.bb.md        # mate-thread agent instructions
config/
  bb-integration.json # home + mate thread binding
```

## Install

Automatic on `bb fleet home bootstrap` / checkout clone.

Manual:

```sh
bb fleet integration apply --mate tech
```

## Versioning

`manifest.json` records `integrationVersion`. Re-run apply after plugin upgrades.
