# Checkpoint: Sync Bug Fixes Sprint
**Date:** 2025-02-15
**Phase:** Completed 8 fixes, deployed 3 times (pending deploy for latest 2 fixes)

## Completed
- [x] Windows sync failure fix (commit `edb615b`)
- [x] Bug 1: Broadcast "txn-already-known" handling (commit `c95bc2e`)
- [x] Bug 2: Lock unlock fallback with spent-check (commit `c95bc2e`)
- [x] Bug 3: Transaction labels account_id scoping + migration 018 (commit `c95bc2e`)
- [x] Bug 4: Account discovery gap limit 2 + identity address check (commit `c95bc2e`)
- [x] Unlock tx showing fee instead of amount → `amount = totalOutput` (commit `f4bdc08`)
- [x] Ordinals bleeding across accounts → isCancelled guard in fetchData (commit `40dca65`)
- [x] Duplicate lock on Locks tab → deduplication in detectLockedUtxos + React key fix
- [x] Lock fee display mismatch → LockModal now estimates actual input count for fee

## Key Files Modified This Sprint
- `src/infrastructure/api/broadcastService.ts` — txn-already-known detection
- `src/services/wallet/locks.ts` — unlock broadcast fallback + detectLockedUtxos dedup
- `src-tauri/migrations/018_transaction_labels_account.sql` — NEW migration
- `src-tauri/src/lib.rs` — migration 018 registration
- `src-tauri/migrations/fresh_install_schema.sql` — schema update
- `src/services/database/txRepository.ts` — label scoping by account_id
- `src/services/accountDiscovery.ts` — gap limit 2 + identity address
- `src/services/sync.ts` — unlock amount = totalOutput
- `src/contexts/SyncContext.tsx` — isCancelled guard, always-set ordinals
- `src/contexts/WalletContext.tsx` — pass isCancelled callback
- `src/components/tabs/LocksTab.tsx` — React key fix (txid:vout)
- `src/components/modals/LockModal.tsx` — accurate fee estimate with UTXO-based input count

## Critical Lessons Learned
1. Migration checksums are immutable — NEVER modify applied migrations
2. No DML in standalone Tauri migrations (causes hangs), but INSERT...SELECT in table recreation works
3. Race conditions in fetchData can cause cross-account data bleeding — need version guards on ALL state setters
4. `calculateTxAmount()` computes received-spent which gives negative fee for unlocks — must override with totalOutput
5. WoC API can return same txid twice in history (mempool + confirmed) — always deduplicate by txid:vout
6. React list keys must include ALL parts of the unique identifier (txid:vout, not just txid)
7. Fee estimate UI must match actual UTXO selection logic — hardcoding numInputs=1 misleads users

## Next Steps
- Deploy and test the duplicate lock + fee display fixes
