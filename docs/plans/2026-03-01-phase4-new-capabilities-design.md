# Phase 4: New Capabilities — BSV SDK Rust Integration

**Date:** 2026-03-01
**Status:** Approved
**Prerequisite:** Phase 3 complete — @bsv/sdk fully removed

## Goal

Implement missing Rust transaction builders (4 broken commands), then add SPV verification, ARC broadcasting, proper inscription/token outputs, marketplace OrdinalLock, and authenticated messaging.

## Execution Order

| Step | Module | SDK Crate | Async? | Scope |
|------|--------|-----------|--------|-------|
| 4.0 | Fix broken commands | bsv-transaction | No | 4 commands in transaction.rs + key_store.rs |
| 4.1 | SPV Verification | bsv-spv | No | New spv.rs, 3 Tauri commands |
| 4.2 | ARC Broadcasting | bsv-arc | Yes (tokio) | New arc_broadcaster.rs, replace JS cascade |
| 4.3 | Inscription Builder | bsv-script | No | Extend transaction.rs, 2 Tauri commands |
| 4.4 | Marketplace | bsv-script | No | New ordinals.rs, 3 Tauri commands |
| 4.5 | Auth Messaging | bsv-auth + bsv-wallet | No (core) | New auth.rs, 3 Tauri commands |

## Phase 4.0: Fix Broken Commands

These 4 commands are invoked from TypeScript but have no Rust implementation.

### build_lock_tx_from_store

- **Called from:** `lockCreation.ts:168`
- **Params:** `selectedUtxos`, `lockSatoshis`, `timelockScriptHex`, `changeAddress`, `changeSatoshis`, `opReturnHex`
- **Builds:** Transaction with custom CLTV locking script output + optional OP_RETURN + P2PKH change
- **Signing:** Single key from store (wallet key)
- **Implementation:** In `transaction.rs` as `build_lock_tx()`, with `_from_store` variant in `key_store.rs`

### build_unlock_tx_from_store

- **Called from:** `lockUnlocking.ts:84`
- **Params:** `lockedTxid`, `lockedVout`, `lockedSatoshis`, `lockingScriptHex`, `unlockBlock`, `toAddress`, `outputSatoshis`
- **Builds:** OP_PUSH_TX unlock transaction — spends CLTV-locked UTXO after block height reached
- **Signing:** Wallet key, constructs sighash preimage for OP_PUSH_TX verification
- **Key complexity:** Must compute BIP-143 sighash preimage and include it in the unlocking script for OP_PUSH_TX
- **Implementation:** In `transaction.rs` as `build_unlock_tx()`, with `_from_store` variant

### build_ordinal_transfer_tx

- **Called from:** `ordinals.ts:287`
- **Params:** `ordWif`, `ordinalUtxo` (1-sat ordinal), `toAddress`, `fundingWif`, `fundingUtxos`
- **Returns:** `{ rawTx, txid, fee, change, spentOutpoints }`
- **Builds:** 2-input transaction: ordinal UTXO (signed with ordWif) + funding UTXOs (signed with fundingWif)
- **Output order:** ordinal output (1 sat to recipient) at vout 0, change at vout 1
- **Implementation:** In `transaction.rs` as `build_ordinal_transfer_tx()`

### build_multi_output_p2pkh_tx_from_store

- **Called from:** `builder.ts:435`
- **Params:** `outputs[]` (array of `{address, satoshis}`), `selectedUtxos`, `totalInput`, `feeRate`
- **Builds:** Single-key transaction with multiple P2PKH outputs
- **Implementation:** In `transaction.rs` as `build_multi_output_p2pkh_tx()`, with `_from_store` variant

## Phase 4.1: SPV Verification

**New file:** `src-tauri/src/spv.rs`
**SDK crate:** `bsv_sdk::spv` (MerklePath, Beef, ChainTracker trait)

### ChainTracker Implementation

```rust
struct WocChainTracker {
    client: reqwest::blocking::Client,
}

impl ChainTracker for WocChainTracker {
    fn is_valid_root_for_height(&self, root: &Hash, height: u32) -> Result<bool, SpvError> {
        // Fetch block header from WoC: /block/height/{height}/header
        // Compare merkle root in header with provided root
    }
    fn current_height(&self) -> Result<u32, SpvError> {
        // GET /chain/info → tip_height
    }
}
```

