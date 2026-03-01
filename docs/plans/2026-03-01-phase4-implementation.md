# Phase 4: New Capabilities — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 4 broken Rust commands, add SPV verification, ARC broadcasting, inscription builder, marketplace OrdinalLock, and authenticated messaging.

**Architecture:** Each phase adds a Rust module with Tauri commands, following the existing `transaction.rs` + `key_store.rs` `_from_store` pattern. All transaction builders are synchronous; ARC broadcasting uses Tauri's existing tokio runtime.

**Tech Stack:** Rust (bsv-sdk crates: bsv-transaction, bsv-spv, bsv-arc, bsv-script, bsv-auth, bsv-wallet), TypeScript (Tauri invoke calls)

---

## Task 1: build_lock_tx (CLTV timelock transaction)

**Files:**
- Modify: `src-tauri/src/transaction.rs` (add `build_lock_tx` after line ~245)
- Modify: `src-tauri/src/key_store.rs` (add `build_lock_tx_from_store` after line ~351)
- Modify: `src-tauri/src/lib.rs` (register commands at line ~754)

**Step 1: Add `build_lock_tx` to transaction.rs**

Add a new result type and function after the existing `build_consolidation_tx`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltLockResult {
    pub raw_tx: String,
    pub txid: String,
}

#[tauri::command]
pub fn build_lock_tx(
    wif: String,
    selected_utxos: Vec<UtxoInput>,
    lock_satoshis: u64,
    timelock_script_hex: String,
    change_address: String,
    change_satoshis: u64,
    op_return_hex: Option<String>,
) -> Result<BuiltLockResult, String> {
    use bsv_sdk::primitives::hash::hash160;
    use bsv_sdk::script::address::Address;
    use bsv_sdk::transaction::template::p2pkh;

    let privkey = sdk_privkey_from_wif(&wif)?;
    let mut tx = SdkTransaction::new();

    // Add inputs
    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Output 0: Timelock output (custom locking script)
    let lock_script_bytes = hex::decode(&timelock_script_hex)
        .map_err(|e| format!("Invalid timelock script hex: {}", e))?;
    let mut lock_output = TransactionOutput::new();
    lock_output.satoshis = lock_satoshis;
    lock_output.locking_script = bsv_sdk::script::Script::from_bytes(&lock_script_bytes);
    tx.add_output(lock_output);

    // Optional OP_RETURN output
    if let Some(op_return) = &op_return_hex {
        let op_return_bytes = hex::decode(op_return)
            .map_err(|e| format!("Invalid OP_RETURN hex: {}", e))?;
        let mut op_output = TransactionOutput::new();
        op_output.satoshis = 0;
        op_output.locking_script = bsv_sdk::script::Script::from_bytes(&op_return_bytes);
        tx.add_output(op_output);
    }

    // Change output (P2PKH)
    if change_satoshis > 0 {
        let addr = Address::from_string(&change_address)
            .map_err(|e| format!("Invalid change address: {}", e))?;
        let change_script = p2pkh::lock(&addr)
            .map_err(|e| format!("P2PKH lock error: {}", e))?;
        let mut change_output = TransactionOutput::new();
        change_output.satoshis = change_satoshis;
        change_output.locking_script = change_script;
        tx.add_output(change_output);
    }

    // Sign all inputs with P2PKH template
    let template = p2pkh::unlock(privkey, None);
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltLockResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
    })
}
```

**Step 2: Add `build_lock_tx_from_store` to key_store.rs**

```rust
#[tauri::command]
pub async fn build_lock_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    selected_utxos: Vec<transaction::UtxoInput>,
    lock_satoshis: u64,
    timelock_script_hex: String,
    change_address: String,
    change_satoshis: u64,
    op_return_hex: Option<String>,
) -> Result<transaction::BuiltLockResult, String> {
    let store = key_store.lock().await;
    require_keys(&store)?;
    let wif = Zeroizing::new(store.get_wif("wallet")?);
    drop(store);
    transaction::build_lock_tx(
        (*wif).clone(), selected_utxos, lock_satoshis,
        timelock_script_hex, change_address, change_satoshis, op_return_hex,
    )
}
```

**Step 3: Register in lib.rs**

Add to `invoke_handler`:
```rust
transaction::build_lock_tx,
key_store::build_lock_tx_from_store,
```

**Step 4: Write Rust test**

Add test in `transaction.rs` `#[cfg(test)]` module verifying the output structure.

**Step 5: Run `cargo test` and `cargo check`**

**Step 6: Commit**

```bash
git add src-tauri/src/transaction.rs src-tauri/src/key_store.rs src-tauri/src/lib.rs
git commit -m "feat: implement build_lock_tx for CLTV timelock transactions"
```

---

