# S-106: Custom Output Transaction Builder — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `buildAndBroadcastAction` so BRC-100 `createAction` respects custom locking scripts instead of ignoring them and sending all funds back to self.

**Architecture:** Add a new Rust function `build_custom_output_tx` (+ `_from_store` wrapper) that accepts arbitrary locking scripts as hex. Update TypeScript `buildAndBroadcastAction` to call this new command when outputs contain non-P2PKH scripts, falling back to existing P2PKH builder when all outputs are standard P2PKH to wallet address.

**Tech Stack:** Rust (bsv-sdk-rust, Tauri commands), TypeScript (React/Vitest), Tauri IPC

**Design doc:** `docs/plans/2026-03-03-s106-custom-outputs-design.md`

---

### Task 1: Add `CustomOutput` struct and `build_custom_output_tx` in Rust

**Files:**
- Modify: `src-tauri/src/transaction.rs:990` (insert before `#[cfg(test)]`)

**Step 1: Add the `CustomOutput` struct**

Insert after line 912 (`OutputDescriptor` closing brace), before line 914 (`build_multi_output_p2pkh_tx` doc comment):

```rust
/// Output descriptor for custom-script transactions (BRC-100 createAction).
/// Each output specifies an exact locking script as hex — not limited to P2PKH.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomOutput {
    pub satoshis: u64,
    pub locking_script_hex: String,
}
```

**Step 2: Add the `build_custom_output_tx` function**

Insert after `build_multi_output_p2pkh_tx` (after line 990, before `#[cfg(test)]`):

```rust
// ---------------------------------------------------------------------------
// Custom-output transaction builder (BRC-100 createAction)
// ---------------------------------------------------------------------------

/// Build and sign a transaction with arbitrary locking scripts.
///
/// Unlike `build_multi_output_p2pkh_tx` which only supports P2PKH outputs,
/// this function accepts raw locking script hex for each output. Used by
/// BRC-100 `createAction` where apps specify custom output scripts.
///
/// All inputs are signed with the same key. A P2PKH change output is appended
/// after the specified outputs if there are leftover funds.
pub fn build_custom_output_tx(
    wif: String,
    outputs: Vec<CustomOutput>,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    if outputs.is_empty() {
        return Err("At least one output is required".into());
    }

    let from_address = sdk_address_from_wif(&wif)?;

    // Decode and validate all locking scripts upfront
    let mut decoded_scripts: Vec<Script> = Vec::with_capacity(outputs.len());
    let mut output_script_sizes: Vec<usize> = Vec::with_capacity(outputs.len() + 1);

    for (i, out) in outputs.iter().enumerate() {
        let script = Script::from_hex(&out.locking_script_hex)
            .map_err(|e| format!("Invalid locking script hex at output {}: {}", i, e))?;
        let script_len = out.locking_script_hex.len() / 2; // hex -> bytes
        output_script_sizes.push(script_len);
        decoded_scripts.push(script);
    }

    let total_output: u64 = outputs.iter().map(|o| o.satoshis).sum();

    // Preliminary check: will there be change?
    let prelim_change = total_input.saturating_sub(total_output);
    let will_have_change = prelim_change > 100;
    if will_have_change {
        output_script_sizes.push(P2PKH_OUTPUT_SIZE as usize); // 34 bytes for change
    }

    // Calculate fee with actual script sizes (not fixed P2PKH assumption)
    let fee = calculate_inscription_tx_fee(
        selected_utxos.len(),
        &output_script_sizes,
        fee_rate,
    );

    let change = total_input
        .checked_sub(total_output)
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need {} + {} fee, have {}",
            total_output, fee, total_input
        ))?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Add all specified outputs with exact locking scripts
    for (i, script) in decoded_scripts.into_iter().enumerate() {
        let mut output = TransactionOutput::new();
        output.satoshis = outputs[i].satoshis;
        output.locking_script = script;
        tx.add_output(output);
    }

    // Add P2PKH change output
    if change > 0 {
        add_p2pkh_output(&mut tx, &from_address, change)?;
    }

    // Sign all inputs with the same key
    let privkey = sdk_privkey_from_wif(&wif)?;
    let template = p2pkh::unlock(privkey, None);
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: from_address,
        spent_outpoints: selected_utxos
            .iter()
            .map(|u| SpentOutpoint {
                txid: u.txid.clone(),
                vout: u.vout,
            })
            .collect(),
    })
}
```