### Tauri Commands

- `verify_merkle_path(hex: String, txid: String)` → `{ root: String, valid: bool }`
- `parse_beef(hex: String)` → `{ version: u32, txids: Vec<String>, valid: bool }`
- `verify_beef(hex: String)` → `{ valid: bool, txids: Vec<String> }`

### Integration Points

- Incoming BRC-100 transactions can include BEEF envelopes
- `sync/` pipeline can verify Merkle proofs for incoming UTXOs
- ARC broadcasting (Phase 4.2) can submit BEEF format

## Phase 4.2: ARC Broadcasting

**New file:** `src-tauri/src/arc_broadcaster.rs`
**SDK crate:** `bsv_sdk::arc` (ArcClient, ArcConfig)

### Design

Replace the 300-line TypeScript broadcast cascade (`broadcastService.ts`) with a single Rust command.

```rust
struct BroadcastService {
    arc_client: ArcClient,    // Primary: GorillaPool ARC
    woc_fallback: WocClient,  // Fallback: WhatsOnChain
}
```

### ARC Configuration

```rust
ArcConfig {
    base_url: "https://arc.gorillapool.io/v1".into(),
    api_key: None,  // GorillaPool doesn't require one
    wait_for_status: Some(ArcStatus::SeenOnNetwork),
    skip_script_validation: false,
    ..Default::default()
}
```

### Tauri Commands

- `broadcast_transaction(raw_hex: String)` → `{ txid: String, status: String }`
  - Try ARC first, fall back to WoC on failure
  - Detect "txn-already-known" as success (existing behavior)
  - Return sanitized errors (no endpoint URLs exposed)

### Migration

- Remove `src/infrastructure/api/broadcastService.ts`
- Update all JS callers to use `tauriInvoke('broadcast_transaction', { rawHex })`
- Keep WoC client for non-broadcast operations (UTXOs, tx history, block height)

## Phase 4.3: BSV-20/21 Inscription Builder

**Extend:** `src-tauri/src/transaction.rs`
**SDK crate:** `bsv_sdk::script` (for OP codes), `bsv_sdk::transaction`

### Inscription Output Format

BSV-20/21 tokens use 1Sat Ordinal inscription outputs:

```
OP_FALSE OP_IF
  OP_PUSH "ord"
  OP_1 <content-type>    // e.g., "application/bsv-20"
  OP_0 <content>         // JSON: {"p":"bsv-20","op":"transfer","tick":"TICK","amt":"100"}
OP_ENDIF
OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG
```

### Tauri Commands

- `build_inscription_tx(content: Vec<u8>, content_type: String, dest_address: String, funding_utxos: Vec<UtxoInput>, wif: String, fee_rate: f64)` → `{ rawTx, txid }`
  - 1-sat inscription output + change output
  - Used by `inscribe.ts`

- `build_token_transfer_tx(token_utxos: Vec<UtxoInput>, recipient: String, amount: String, ticker: String, protocol: String, funding_utxos: Vec<UtxoInput>, token_wif: String, funding_wif: String, change_address: String)` → `{ rawTx, txid }`
  - Creates BSV-20 transfer inscription: `{"p":"bsv-20","op":"transfer","tick":"...","amt":"..."}`
  - Token change inscription if partial spend
  - Funding change P2PKH output

### Migration

- `inscribe.ts`: Remove stub, call `build_inscription_tx` via Tauri
- `transfers.ts`: Replace `build_multi_key_p2pkh_tx` workaround with `build_token_transfer_tx`

## Phase 4.4: Marketplace — OrdinalLock Contract

**New file:** `src-tauri/src/ordinals.rs`
**SDK crate:** `bsv_sdk::script`, `bsv_sdk::transaction`

### OrdinalLock Contract

The OrdinalLock is an sCrypt contract that locks an ordinal for sale:

```
// Locking Script (simplified):
// Buyer can spend by providing:
//   1. Payment to seller's address (>= price)
//   2. Ordinal output to buyer's ordAddress
// OR seller can cancel by signing with their key
```

The exact contract bytecode must match js-1sat-ord's OrdinalLock for ecosystem compatibility. We'll extract the contract template hex from the js-1sat-ord source and embed it in Rust.

### Tauri Commands

