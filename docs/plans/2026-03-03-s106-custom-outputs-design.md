# S-106: Fix createAction Custom Locking Script Support

**Date:** 2026-03-03
**Status:** Approved
**Priority:** High (BRC-100 protocol correctness)

## Problem

`buildAndBroadcastAction()` in `src/services/brc100/formatting.ts` ignores custom
`lockingScript` values from BRC-100 `CreateActionRequest.outputs`. It calls
`build_p2pkh_tx_from_store` with `toAddress: fromAddress`, creating a single P2PKH
output to the wallet's own address — effectively sending all funds back to self instead
of constructing the outputs the requesting app specified.

This breaks BRC-100 `createAction` for any app that needs custom output scripts
(e.g., Wrootz BRC-100 locks, inscriptions via createAction, multi-party contracts).

### Root Cause

- `build_p2pkh_tx_from_store` only supports a single P2PKH output to a given address
- `build_multi_output_p2pkh_tx_from_store` supports multiple outputs but still only P2PKH
- No Rust command exists for building transactions with **arbitrary locking scripts**

### Evidence That Rust Can Handle Custom Scripts

`build_inscription_tx` (transaction.rs:633-727) already creates outputs with arbitrary
`Script` objects by setting `output.locking_script` directly from hex. The same pattern
applies to `build_lock_tx` for timelock scripts. We just need a generic version.

## Chosen Approach: New Rust Command

Add `build_custom_output_tx` (+ `_from_store` wrapper) that accepts `Vec<CustomOutput>`
where each output specifies `{ satoshis, locking_script_hex }` directly.

### Why This Approach

- **Minimal surface area**: One new function, one new command — no refactoring existing commands
- **Security**: WIF stays in Rust (key store pattern preserved)
- **Correct fee calculation**: Uses `calculate_inscription_tx_fee` which handles variable-size output scripts
- **No inscription path impact**: Inscription transactions already work and remain untouched

## Design

### 1. New Rust Struct: `CustomOutput`

```rust
// transaction.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomOutput {
    pub satoshis: u64,
    pub locking_script_hex: String,
}
```

### 2. New Rust Function: `build_custom_output_tx`

**Location:** `src-tauri/src/transaction.rs` (after `build_multi_output_p2pkh_tx`)

```rust
pub fn build_custom_output_tx(
    wif: String,
    outputs: Vec<CustomOutput>,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String>
```

**Behavior:**
1. Validate `outputs` is non-empty
2. Decode each `locking_script_hex` to `Script` via `Script::from_hex()`
3. Calculate fee using `calculate_inscription_tx_fee()` with actual script sizes
4. Compute change = `total_input - sum(output.satoshis) - fee`
5. Build transaction:
   - Add all UTXO inputs
   - Add one output per `CustomOutput` with exact locking script
   - Append P2PKH change output to wallet address (if change > 0)
6. Sign all inputs with wallet WIF
7. Return `BuiltTransactionResult`

### 3. New Rust Wrapper: `build_custom_output_tx_from_store`

**Location:** `src-tauri/src/key_store.rs` (after `build_multi_output_p2pkh_tx_from_store`)

```rust
#[tauri::command]
pub async fn build_custom_output_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    outputs: Vec<transaction::CustomOutput>,
    selected_utxos: Vec<transaction::UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<transaction::BuiltTransactionResult, String>
```

Follows exact same pattern as `build_multi_output_p2pkh_tx_from_store`:
lock store → get WIF → drop store → call `build_custom_output_tx()`.

### 4. Register Tauri Command

**Location:** `src-tauri/src/lib.rs`

Add `build_custom_output_tx_from_store` to the `invoke_handler` list.

### 5. TypeScript Changes: `buildAndBroadcastAction`

**Location:** `src/services/brc100/formatting.ts`, lines 115-127

**Before** (the bug):
```ts
const txResult = await tauriInvoke('build_p2pkh_tx_from_store', {
  toAddress: fromAddress,
  satoshis: totalOutput,
  ...
})
```

**After** (the fix):
```ts
// Check if ALL outputs are standard P2PKH to our own address
const allP2PKH = actionRequest.outputs.every(
  o => o.lockingScript === fromScriptHex
)

if (allP2PKH) {
  // Optimized path: use existing P2PKH command for self-sends
  txResult = await tauriInvoke('build_multi_output_p2pkh_tx_from_store', { ... })
} else {
  // Custom output path: use new command with exact locking scripts
  txResult = await tauriInvoke('build_custom_output_tx_from_store', {
    outputs: actionRequest.outputs.map(o => ({
      satoshis: o.satoshis,
      lockingScriptHex: o.lockingScript,
    })),
    selectedUtxos: inputsToUse.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? fromScriptHex,
    })),
    totalInput,
    feeRate: 0.1,
  })
}
```

### 6. What Does NOT Change

- **Inscription detection & routing** (lines 54-58): Stays the same
- **Validation** (lines 66-87): Already validates scripts — no changes needed
- **Coin selection** (lines 95-113): Already accounts for multiple outputs
- **Database recording** (lines 186-239): Already records outputs by index — now matches actual tx
- **Lock path**: Uses separate `build_lock_tx_from_store` — unaffected
- **Broadcast logic**: Same overlay + miner broadcast
- **handlers.ts**: No changes — it just calls `buildAndBroadcastAction()`

## Fee Calculation Details

Custom locking scripts may be larger or smaller than standard P2PKH (25 bytes).
We reuse `calculate_inscription_tx_fee()` which takes `output_script_sizes: &[usize]`
and correctly computes `8 + varint_len + script_len` per output.

For the change output, we add `P2PKH_OUTPUT_SIZE` (34 bytes) to the array.

## Test Plan

### Rust Tests (transaction.rs)
1. `test_build_custom_output_tx_single_p2pkh` — one P2PKH output, verify identical to existing builder
2. `test_build_custom_output_tx_multi_mixed` — P2PKH + OP_RETURN + custom script
3. `test_build_custom_output_tx_empty_outputs` — error case
4. `test_build_custom_output_tx_invalid_hex` — error on bad script hex
5. `test_build_custom_output_tx_insufficient_funds` — error case
6. `test_build_custom_output_tx_no_change` — exact amount, no change output

### TypeScript Tests (formatting.test.ts)
1. Verify P2PKH path uses `build_multi_output_p2pkh_tx_from_store` when all scripts match wallet
2. Verify custom path uses `build_custom_output_tx_from_store` when scripts differ
3. Verify output objects passed to Tauri match actionRequest outputs
4. Verify database recording uses correct vout indices

## Risk Assessment

- **Low risk**: New command is additive — existing commands untouched
- **Low risk**: P2PKH fast path preserves current behavior for self-sends
- **Medium risk**: Fee estimation for very large custom scripts — mitigated by using proven `calculate_inscription_tx_fee()`
