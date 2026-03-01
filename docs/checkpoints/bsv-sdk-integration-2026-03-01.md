# Checkpoint: BSV SDK Rust Integration
**Date:** 2026-03-01
**Phase:** Phase 3.3b in progress — 24/36 TS files migrated

## Completed
- [x] Phase 1: Foundation — SDK dependency + adapter + 16 comparison tests
- [x] Phase 2: Replace Rust crypto internals with SDK (~870 lines removed)
  - transaction.rs: 884->300 lines, uses SDK Transaction builder
  - brc100_signing.rs: 446->200 lines, uses SDK adapter for sign/verify/ECIES
  - key_derivation.rs: 404->360 lines, uses SDK for WIF/pubkey/address conversion
  - Moved ripemd to dev-deps; kept secp256k1 (ECDH) and bs58 (WIF validation)
- [x] Phase 3.1: Audit JS @bsv/sdk usage — 34 files with imports mapped
- [x] Phase 3.2: Create new Tauri commands — 71 Rust tests pass
  - New module: `brc42_derivation.rs` with 10 Tauri commands + 16 tests
  - Commands: derive_child_key, get_derived_addresses, find_derived_key_for_address, derive_tagged_key, validate_bsv_address, p2pkh_script_hex, pubkey_to_address, pubkey_to_hash160, sha256_hash, sha256_hash_bytes
  - 4 key_store `_from_store` variants: derive_child_key_from_store, get_derived_addresses_from_store, find_derived_key_from_store, derive_tagged_key_from_store
  - New adapter functions: sdk_derive_child_key, sdk_derive_child_pubkey, sdk_pubkey_to_address, sdk_validate_address
- [x] Phase 3.3a: Migrate keyDerivation.ts callers (6 files, 40 TS errors fixed)
  - useWalletSend.ts, transactions.ts, ReceiveModal.tsx, SettingsAdvanced.tsx, handlers.ts
  - keyDerivation.test.ts rewritten (22 tests), transactions.test.ts + ReceiveModal.test.tsx updated
- [x] Phase 3.3b partial: 24 of 36 TS files migrated from @bsv/sdk
  - validation.ts: Pure-JS Base58Check + validate_bsv_address Tauri command
  - keyDerivation.ts: All functions now delegate to Tauri commands
  - cryptography.ts, signing.ts: Already Tauri-delegated, imports cleaned
  - App.tsx: startPaymentListenerFromWif wrapper
  - lockQueries.ts: pubkey_to_hash160 Tauri command
  - timelockScript.ts: asmToHex() pure-JS BSV script compiler, CompiledScript interface
  - SignMessageModal.tsx: sign_message/verify_signature Tauri commands
  - certificates.ts/test: Tauri-delegated signing/verification
  - inscribe.ts, marketplace.ts: Stubbed with "not yet available" errors
  - overlay.ts, wocClient.ts, addressSync.ts, historySync.ts: Imports cleaned

## In Progress
- [ ] Phase 3.3b: Migrate remaining 12 @bsv/sdk files

## Remaining 12 Files
1. `src/services/wallet/transactions.test.ts` — Transaction type in mock
2. `src/services/wallet/ordinals.ts` — PrivateKey, P2PKH, Transaction, Script
3. `src/services/wallet/lockUnlocking.ts` — complex @bsv/sdk usage
4. `src/services/wallet/lockCreation.ts` — PrivateKey, P2PKH, etc
5. `src/services/tokens/transfers.ts` — Transaction, PrivateKey, P2PKH, Script
6. `src/services/brc100/locks.ts` — PrivateKey, P2PKH, Transaction
7. `src/services/brc100/script.ts` — LockingScript
8. `src/services/brc100/formatting.ts` — PrivateKey, P2PKH, Transaction
9. `src/services/backupRecovery.ts` — PrivateKey, P2PKH, Transaction
10. `src/domain/wallet/keyDerivation.ts` — HD, Mnemonic, PrivateKey
11. `src/domain/transaction/builder.test.ts` — PrivateKey, P2PKH
12. `src/domain/transaction/builder.ts` — PrivateKey, P2PKH, Transaction

## Pending
- [ ] Phase 3.4: Remove @bsv/sdk, js-1sat-ord from package.json
- [ ] Phase 3.5: Verify all tests pass (npm run typecheck + lint + test:run)
- [ ] Phase 4: Add new capabilities (SPV, auth, tokens, marketplace)

## Current Verification State
- TypeScript: 0 errors (`npx tsc -p tsconfig.app.json --noEmit`)
- Tests: 1723 passing across 71 test files
- Dev server: App renders correctly (Tauri-specific errors expected in browser)
- Rust: 71 tests pass

## Key Architecture Decisions
- SDK uses BRC-42/43 (not BIP-32/39/44) — bip32/bip39 Rust crates kept for HD derivation
- SDK git dependency pinned to rev 4f2f9ce2016d9e3dbbfa9829d58180fb13429742
- ECDH still uses secp256k1 crate (centralized in sdk_ecdh_shared_key adapter fn)
- bsv-sdk-rust's PrivateKey::derive_child matches @bsv/sdk's JS implementation
- TransactionLike interface replaces @bsv/sdk Transaction type in TS
- CompiledScript interface replaces @bsv/sdk Script type
- asmToHex() pure-JS compiler replaces Script.fromASM()
- pubkey_to_hash160 Tauri command replaces PublicKey.toHash()

## Files Modified (Rust)
- `src-tauri/Cargo.toml` — SDK dependency added
- `src-tauri/src/bsv_sdk_adapter.rs` — Central adapter (~680 lines)
- `src-tauri/src/brc42_derivation.rs` — NEW: BRC-42/43 commands (~400 lines)
- `src-tauri/src/transaction.rs` — Rewritten with SDK Transaction builder
- `src-tauri/src/brc100_signing.rs` — Rewritten with SDK adapter
- `src-tauri/src/key_derivation.rs` — Partial replacement (crypto helpers)
- `src-tauri/src/key_store.rs` — Added 4 _from_store BRC-42 commands
- `src-tauri/src/lib.rs` — Registered all new commands

## Next Steps
1. Migrate remaining 12 TS files (transaction builders are core — many depend on builder.ts)
2. Key strategy: builder.ts constructs @bsv/sdk Transaction objects — replace with Tauri command
3. For lock/token/brc100 files — stub complex SDK tx construction, delegate to Rust
4. domain/wallet/keyDerivation.ts — remove JS fallback path
5. Remove @bsv/sdk + js-1sat-ord from package.json
6. Run full verification suite
