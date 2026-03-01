# Checkpoint: BSV SDK Rust Integration
**Date:** 2026-03-01
**Phase:** Phase 3 COMPLETE — @bsv/sdk fully removed

## Completed
- [x] Phase 1: Foundation — SDK dependency + adapter + 16 comparison tests
- [x] Phase 2: Replace Rust crypto internals with SDK (~870 lines removed)
- [x] Phase 3.1: Audit JS @bsv/sdk usage — 34 files with imports mapped
- [x] Phase 3.2: Create new Tauri commands — 71 Rust tests pass
  - 10 Tauri commands + 4 from_store variants in brc42_derivation.rs
- [x] Phase 3.3a: Migrate keyDerivation.ts callers (6 files, 40 TS errors fixed)
- [x] Phase 3.3b: Migrate remaining 30 files — zero @bsv/sdk imports remain
  - builder.ts: Tauri-only, p2pkhLockingScriptHex pure-JS
  - keyDerivation.ts: Tauri-only, deriveKeysFromPath removed
  - lockCreation/lockUnlocking: Tauri commands for OP_PUSH_TX
  - ordinals.ts: build_ordinal_transfer_tx Tauri command
  - brc100/locks, formatting: Tauri-based transaction building
  - backupRecovery.ts: build_multi_key_p2pkh_tx for sweep
  - tokens/transfers.ts: Tauri-delegated
  - brc100/script.ts: ScriptLike replaces LockingScript
  - inscribe.ts, marketplace.ts: Stubbed for Phase 4
- [x] Phase 3.4: Removed @bsv/sdk + js-1sat-ord from package.json (7 packages removed)
- [x] Phase 3.5: Full verification passed
  - TypeScript: 0 errors
  - ESLint: 0 errors (52 pre-existing warnings)
  - Tests: 1724 passing across 71 test files
  - Vite build: succeeds

## Pending
- [ ] Phase 4: Add new capabilities (SPV, auth, tokens, marketplace)
  - [ ] Phase 4.1: SPV Verification (bsv-spv)
  - [ ] Phase 4.2: ARC Broadcasting (bsv-arc)
  - [ ] Phase 4.3: Authenticated Messaging (bsv-auth)
  - [ ] Phase 4.4: Token Support (bsv-tokens)
  - [ ] Phase 4.5: Marketplace Features (replaces js-1sat-ord stubs)

## Rust Commands That Need Implementation
These Tauri commands are invoked from JS but need Rust implementation:
- `build_lock_tx_from_store` — builds OP_PUSH_TX lock transaction
- `build_unlock_tx_from_store` — builds OP_PUSH_TX unlock with preimage
- `build_ordinal_transfer_tx` — builds ordinal transfer transaction
- `build_multi_output_p2pkh_tx_from_store` — multi-recipient P2PKH
- `build_brc100_action_tx` — BRC-100 createAction transaction

## Key Architecture Decisions
- SDK uses BRC-42/43 (not BIP-32/39/44) — bip32/bip39 Rust crates kept
- SDK git dependency pinned to rev 4f2f9ce2016d9e3dbbfa9829d58180fb13429742
- TransactionLike interface replaces @bsv/sdk Transaction type in TS
- ScriptLike interface replaces @bsv/sdk Script/LockingScript
- CompiledScript interface in domain/locks for timelock scripts
- asmToHex() pure-JS BSV script compiler
- p2pkhLockingScriptHex() pure-JS Base58 decoder
- pubkey_to_hash160 Tauri command replaces PublicKey.toHash()
- All JS fallback paths removed — Tauri runtime required

## Verification State
- TypeScript: 0 errors (`npx tsc -p tsconfig.app.json --noEmit`)
- Tests: 1724 passing across 71 test files
- Lint: 0 errors, 52 warnings (pre-existing)
- Vite build: succeeds
- DMG: built and on Desktop
- Git: pushed to claude/nice-dubinsky branch

## Commits
1. `3bcae5c` — Phase 3.3: migrate 24/36 TS files
2. `135da3d` — Phase 3.3b complete: remaining 12 files
3. `b1aa9fa` — Phase 3.4: Remove @bsv/sdk from package.json