## Task 2: build_unlock_tx (OP_PUSH_TX timelock unlock)

**Files:**
- Modify: `src-tauri/src/transaction.rs`
- Modify: `src-tauri/src/key_store.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add `build_unlock_tx` to transaction.rs**

This is the most complex command — it must spend a CLTV-locked UTXO by constructing the correct unlocking script with sighash preimage.

```rust
#[tauri::command]
pub fn build_unlock_tx(
    wif: String,
    locked_txid: String,
    locked_vout: u32,
    locked_satoshis: u64,
    locking_script_hex: String,
    unlock_block: u32,
    to_address: String,
    output_satoshis: u64,
) -> Result<BuiltLockResult, String> {
    // Build transaction spending the CLTV-locked UTXO
    // The unlocking script must satisfy: <sig> <pubkey> <preimage>
    // where preimage is the BIP-143 sighash preimage for OP_PUSH_TX verification

    // ... implementation using bsv_sdk::transaction sighash computation
}
```

The key challenge is computing the BIP-143 sighash preimage and including it in the unlocking script. This requires the SDK's internal sighash computation OR manual preimage construction.

**Step 2: Add `build_unlock_tx_from_store` to key_store.rs** (same `_from_store` pattern)

**Step 3: Register in lib.rs**

**Step 4: Write Rust test with known CLTV script**

**Step 5: `cargo test && cargo check`**

**Step 6: Commit**

---

## Task 3: build_ordinal_transfer_tx (2-key ordinal transfer)

**Files:**
- Modify: `src-tauri/src/transaction.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add `build_ordinal_transfer_tx` to transaction.rs**

This is a multi-key transaction (like `build_multi_key_p2pkh_tx`) but with specific output ordering: ordinal (1 sat) at vout 0, change at vout 1.

```rust
#[tauri::command]
pub fn build_ordinal_transfer_tx(
    ord_wif: String,
    ordinal_utxo: UtxoInput,
    to_address: String,
    funding_wif: String,
    funding_utxos: Vec<UtxoInput>,
) -> Result<BuiltTransactionResult, String> {
    let ord_privkey = sdk_privkey_from_wif(&ord_wif)?;
    let funding_privkey = sdk_privkey_from_wif(&funding_wif)?;
    let mut tx = SdkTransaction::new();

    // Input 0: ordinal UTXO
    tx.add_input_from(&ordinal_utxo.txid, ordinal_utxo.vout,
        &ordinal_utxo.script, ordinal_utxo.satoshis)
        .map_err(|e| format!("Failed to add ordinal input: {}", e))?;

    // Inputs 1+: funding UTXOs
    for utxo in &funding_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add funding input: {}", e))?;
    }

    // Output 0: ordinal to recipient (1 sat)
    let to_addr = Address::from_string(&to_address)
        .map_err(|e| format!("Invalid to_address: {}", e))?;
    let to_script = p2pkh::lock(&to_addr)?;
    let mut ord_output = TransactionOutput::new();
    ord_output.satoshis = 1;
    ord_output.locking_script = to_script;
    tx.add_output(ord_output);

    // Calculate fee and change
    let total_funding: u64 = funding_utxos.iter().map(|u| u.satoshis).sum();
    let fee = calculate_tx_fee(1 + funding_utxos.len(), 2, 0.1);
    let change = total_funding.saturating_sub(fee);

    // Output 1: change to funding address
    if change > 0 {
        let change_addr_str = sdk_address_from_wif(&funding_wif)?;
        let change_addr = Address::from_string(&change_addr_str)?;
        let change_script = p2pkh::lock(&change_addr)?;
        let mut change_output = TransactionOutput::new();
        change_output.satoshis = change;
        change_output.locking_script = change_script;
        tx.add_output(change_output);
    }

    // Sign input 0 with ord key, remaining with funding key
    let ord_template = p2pkh::unlock(ord_privkey, None);
    let unlock_0 = ord_template.sign(&tx, 0).map_err(|e| format!("Sign ord: {}", e))?;
    tx.inputs[0].unlocking_script = Some(unlock_0);

    let fund_template = p2pkh::unlock(funding_privkey, None);
    for i in 1..tx.input_count() {
        let unlock = fund_template.sign(&tx, i as u32)?;
        tx.inputs[i].unlocking_script = Some(unlock);
    }

    // Build spent outpoints
    let mut spent = vec![SpentOutpoint { txid: ordinal_utxo.txid.clone(), vout: ordinal_utxo.vout }];
    for u in &funding_utxos {
        spent.push(SpentOutpoint { txid: u.txid.clone(), vout: u.vout });
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: sdk_address_from_wif(&funding_wif)?,
        spent_outpoints: spent,
    })
}
```

**Step 2: Register in lib.rs** (no `_from_store` needed — WIFs passed directly)