**Step 3: Run Rust compilation check**

Run: `cd /Users/kitclawd/simply-sats/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles with no errors (warnings OK)

**Step 4: Commit**

```bash
git add src-tauri/src/transaction.rs
git commit -m "feat(S-106): add build_custom_output_tx for arbitrary locking scripts

Adds CustomOutput struct and build_custom_output_tx() function to the Rust
transaction builder. Accepts Vec<CustomOutput> with raw locking script hex
per output, enabling BRC-100 createAction to build transactions with
non-P2PKH outputs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add Rust tests for `build_custom_output_tx`

**Files:**
- Modify: `src-tauri/src/transaction.rs` (append to `mod tests`)

**Step 1: Write tests**

Append to the `mod tests` block (before the closing `}`):

```rust
    #[test]
    fn build_custom_output_tx_single_p2pkh() {
        let wif = get_test_wif();
        let address = get_test_address();

        // Build a standard P2PKH locking script for the destination
        let dest_script = "76a914".to_string() + &"11".repeat(20) + "88ac"; // 25-byte P2PKH

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 5000,
                locking_script_hex: dest_script,
            }],
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "build_custom_output_tx failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        assert_eq!(built.change_address, address);
        assert_eq!(built.spent_outpoints.len(), 1);
    }

    #[test]
    fn build_custom_output_tx_multi_mixed_scripts() {
        let wif = get_test_wif();

        // P2PKH output
        let p2pkh_script = "76a914".to_string() + &"22".repeat(20) + "88ac";
        // OP_RETURN output (OP_FALSE OP_RETURN <data>)
        let op_return_script = "006a".to_string() + &"ff".repeat(10);

        let result = build_custom_output_tx(
            wif,
            vec![
                CustomOutput { satoshis: 3000, locking_script_hex: p2pkh_script },
                CustomOutput { satoshis: 0, locking_script_hex: op_return_script },
            ],
            vec![UtxoInput {
                txid: "b".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "multi mixed failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert!(built.fee > 0);
        // Change = 10000 - 3000 - 0 - fee
        assert!(built.change > 0);
    }

    #[test]
    fn build_custom_output_tx_empty_outputs_error() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![],
            vec![UtxoInput {
                txid: "c".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("At least one output"));
    }

    #[test]
    fn build_custom_output_tx_invalid_hex_error() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 5000,
                locking_script_hex: "ZZZZ_not_hex".to_string(),
            }],
            vec![UtxoInput {
                txid: "d".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid locking script hex"));
    }

    #[test]
    fn build_custom_output_tx_insufficient_funds() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 100000,
                locking_script_hex: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            vec![UtxoInput {
                txid: "e".repeat(64),
                vout: 0,
                satoshis: 1000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            1000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    #[test]
    fn build_custom_output_tx_no_change() {
        let wif = get_test_wif();

        // Use an amount that leaves very little for change (less than fee threshold)
        // With 1 input, 1 output at 0.1 sat/byte, the fee is small
        // total_input = satoshis + fee (approximately)
        let script = "76a914".to_string() + &"00".repeat(20) + "88ac";
        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 9950,
                locking_script_hex: script,
            }],
            vec![UtxoInput {
                txid: "f".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "no-change failed: {:?}", result.err());
        let built = result.unwrap();
        // With ~19 sat fee and 9950 output, change should be small (about 31-50 sats)
        // The key thing: the function doesn't error out
        assert!(built.fee > 0);
    }
```

**Step 2: Run the Rust tests**

Run: `cd /Users/kitclawd/simply-sats/src-tauri && cargo test build_custom_output_tx 2>&1`
Expected: All 6 new tests PASS

**Step 3: Commit**

```bash
git add src-tauri/src/transaction.rs
git commit -m "test(S-106): add tests for build_custom_output_tx

6 tests covering: single P2PKH output, mixed scripts (P2PKH + OP_RETURN),
empty outputs error, invalid hex error, insufficient funds, and no-change scenario.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add `build_custom_output_tx_from_store` wrapper in key_store.rs

**Files:**
- Modify: `src-tauri/src/key_store.rs:459` (insert after `build_multi_output_p2pkh_tx_from_store`)

**Step 1: Add the wrapper function**

Insert after line 459 (closing `}` of `build_multi_output_p2pkh_tx_from_store`), before the `build_inscription_tx_from_store` function:

```rust

