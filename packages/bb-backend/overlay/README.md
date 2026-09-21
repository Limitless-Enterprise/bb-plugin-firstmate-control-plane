# BB integration overlay files

Source files installed into a Firstmate mate checkout by
`bb fleet integration apply` (`lib/apply-firstmate-integration.ts`,
integration version **3**).

## Installed layout

```
.bb-integration/
  manifest.json
  bin/
    fm-bb-lib.sh
    fm-bb-spawn.sh
    fm-spawn-wrap.sh
    fm-backend-wrap.sh
    fm-teardown-wrap.sh
    treehouse              # shim: skip pool return for backend=bb teardown
    backends/bb.sh
  native/
    bin/
      fm-spawn.sh              # pristine upstream backup
      fm-backend.sh            # pristine upstream backup
      fm-backend-native.sh     # alias of fm-backend backup (apply creates if missing)
      fm-teardown.sh           # pristine upstream backup
bin/
  fm-spawn.sh              # → fm-spawn-wrap.sh (when backend=bb)
  fm-backend.sh            # → fm-backend-wrap.sh (adds bb backend)
  fm-teardown.sh           # → fm-teardown-wrap.sh (BB-aware treehouse skip)
  backends/bb.sh           # bb adapter copy
bin/fm-control-lib.sh      # patched at apply: bb backend Escape|C-c interrupt
config/
  backend                  # "bb"
  bb-integration.json      # { enabled, homeId, mateThreadId, version, appliedAtMs }
docs/bb-integration/
  AGENTS.bb.md             # mate-thread agent instructions
  README.md                # this file
```

Re-run `bb fleet integration apply --mate <homeId>` after plugin upgrades.
`bb fleet integration check --mate <homeId>` validates the installed tree.
