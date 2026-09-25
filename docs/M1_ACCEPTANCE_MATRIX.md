# M1 acceptance matrix (authoritative)

**Rule:** M1 is complete only when every row in `docs/CAPABILITY_INVENTORY.md` marked **M1 ✓** is **✅** and `scripts/m1-inventory-gate.sh` passes.

The legacy 24-check `scripts/m1-ac-full.sh` remains a **fast smoke** subset; it is not sufficient alone. Smoke check IDs and pass criteria live in that script’s `record` calls (formerly listed in IMPLEMENTATION_PLAN §8).

## Verification kinds

| Kind | Meaning |
|------|---------|
| **live** | `scripts/m1-ac-full.sh` or `m1-ac-live-*` against `tech` mate |
| **unit** | `pnpm test` (`lib/*.test.ts` for promoted **M1 ✓** capabilities; `scripts/bb-backend-m1-contract.sh` for overlay B-O8/B-O9/B-O10 fail-closed, B-W4 validate_spawn, B-O1/B-O5/B-O7 with stub `bb`; `scripts/spawn-wrap-m1-contract.sh` for native spawn wraps). Batch 5 closed all **M1 ✓** **⚠** rows (zero partials); gate still exits 1 while **M1 ✓** **🔲** rows remain |
| **lint** | `pnpm run typecheck` + repo linters |
| **doc** | File present and matches behavior |

## Sync (added M1 requirement)

| ID | Capability | Verify |
|----|------------|--------|
| P-SYNC-1 | BB ↔ Fleet close-out (`thread.archived` → registry; `detachCrew` → BB archive) | unit: `fleet-archive-sync.test.ts` (resolve holds; clear inbox incl. snoozed; ack crew- and mate-targeted wakes; detach archives before `deleteNode`, fail-closed on archive error); live: archive child thread → node removed; detach → thread archived (not deleted) |

## Inbox (P-H10)

| ID | Capability | Verify |
|----|------------|--------|
| P-H10 | Snooze / resolve / reply | unit: `inbox-snooze.test.ts` (expired snooze resurface; resolve clears open counts); `fleet-ui.test.ts` `inboxReplySteerText` (non-empty comment required; Subject/Context/Reply sections); doc: [contracts/README.md](../contracts/README.md#fleet-inbox-item) (Reply composer → `steer` RPC) |

## Inventory traceability

Every **B-*** and **P-*** row in `CAPABILITY_INVENTORY.md` with **M1 ✓** must be **✅** in the inventory table before M1 is complete. **`🔲` not-done rows are expected** until those capabilities ship; `./scripts/m1-inventory-gate.sh` fails on any **M1 ✓** **🔲** or **⚠** row. Run it before merge to `main`.

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