**Step 3: Write Rust test**

**Step 4: `cargo test && cargo check`**

**Step 5: Commit**

---

## Task 4: build_multi_output_p2pkh_tx (multiple recipients)

**Files:**
- Modify: `src-tauri/src/transaction.rs`
- Modify: `src-tauri/src/key_store.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add output struct and function**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxOutput {
    pub address: String,
    pub satoshis: u64,
}

#[tauri::command]
pub fn build_multi_output_p2pkh_tx(
    wif: String,
    outputs: Vec<TxOutput>,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    // Similar to build_p2pkh_tx but with multiple outputs
    // Add each output as P2PKH, then change output
}
```

**Step 2: Add `_from_store` variant in key_store.rs**

**Step 3: Register in lib.rs**

**Step 4: Write Rust test, `cargo test`**

**Step 5: Commit**

---

## Task 5: Verify broken commands work end-to-end

**Files:**
- No code changes — run TS tests and typecheck

**Step 1: `npx tsc -p tsconfig.app.json --noEmit`**

**Step 2: `npx vitest run`**

**Step 3: `cargo test`**

**Step 4: Commit checkpoint**

---

## Task 6: SPV Verification module (bsv-spv)

**Files:**
- Create: `src-tauri/src/spv.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create spv.rs with ChainTracker + Tauri commands**

```rust
use bsv_sdk::spv::{MerklePath, Beef, ChainTracker, SpvError};
use bsv_sdk::primitives::hash::Hash;
use serde::{Serialize, Deserialize};

// ChainTracker implementation using WhatsOnChain API
struct WocChainTracker {
    client: reqwest::blocking::Client,
}