/// Build a custom-output transaction using the wallet key from the store.
/// Used by BRC-100 createAction for outputs with arbitrary locking scripts.
#[tauri::command]
pub async fn build_custom_output_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    outputs: Vec<transaction::CustomOutput>,
    selected_utxos: Vec<transaction::UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<transaction::BuiltTransactionResult, String> {
    let store = key_store.lock().await;
    require_keys(&store)?;
    let wif = Zeroizing::new(store.get_wif("wallet")?);
    drop(store);
    transaction::build_custom_output_tx(
        (*wif).clone(),
        outputs,
        selected_utxos,
        total_input,
        fee_rate,
    )
}
```

**Step 2: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, find line 773:
```rust
            key_store::build_multi_output_p2pkh_tx_from_store,
```
Insert after it:
```rust
            key_store::build_custom_output_tx_from_store,
```

**Step 3: Run Rust compilation check**

Run: `cd /Users/kitclawd/simply-sats/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles with no errors

**Step 4: Run all Rust tests to ensure nothing breaks**

Run: `cd /Users/kitclawd/simply-sats/src-tauri && cargo test 2>&1 | tail -10`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src-tauri/src/key_store.rs src-tauri/src/lib.rs
git commit -m "feat(S-106): add build_custom_output_tx_from_store Tauri command

Key store wrapper that reads WIF from Rust-side store and delegates to
build_custom_output_tx. Registered in invoke_handler.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update `buildAndBroadcastAction` in TypeScript

**Files:**
- Modify: `src/services/brc100/formatting.ts:115-127`

**Step 1: Replace the P2PKH-only Tauri invoke with branching logic**

Replace lines 115-127 (the `tauriInvoke('build_p2pkh_tx_from_store', ...)` block) with:

```typescript
  // S-106: Build transaction with correct output scripts.
  // If all outputs are standard P2PKH to our own address, use the optimized P2PKH builder.
  // Otherwise, use the custom-output builder that respects arbitrary locking scripts.
  const allOwnP2PKH = actionRequest.outputs.every(
    o => o.lockingScript === fromScriptHex
  )

  let txResult: { rawTx: string; txid: string }

  if (allOwnP2PKH) {
    // Optimized path: all outputs are P2PKH to wallet — use multi-output P2PKH builder
    txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_multi_output_p2pkh_tx_from_store', {
      outputs: actionRequest.outputs.map(o => ({
        address: fromAddress,
        satoshis: o.satoshis,
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
  } else {
    // Custom output path: outputs have arbitrary locking scripts (BRC-100 apps)
    txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_custom_output_tx_from_store', {
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

Also update line 129 — change `const rawTx = txResult.rawTx` to just leave as-is since `txResult` is now declared with `let` above.

**Step 2: Run TypeScript typecheck**

Run: `cd /Users/kitclawd/simply-sats && npx tsc --noEmit 2>&1 | tail -5`
Expected: No type errors

**Step 3: Run ESLint**

Run: `cd /Users/kitclawd/simply-sats && npm run lint 2>&1 | tail -5`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services/brc100/formatting.ts
git commit -m "fix(S-106): buildAndBroadcastAction now respects custom locking scripts

Previously called build_p2pkh_tx_from_store with toAddress=fromAddress,
ignoring all output.lockingScript values. Now branches:
- allOwnP2PKH: uses build_multi_output_p2pkh_tx_from_store (optimized)
- custom scripts: uses build_custom_output_tx_from_store (new command)

Fixes BRC-100 createAction for apps that need non-P2PKH outputs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add TypeScript tests for formatting.ts changes

**Files:**
- Create: `src/services/brc100/formatting.test.ts`

**Step 1: Write the test file**

```typescript
// @vitest-environment node
/**
 * Tests for BRC-100 formatting — buildAndBroadcastAction
 *
 * S-106: Verifies that custom locking scripts are forwarded to
 * build_custom_output_tx_from_store, and P2PKH-only outputs use
 * the optimized build_multi_output_p2pkh_tx_from_store path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock tauri invoke — capture the command and args
const mockInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  isTauri: () => true,
  tauriInvoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Mock wallet services
vi.mock('../wallet', () => ({
  getUTXOs: vi.fn(async () => [
    { txid: 'a'.repeat(64), vout: 0, satoshis: 50000, script: '76a914' + '00'.repeat(20) + '88ac' },
  ]),
  calculateTxFee: vi.fn(() => 100),
}))

// Mock database
vi.mock('../database', () => ({
  addUTXO: vi.fn(async () => ({ ok: true, value: undefined })),
  markUTXOSpent: vi.fn(async () => ({ ok: true, value: undefined })),
  addTransaction: vi.fn(async () => ({ ok: true, value: undefined })),
}))

// Mock coin selection
vi.mock('../../domain/transaction/coinSelection', () => ({
  selectCoins: vi.fn(() => ({
    sufficient: true,
    selected: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 50000, script: '76a914' + '00'.repeat(20) + '88ac' }],
    total: 50000,
  })),
}))

// Mock overlay broadcast
vi.mock('../overlay', () => ({
  broadcastWithOverlay: vi.fn(async () => ({
    txid: 'tx' + '0'.repeat(62),
    overlayResults: [{ accepted: true }],
    minerBroadcast: { ok: true },
  })),
  TOPICS: { DEFAULT: 'tm_default', WROOTZ_LOCKS: 'tm_locks', ORDINALS: 'tm_ordinals' },
}))

// Mock inscription utilities
vi.mock('../inscription', () => ({
  parseInscription: vi.fn(() => ({ isValid: false })),
  isInscriptionScript: vi.fn(() => false),
}))

// Mock BRC-100 utils
vi.mock('./utils', () => ({
  isInscriptionTransaction: vi.fn(() => false),
}))

// Mock sync/cancellation
vi.mock('../cancellation', () => ({
  acquireSyncLock: vi.fn(async () => vi.fn()), // returns release function
}))

// Mock accounts
vi.mock('../accounts', () => ({
  getActiveAccount: vi.fn(async () => ({ id: 1 })),
}))

// Mock p2pkhLockingScriptHex
const WALLET_SCRIPT = '76a914' + '00'.repeat(20) + '88ac'
vi.mock('../../domain/transaction/builder', () => ({
  p2pkhLockingScriptHex: vi.fn(() => WALLET_SCRIPT),
}))

// Mock sync baskets
vi.mock('../sync', () => ({
  BASKETS: { DEFAULT: 'default', ORDINALS: 'ordinals' },
}))

// Mock logger
vi.mock('../logger', () => ({
  brc100Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Now import the function under test
import { buildAndBroadcastAction } from './formatting'
import type { WalletKeys } from '../wallet/types'
import type { CreateActionRequest } from './types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockKeys: WalletKeys = {
  walletAddress: '1TestAddr',
  walletPubKey: '02' + 'aa'.repeat(32),
  ordAddress: '1OrdAddr',
  ordPubKey: '02' + 'bb'.repeat(32),
  identityKey: '02' + 'cc'.repeat(32),
  mnemonic: 'test mnemonic',
  accountIndex: 0,
}

function makeActionRequest(overrides: Partial<CreateActionRequest> = {}): CreateActionRequest {
  return {
    description: 'test action',
    outputs: [
      { lockingScript: 'aabb0011deadbeef', satoshis: 1000 },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAndBroadcastAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: invoke returns a built tx
    mockInvoke.mockResolvedValue({
      rawTx: '01000000' + '00'.repeat(50),
      txid: 'tx' + '0'.repeat(62),
      fee: 50,
      change: 1000,
      changeAddress: '1TestAddr',
      spentOutpoints: [],
    })
  })

  it('uses build_custom_output_tx_from_store for non-P2PKH scripts', async () => {
    const customScript = 'aabb0011deadbeef' // not a P2PKH script
    const request = makeActionRequest({
      outputs: [{ lockingScript: customScript, satoshis: 2000 }],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    // Should have called the custom output builder
    expect(mockInvoke).toHaveBeenCalledWith(
      'build_custom_output_tx_from_store',
      expect.objectContaining({
        outputs: [{ satoshis: 2000, lockingScriptHex: customScript }],
      }),
      expect.any(Number),
    )
  })

  it('uses build_multi_output_p2pkh_tx_from_store when all outputs are wallet P2PKH', async () => {
    const request = makeActionRequest({
      outputs: [
        { lockingScript: WALLET_SCRIPT, satoshis: 1000 },
        { lockingScript: WALLET_SCRIPT, satoshis: 2000 },
      ],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    // Should have called the P2PKH multi-output builder
    expect(mockInvoke).toHaveBeenCalledWith(
      'build_multi_output_p2pkh_tx_from_store',
      expect.objectContaining({
        outputs: [
          { address: '1TestAddr', satoshis: 1000 },
          { address: '1TestAddr', satoshis: 2000 },
        ],
      }),
      expect.any(Number),
    )
  })

  it('uses custom path when at least one output has a non-P2PKH script', async () => {
    const request = makeActionRequest({
      outputs: [
        { lockingScript: WALLET_SCRIPT, satoshis: 1000 },
        { lockingScript: 'deadbeef', satoshis: 500 },
      ],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith(
      'build_custom_output_tx_from_store',
      expect.objectContaining({
        outputs: [
          { satoshis: 1000, lockingScriptHex: WALLET_SCRIPT },
          { satoshis: 500, lockingScriptHex: 'deadbeef' },
        ],
      }),
      expect.any(Number),
    )
  })

  it('passes selectedUtxos with correct format', async () => {
    const request = makeActionRequest({
      outputs: [{ lockingScript: 'cafe', satoshis: 100 }],
    })

    await buildAndBroadcastAction(mockKeys, request)

    const invokeCall = mockInvoke.mock.calls[0]!
    const args = invokeCall[1] as Record<string, unknown>
    const utxos = args.selectedUtxos as Array<Record<string, unknown>>

    expect(utxos[0]).toEqual(expect.objectContaining({
      txid: 'a'.repeat(64),
      vout: 0,
      satoshis: 50000,
    }))
  })
})
```

**Step 2: Run the new tests**

Run: `cd /Users/kitclawd/simply-sats && npx vitest run src/services/brc100/formatting.test.ts 2>&1`
Expected: All 4 tests PASS

**Step 3: Run the full test suite to ensure nothing is broken**

Run: `cd /Users/kitclawd/simply-sats && npm run test:run 2>&1 | tail -5`
Expected: All tests pass (1803+)

**Step 4: Commit**

```bash
git add src/services/brc100/formatting.test.ts
git commit -m "test(S-106): add formatting.test.ts for buildAndBroadcastAction routing

Tests verify:
- Custom scripts route to build_custom_output_tx_from_store
- P2PKH-only scripts route to build_multi_output_p2pkh_tx_from_store
- Mixed outputs (P2PKH + custom) use custom path
- UTXO format passed correctly to Tauri

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Final verification — typecheck, lint, all tests

**Files:** None (verification only)

**Step 1: TypeScript typecheck**

Run: `cd /Users/kitclawd/simply-sats && npm run typecheck 2>&1`
Expected: Clean — no errors

**Step 2: ESLint**

Run: `cd /Users/kitclawd/simply-sats && npm run lint 2>&1`
Expected: Clean — no errors

**Step 3: Full Vitest suite**

Run: `cd /Users/kitclawd/simply-sats && npm run test:run 2>&1 | tail -10`
Expected: All tests pass

**Step 4: Full Rust test suite**

Run: `cd /Users/kitclawd/simply-sats/src-tauri && cargo test 2>&1 | tail -10`
Expected: All tests pass

**Step 5: Update REVIEW_FINDINGS.md — mark S-106 resolved**

In `REVIEW_FINDINGS.md`, find the S-106 entry and change status from `Open` to `Resolved`.

**Step 6: Commit**

```bash
git add REVIEW_FINDINGS.md
git commit -m "docs: mark S-106 as resolved in REVIEW_FINDINGS.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src-tauri/src/transaction.rs` | Add `CustomOutput` struct + `build_custom_output_tx()` + 6 tests |
| `src-tauri/src/key_store.rs` | Add `build_custom_output_tx_from_store` wrapper |
| `src-tauri/src/lib.rs` | Register new command in `invoke_handler` |
| `src/services/brc100/formatting.ts` | Replace single P2PKH invoke with P2PKH/custom branching |
| `src/services/brc100/formatting.test.ts` | New test file — 4 tests for routing logic |
| `REVIEW_FINDINGS.md` | Mark S-106 as resolved |
