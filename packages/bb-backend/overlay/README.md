# BB integration overlay files

Source files installed into a Firstmate mate checkout by
`bb fleet integration apply` (`lib/apply-firstmate-integration.ts`,
integration version **2**).

## Installed layout

```
.bb-integration/
  manifest.json
  bin/
    fm-bb-lib.sh
    fm-bb-spawn.sh
    fm-spawn-wrap.sh
    fm-backend-wrap.sh
    backends/bb.sh
  native/
    bin/
      fm-spawn.sh          # pristine upstream backup
      fm-backend.sh        # pristine upstream backup
bin/
  fm-spawn.sh              # → fm-spawn-wrap.sh (when backend=bb)
  fm-backend.sh            # → fm-backend-wrap.sh (adds bb backend)
  backends/bb.sh           # bb adapter copy
config/
  backend                  # "bb"
  bb-integration.json      # { enabled, homeId, mateThreadId, version, appliedAtMs }
docs/bb-integration/
  AGENTS.bb.md             # mate-thread agent instructions
  README.md                # this file
```

Re-run `bb fleet integration apply --mate <homeId>` after plugin upgrades.
`bb fleet integration check --mate <homeId>` validates the installed tree.