- `create_ordinal_listing(ord_wif, ordinal_utxo, pay_address, ord_address, price_sats, funding_utxos, payment_wif)` → `{ rawTx, txid }`
- `cancel_ordinal_listing(ord_wif, listing_utxo, payment_wif, payment_utxos)` → `{ rawTx, txid }`
- `purchase_ordinal(payment_wif, payment_utxos, ord_address, listing_utxo, payout, price_sats)` → `{ rawTx, txid }`

### Migration

- `marketplace.ts`: Remove stubs, call Tauri commands
- `marketplace.test.ts`: Update tests from "throws not yet available" to mock Tauri invoke

## Phase 4.5: Authenticated Messaging

**New file:** `src-tauri/src/auth.rs`
**SDK crate:** `bsv_sdk::auth` (Peer, AuthMessage), `bsv_sdk::wallet` (ProtoWallet)

### Design

```rust
struct AuthState {
    peer: Arc<Peer>,
}

// Custom transport for BRC-100 HTTP communication
struct HttpTransport {
    base_url: String,
    client: reqwest::Client,
}

impl Transport for HttpTransport {
    fn send(&self, message: &AuthMessage) -> Result<(), AuthError> {
        // POST to peer's BRC-100 endpoint
    }
    fn on_data(&self, callback: OnDataCallback) -> Result<(), AuthError> {
        // Register callback for incoming messages (via http_server.rs)
    }
}
```

### Tauri Commands

- `auth_create_session(peer_pub_key: String)` → `{ session_nonce: String, authenticated: bool }`
- `auth_send_message(peer_pub_key: String, payload: Vec<u8>)` → `{ delivered: bool }`
- `auth_verify_certificate(cert_hex: String)` → `{ valid: bool, certifier: String }`

### Integration

- Store `AuthState` in Tauri managed state
- Initialize `Peer` with identity key from key store during app setup
- Hook into existing `http_server.rs` for incoming auth messages

## File Summary

### New Rust Files
| File | Phase |
|------|-------|
| `src-tauri/src/spv.rs` | 4.1 |
| `src-tauri/src/arc_broadcaster.rs` | 4.2 |
| `src-tauri/src/ordinals.rs` | 4.4 |
| `src-tauri/src/auth.rs` | 4.5 |

### Modified Rust Files
| File | Phase |
|------|-------|
| `src-tauri/src/transaction.rs` | 4.0, 4.3 |
| `src-tauri/src/key_store.rs` | 4.0, 4.3 |
| `src-tauri/src/lib.rs` | All (register commands) |

### Modified/Removed TypeScript Files
| File | Phase | Action |
|------|-------|--------|
| `src/services/wallet/lockCreation.ts` | 4.0 | Verify works with new command |
| `src/services/wallet/lockUnlocking.ts` | 4.0 | Verify works with new command |
| `src/services/wallet/ordinals.ts` | 4.0 | Verify works with new command |
| `src/domain/transaction/builder.ts` | 4.0 | Verify works with new command |
| `src/infrastructure/api/broadcastService.ts` | 4.2 | Remove — replaced by Rust |
| `src/services/wallet/inscribe.ts` | 4.3 | Remove stub, use Tauri command |
| `src/services/tokens/transfers.ts` | 4.3 | Use build_token_transfer_tx |
| `src/services/wallet/marketplace.ts` | 4.4 | Remove stubs, use Tauri commands |

## Verification Strategy

- **Phase 4.0:** All existing 1756 tests pass + new Rust tests for each command
- **Phase 4.1:** Rust unit tests with known Merkle path test vectors
- **Phase 4.2:** Integration test: build tx → broadcast via ARC → verify on WoC
- **Phase 4.3:** Rust tests with known inscription format, TS tests updated
- **Phase 4.4:** Rust tests with OrdinalLock bytecode verification
- **Phase 4.5:** Rust tests for session creation and message exchange

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| OrdinalLock bytecode mismatch | Extract exact contract hex from js-1sat-ord source |
| ARC endpoint changes | Configurable base_url, WoC fallback always available |
| bsv-auth transport complexity | Start with simple HTTP transport, iterate |
| Inscription format incorrect | Test against GorillaPool API validation |
| OP_PUSH_TX sighash preimage | Byte-comparison tests with known good preimages |