impl ChainTracker for WocChainTracker {
    fn is_valid_root_for_height(&self, root: &Hash, height: u32) -> Result<bool, SpvError> {
        // GET https://api.whatsonchain.com/v1/bsv/main/block/height/{height}/header
        // Compare merkle_root field
    }
    fn current_height(&self) -> Result<u32, SpvError> {
        // GET https://api.whatsonchain.com/v1/bsv/main/chain/info
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerkleVerifyResult {
    pub root: String,
    pub valid: bool,
}

#[tauri::command]
pub fn verify_merkle_path(hex: String, txid: String) -> Result<MerkleVerifyResult, String> { ... }

#[tauri::command]
pub fn parse_beef(hex: String) -> Result<BeefParseResult, String> { ... }

#[tauri::command]
pub fn verify_beef(hex: String) -> Result<BeefVerifyResult, String> { ... }
```

**Step 2: Register module and commands in lib.rs**

**Step 3: Write Rust tests with known Merkle path test vectors**

**Step 4: `cargo test && cargo check`**

**Step 5: Commit**

---

## Task 7: ARC Broadcasting module (bsv-arc)

**Files:**
- Create: `src-tauri/src/arc_broadcaster.rs`
- Modify: `src-tauri/src/lib.rs`
- Remove: `src/infrastructure/api/broadcastService.ts`
- Modify: `src/services/wallet/transactions.ts` (update broadcast import)
- Modify: `src/services/brc100/locks.ts` (update broadcast import)
- Modify: `src/services/overlay.ts` (update broadcast import)
- Modify: `src/infrastructure/api/index.ts` (remove re-export)

**Step 1: Create arc_broadcaster.rs**

```rust
use bsv_sdk::arc::{ArcClient, ArcConfig, ArcStatus};
use bsv_sdk::transaction::Transaction as SdkTransaction;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastResult {
    pub txid: String,
    pub status: String,
}

#[tauri::command]
pub async fn broadcast_transaction(raw_hex: String) -> Result<BroadcastResult, String> {
    // Try ARC (GorillaPool) first
    let config = ArcConfig {
        base_url: "https://arc.gorillapool.io/v1".into(),
        ..Default::default()
    };
    let client = ArcClient::new(config);
    let tx = SdkTransaction::from_hex(&raw_hex).map_err(|e| e.to_string())?;

    match client.broadcast_async(&tx).await {
        Ok(resp) => Ok(BroadcastResult {
            txid: resp.txid,
            status: resp.tx_status.unwrap_or_default(),
        }),
        Err(arc_err) => {
            // Fallback to WoC
            broadcast_via_woc(&raw_hex).await
                .map_err(|e| format!("ARC failed: {}. WoC fallback also failed: {}", arc_err, e))
        }
    }
}
```

**Step 2: Register in lib.rs**

**Step 3: Migrate TS callers** — Replace `broadcastService.ts` imports with `tauriInvoke('broadcast_transaction', { rawHex })`

The 3 direct callers:
- `transactions.ts:39` — change `infraBroadcast(rawTx, txid)` to `tauriInvoke('broadcast_transaction', { rawHex: rawTx })`
- `overlay.ts:16` — same pattern
- `brc100/locks.ts:11` — same pattern

**Step 4: Remove `broadcastService.ts`, update barrel export**

**Step 5: Run TS tests + typecheck + lint**

**Step 6: Commit**

---

## Task 8: Inscription Builder (BSV-20/21 ordinal inscriptions)

**Files:**
- Modify: `src-tauri/src/transaction.rs` (add inscription output builder)
- Modify: `src-tauri/src/key_store.rs` (add `_from_store` variants)
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/wallet/inscribe.ts` (remove stub, use Tauri)
- Modify: `src/services/tokens/transfers.ts` (use proper inscription builder)

**Step 1: Add inscription output builder to transaction.rs**

Build BSV-20/21 inscription script format:
```
OP_FALSE OP_IF OP_PUSH("ord") OP_1 OP_PUSH(<content-type>) OP_0 OP_PUSH(<content>) OP_ENDIF
<standard P2PKH script>
```

```rust
fn build_inscription_script(
    content: &[u8],
    content_type: &str,
    dest_pkh: &[u8; 20],
) -> bsv_sdk::script::Script {
    // Construct the combined inscription + P2PKH script
}

#[tauri::command]
pub fn build_inscription_tx(
    wif: String,
    content: Vec<u8>,
    content_type: String,
    dest_address: String,
    funding_utxos: Vec<UtxoInput>,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> { ... }

#[tauri::command]
pub fn build_token_transfer_tx(
    token_wif: String,
    token_utxos: Vec<UtxoInput>,
    funding_wif: String,
    funding_utxos: Vec<UtxoInput>,
    recipient: String,
    amount: String,
    ticker: String,
    protocol: String,
    change_address: String,
) -> Result<BuiltTransactionResult, String> { ... }
```

**Step 2: Register commands, add `_from_store` variants**

**Step 3: Update inscribe.ts** — Remove stub, call `tauriInvoke('build_inscription_tx', ...)`

**Step 4: Update transfers.ts** — Replace `build_multi_key_p2pkh_tx` with `build_token_transfer_tx`

**Step 5: Run full test suite**

**Step 6: Commit**

---

## Task 9: Marketplace OrdinalLock (bsv-script)

**Files:**
- Create: `src-tauri/src/ordinals.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/wallet/marketplace.ts` (remove stubs)
- Modify: `src/services/wallet/marketplace.test.ts` (update tests)

**Step 1: Research js-1sat-ord OrdinalLock contract bytecode**

Fetch the exact contract template from the js-1sat-ord npm package to ensure compatibility.

**Step 2: Implement OrdinalLock in ordinals.rs**

```rust
#[tauri::command]
pub fn create_ordinal_listing(...) -> Result<BuiltTransactionResult, String> { ... }

#[tauri::command]
pub fn cancel_ordinal_listing(...) -> Result<BuiltTransactionResult, String> { ... }

#[tauri::command]
pub fn purchase_ordinal(...) -> Result<BuiltTransactionResult, String> { ... }
```

**Step 3: Register in lib.rs**

**Step 4: Update marketplace.ts** — Remove stubs, call Tauri commands

**Step 5: Update marketplace.test.ts** — Mock Tauri invokes instead of expecting throws

**Step 6: Run full test suite**

**Step 7: Commit**

---

## Task 10: Authenticated Messaging (bsv-auth)

**Files:**
- Create: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create auth.rs with Peer + HttpTransport**

```rust
use bsv_sdk::auth::{Peer, PeerOptions, AuthMessage, Transport};
use bsv_sdk::wallet::{ProtoWallet, ProtoWalletArgs};

struct HttpTransport { ... }
impl Transport for HttpTransport { ... }

#[tauri::command]
pub async fn auth_create_session(peer_pub_key: String) -> Result<SessionResult, String> { ... }

#[tauri::command]
pub async fn auth_send_message(peer_pub_key: String, payload: Vec<u8>) -> Result<bool, String> { ... }

#[tauri::command]
pub fn auth_verify_certificate(cert_hex: String) -> Result<CertVerifyResult, String> { ... }
```

**Step 2: Register in lib.rs, manage AuthState in Tauri state**

**Step 3: Write Rust tests**

**Step 4: `cargo test && cargo check`**

**Step 5: Commit**

---

## Task 11: Full verification + deploy

**Step 1: `npx tsc -p tsconfig.app.json --noEmit`** — 0 errors

**Step 2: `npm run lint`** — 0 errors

**Step 3: `npx vitest run`** — all tests pass

**Step 4: `cargo test`** — all Rust tests pass

**Step 5: `npm run tauri build`** — DMG builds

**Step 6: Copy DMG to Desktop**

**Step 7: Update checkpoint doc**

**Step 8: Final commit + push**
