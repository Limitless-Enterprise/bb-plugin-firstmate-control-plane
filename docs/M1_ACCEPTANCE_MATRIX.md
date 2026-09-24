# M1 acceptance matrix (authoritative)

**Rule:** M1 is complete only when every row in `docs/CAPABILITY_INVENTORY.md` marked **M1 ✓** is **✅** and `scripts/m1-inventory-gate.sh` passes.

The legacy 24-check `scripts/m1-ac-full.sh` remains a **fast smoke** subset; it is not sufficient alone. Smoke check IDs and pass criteria live in that script’s `record` calls (formerly listed in IMPLEMENTATION_PLAN §8).

## Verification kinds

| Kind | Meaning |
|------|---------|
| **live** | `scripts/m1-ac-full.sh` or `m1-ac-live-*` against `tech` mate |
| **unit** | `pnpm test` (`lib/*.test.ts` + `scripts/bb-backend-m1-contract.sh` for overlay B-O8/B-O9/B-O10 fail-closed). Partial-row evidence (still ⚠ in inventory): P-R7 `mate-checkout-paths.test.ts`; B-ST2 `status-verbs.test.ts` + `status-bridge.test.ts`; P-P2/P-P3 `pr-poller.test.ts` (helpers only until poller behavior tests land) |
| **lint** | `pnpm run typecheck` + repo linters |
| **doc** | File present and matches behavior |

## Sync (added M1 requirement)

| ID | Capability | Verify |
|----|------------|--------|
| P-SYNC-1 | BB ↔ Fleet close-out (`thread.archived` → registry; `detachCrew` → BB archive) | unit: `fleet-archive-sync.test.ts` (resolve holds; clear inbox incl. snoozed; ack crew- and mate-targeted wakes; detach archives before `deleteNode`, fail-closed on archive error); live: archive child thread → node removed; detach → thread archived (not deleted) |

## Inventory traceability

Every **B-*** and **P-*** row in `CAPABILITY_INVENTORY.md` with **M1 ✓** must be **✅** in the inventory table. Run `./scripts/m1-inventory-gate.sh` before merge to `main`.

**Integrity:** Do not mark **M1 ✓** inventory rows ✅ without executable evidence
(unit test, `scripts/m1-ac-full.sh` check, or live mate verification). Doc-only
promotion fails review. Upstream parallel **U1–U3** (see inventory §Upstream
proposal) are doc deliverables only — paths under `docs/upstream/`.

## Gate command

```bash
export FM_HOME=…/firstmate-tech
export MATE=tech
pnpm run build && bb plugin install path:$(pwd) --yes
bb fleet integration apply --mate "$MATE"
./scripts/m1-ac-full.sh
./scripts/m1-inventory-gate.sh
```
