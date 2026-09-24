# M1 acceptance matrix (authoritative)

**Rule:** M1 is complete only when every row in `docs/CAPABILITY_INVENTORY.md` marked **M1 ✓** is **✅** and `scripts/m1-inventory-gate.sh` passes.

The legacy 24-check `scripts/m1-ac-full.sh` remains a **fast smoke** subset; it is not sufficient alone. Smoke check IDs and pass criteria live in that script’s `record` calls (formerly listed in IMPLEMENTATION_PLAN §8).

## Verification kinds

| Kind | Meaning |
|------|---------|
| **live** | `scripts/m1-ac-full.sh` or `m1-ac-live-*` against `tech` mate |
| **unit** | `pnpm test` |
| **lint** | `pnpm run typecheck` + repo linters |
| **doc** | File present and matches behavior |

## Sync (added M1 requirement)

| ID | Capability | Verify |
|----|------------|--------|
| P-SYNC-1 | BB ↔ Fleet close-out (`thread.archived` → registry; `detachCrew` → BB archive) | unit: `fleet-archive-sync.test.ts`; live: archive child thread → node removed; detach → thread archived (not deleted) |

## Inventory traceability

Every **B-***, **P-***, and **U-*** row in `CAPABILITY_INVENTORY.md` with M1 ✓ must be **✅** in the inventory table. Run `./scripts/m1-inventory-gate.sh` before merge to `main`.

## Gate command

```bash
export FM_HOME=…/firstmate-tech
export MATE=tech
pnpm run build && bb plugin install path:$(pwd) --yes
bb fleet integration apply --mate "$MATE"
./scripts/m1-ac-full.sh
./scripts/m1-inventory-gate.sh
```
