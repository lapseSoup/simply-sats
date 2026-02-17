# Review Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all actionable findings from the 2026-02-17 comprehensive code review — security, bugs, architecture, and quality.

**Architecture:** 15 independent tasks organized in 3 tiers by complexity. Tier 1 (quick fixes) can be parallelized. Tier 2 (medium refactors) each touch one subsystem. Tier 3 (Rust changes) modify the Tauri backend.

**Tech Stack:** React 19, TypeScript 5.9, Rust (Tauri 2), Vitest, sql.js

---

## Pre-flight

```bash
npm run lint        # expect 0 errors
npm run typecheck   # expect clean
npm run test:run    # expect 1606 passing
```

---

## Task 1: BUG-6 — Fix syncAddress zero-UTXO sweep guard

**Context:** When the API returns 0 UTXOs but the DB has existing UTXOs for an address, the sync skips spend-marking entirely. If a user genuinely sweeps all UTXOs from an address, they are never marked spent — causing a permanently inflated balance.

**Files:**
- Modify: `src/services/sync.ts:279-287`

**Step 1: Fix the guard to allow legitimate sweeps**

In `syncAddress`, the guard at line 279 should check if the address has any confirmed transaction history. If it does, a zero-UTXO response is likely legitimate (swept), not an API failure.

Change the guard from:
```typescript
if (wocUtxos.length === 0 && existingMap.size > 0) {
  return { address, basket, newUtxos: 0, spentUtxos: 0, totalBalance: 0 }
}
```

To:
```typescript
if (wocUtxos.length === 0 && existingMap.size > 0) {
  // Check if this address has any transaction history — if it does,
  // the zero-UTXO response likely means the address was swept, not an API error.
  const hasHistory = await wocClient.getTransactionHistorySafe(address)
  if (!hasHistory.ok || hasHistory.value.length === 0) {
    // No history or API error — keep existing UTXOs as safety measure
    return { address, basket, newUtxos: 0, spentUtxos: 0, totalBalance: 0 }
  }
  // Address has history but no UTXOs — legitimate sweep, fall through to mark as spent
}
```

**Step 2: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 3: Commit**

```bash
git add src/services/sync.ts
git commit -m "fix: allow syncAddress to detect legitimate UTXO sweeps (BUG-6)"
```

---

## Task 2: BUG-7 — Stabilize useBrc100Handler effect with ref

**Context:** The `useBrc100Handler` hook has `isTrustedOrigin` in its effect dependency array. Every time a new origin is trusted, the entire effect tears down and recreates HTTP server and deep link listeners, potentially missing requests during the window.

**Files:**
- Modify: `src/hooks/useBrc100Handler.ts`

**Step 1: Use ref pattern for isTrustedOrigin**

Add a ref that tracks the latest `isTrustedOrigin` function, and remove it from the effect deps:

After the existing `isTrustedOrigin` destructure (around line 37), add:
```typescript
const isTrustedOriginRef = useRef(isTrustedOrigin)
useEffect(() => {
  isTrustedOriginRef.current = isTrustedOrigin
}, [isTrustedOrigin])
```

Then in the effect body (line 43+), replace all calls to `isTrustedOrigin(origin)` with `isTrustedOriginRef.current(origin)`.

Remove `isTrustedOrigin` from the effect dependency array at line 79, keeping only `[wallet, onRequestReceived]`.

Ensure `useRef` and `useEffect` are imported from 'react'.

**Step 2: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 3: Commit**

```bash
git add src/hooks/useBrc100Handler.ts
git commit -m "fix: stabilize useBrc100Handler effect by using ref for isTrustedOrigin (BUG-7)"
```

---

## Task 3: BUG-9 — Fix LocksContext handleUnlock state ordering

**Context:** In `handleUnlock`, the lock is removed from state (`setLocks` filter) BEFORE `onComplete()` succeeds. This creates a brief window where the UI shows no lock but the chain operation hasn't completed.

**Files:**
- Modify: `src/contexts/LocksContext.tsx:165-167`

**Step 1: Move setLocks after onComplete**

Find the `handleUnlock` function. The current code removes the lock from state first, then calls `onComplete()`. Swap the order: call `onComplete()` first (which broadcasts the unlock tx), then remove from state on success.

Current (approximately):
```typescript
setLocks(prev => prev.filter(l => !(l.txid === lock.txid && l.vout === lock.vout)))
const result = await onComplete()
```

Change to:
```typescript
const result = await onComplete()
// Only remove from state after successful unlock
setLocks(prev => prev.filter(l => !(l.txid === lock.txid && l.vout === lock.vout)))
```

If `onComplete` can throw, the lock should remain in state (which is the correct behavior — the unlock failed).

**Step 2: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 3: Commit**

```bash
git add src/contexts/LocksContext.tsx
git commit -m "fix: move lock state removal after onComplete succeeds (BUG-9)"
```

---

## Task 4: ARCH-4 — Add Error Boundary around AppProviders

**Context:** If any context provider throws during initialization (e.g., database corruption), the entire app crashes to a white screen with no recovery option.

**Files:**
- Modify: `src/App.tsx:465-471`

**Step 1: Wrap AppProviders with ErrorBoundary**

The codebase already has `ErrorBoundary` at `src/components/shared/ErrorBoundary.tsx`. Import it and wrap the App component:

```typescript
import { ErrorBoundary } from './components/shared/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <WalletApp />
      </AppProviders>
    </ErrorBoundary>
  )
}
```

Check what props `ErrorBoundary` accepts — it may need a `fallback` prop for the recovery UI. If it doesn't have one, use a simple fallback message with a "Reload" button.

**Step 2: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix: add Error Boundary around AppProviders for crash recovery (ARCH-4)"
```

---

## Task 5: QUAL-10 — Remove dead useNetworkStatus hook

**Context:** `useNetworkStatus` hook duplicates `NetworkContext.tsx` functionality. Only imported in its own test file.

**Files:**
- Delete: `src/hooks/useNetworkStatus.ts`
- Delete: `src/hooks/useNetworkStatus.test.ts`

**Step 1: Verify the hook is not imported anywhere except its test**

Search for `useNetworkStatus` imports. Confirm only the test file imports it.

**Step 2: Delete both files**

**Step 3: Verify**

```bash
npm run typecheck
npm run test:run   # test count should decrease
```

**Step 4: Commit**

```bash
git add -u src/hooks/useNetworkStatus.ts src/hooks/useNetworkStatus.test.ts
git commit -m "chore: remove dead useNetworkStatus hook (QUAL-10)"
```

---

## Task 6: SEC-13 — Expand common password list

**Context:** The common password list has only 31 entries, most artificially padded to 14 chars. Expand with realistic 14+ character passwords and add l33t-speak normalization.

**Files:**
- Modify: `src/utils/passwordValidation.ts:22-56`
- Modify: `src/utils/passwordValidation.test.ts` (add tests for new entries)

**Step 1: Add l33t-speak normalization function**

Before the `COMMON_PASSWORDS` set, add:
```typescript
function normalizeLeetSpeak(password: string): string {
  return password
    .replace(/@/g, 'a')
    .replace(/4/g, 'a')
    .replace(/3/g, 'e')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/0/g, 'o')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
}
```

**Step 2: Expand the password list**

Add these realistic 14+ character common passwords to `COMMON_PASSWORDS`:
```typescript
// Repeated patterns
'aaaaaaaaaaaaaa',
'11111111111111',
'00000000000000',
// Passphrase patterns
'pleaseletmein1',
'iloveyouforeve',
'iloveyouforever',
'letmeinletmein',
'passwordpasswo',
'passwordpassword',
'qwerty12345678',
'welcome12345678',
// Crypto-specific
'bitcoinwallet1',
'myseedphrase12',
'mywallet123456',
'walletpassword',
'cryptopassword',
'blockchainpass',
'privatekey12345',
// Sequence extensions
'12345678901234',
'abcdefghijklmnop',
'qwertyuiopasdfg',
// Common name-based
'iloveyoubaby12',
'sunshine123456',
'princess123456',
```

**Step 3: Update the password check to normalize l33t speak**

In the `isCommonPassword` check (around line 137), change:
```typescript
if (COMMON_PASSWORDS.has(password.toLowerCase())) {
```
To:
```typescript
const lower = password.toLowerCase()
if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(normalizeLeetSpeak(lower))) {
```

**Step 4: Add tests for l33t-speak normalization**

In `passwordValidation.test.ts`, add tests:
```typescript
it('should reject l33t-speak variants of common passwords', () => {
  const result = validatePassword('b1tc01nw@ll3t1')
  expect(result.score).toBeLessThan(3)
})
```

**Step 5: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 6: Commit**

```bash
git add src/utils/passwordValidation.ts src/utils/passwordValidation.test.ts
git commit -m "security: expand common password list and add l33t-speak normalization (SEC-13)"
```

---

## Task 7: SEC-1 — Replace BRC-100 manual coin selection with domain layer

**Context:** `buildAndBroadcastAction` in `src/services/brc100/actions.ts` uses a manual greedy loop with a hardcoded 200-sat buffer instead of the domain `selectCoins()` function.

**Files:**
- Modify: `src/services/brc100/actions.ts:741-758`

**Step 1: Add import for selectCoins**

At the top of `actions.ts`, add:
```typescript
import { selectCoins } from '../../domain/transaction/coinSelection'
```

**Step 2: Replace the manual coin selection loop**

Replace lines 741-758 (the manual loop + fee calc) with:

```typescript
  // Use domain coin selection (smallest-first, proper buffer)
  const numOutputs = actionRequest.outputs.length + 1 // outputs + change
  const estimatedFee = calculateTxFee(1, numOutputs) // min 1 input estimate
  const selectionResult = selectCoins(utxos, totalOutput + estimatedFee)

  if (!selectionResult.sufficient) {
    throw new Error('Insufficient funds')
  }

  const inputsToUse = selectionResult.selected
  const totalInput = selectionResult.total

  // Recalculate fee with actual input count
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
  const change = totalInput - totalOutput - fee

  if (change < 0) {
    // Edge case: more inputs increased the fee beyond what was selected
    // Try selecting again with the updated fee estimate
    const retryResult = selectCoins(utxos, totalOutput + fee)
    if (!retryResult.sufficient) {
      throw new Error(`Insufficient funds (need ${totalOutput + fee} sats, have ${retryResult.total})`)
    }
    const retryFee = calculateTxFee(retryResult.selected.length, numOutputs)
    const retryChange = retryResult.total - totalOutput - retryFee
    if (retryChange < 0) {
      throw new Error(`Insufficient funds for fee (need ${retryFee} sats for fee)`)
    }
    // Use retry results
    inputsToUse.length = 0
    inputsToUse.push(...retryResult.selected)
    Object.assign(selectionResult, { total: retryResult.total })
  }
```

Wait — this gets complex with reassignment. Simpler approach: just use `selectCoins` with a generous buffer to avoid the retry:

```typescript
  // Use domain coin selection with fee estimate as buffer
  const estimatedFee = calculateTxFee(Math.min(utxos.length, 3), actionRequest.outputs.length + 1)
  const selectionResult = selectCoins(utxos, totalOutput + estimatedFee)

  if (!selectionResult.sufficient) {
    throw new Error('Insufficient funds')
  }

  const inputsToUse = selectionResult.selected
  const totalInput = selectionResult.total

  // Final fee based on actual input count
  const numOutputs = actionRequest.outputs.length + 1
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
  const change = totalInput - totalOutput - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }
```

**Step 3: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 4: Commit**

```bash
git add src/services/brc100/actions.ts
git commit -m "security: use domain selectCoins in BRC-100 buildAndBroadcastAction (SEC-1)"
```

---

## Task 8: QUAL-1 — Add React.memo to remaining presentational components

**Context:** Most list-item components already have `memo()`. Three remaining candidates: Toast, PaymentAlert, PasswordInput.

**Files:**
- Modify: `src/components/shared/Toast.tsx`
- Modify: `src/components/shared/PaymentAlert.tsx`
- Modify: `src/components/shared/PasswordInput.tsx`

**Step 1: Wrap each component**

For each file, change the export pattern. E.g., for Toast:

```typescript
import { memo } from 'react'

// ... component definition ...

export const Toast = memo(ToastInner)
```

Or if using named function export:
```typescript
export const Toast = memo(function Toast(props: ToastProps) {
  // ... existing body ...
})
```

Follow the same pattern used by `EmptyState.tsx` (which is already memo'd) for consistency.

**Step 2: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 3: Commit**

```bash
git add src/components/shared/Toast.tsx src/components/shared/PaymentAlert.tsx src/components/shared/PasswordInput.tsx
git commit -m "perf: add React.memo to Toast, PaymentAlert, PasswordInput (QUAL-1)"
```

---

## Task 9: QUAL-2 — Incremental transaction history sync

**Context:** `syncTransactionHistory` fetches up to 50 tx details per address on every sync, even for known transactions. This wastes ~150 API calls per sync cycle.

**Files:**
- Modify: `src/services/sync.ts` in `syncTransactionHistory` function (~line 463)
- Modify: `src/services/database/txRepository.ts` (add `getKnownTxids` query if needed)

**Step 1: Add a query to get known txids for an account**

Check if `txRepository.ts` already has a function to get all txids. If not, add:

```typescript
export async function getKnownTxids(accountId?: number): Promise<Set<string>> {
  const db = getDatabase()
  const query = accountId
    ? 'SELECT txid FROM transactions WHERE account_id = ?'
    : 'SELECT txid FROM transactions'
  const rows = await db.select<{ txid: string }[]>(query, accountId ? [accountId] : [])
  return new Set(rows.map(r => r.txid))
}
```

**Step 2: Filter known txids in syncTransactionHistory**

After fetching `history` (line 473) and before the loop (line 476), add:

```typescript
  // Skip already-known transactions to avoid wasteful API calls
  const knownTxids = await getKnownTxids(accountId)
  const newHistory = history.filter(txRef => !knownTxids.has(txRef.tx_hash))
  syncLogger.debug('Incremental tx sync', {
    total: history.length,
    new: newHistory.length,
    skipped: history.length - newHistory.length
  })
```

Then change the loop to iterate `newHistory` instead of `history`:
```typescript
  for (const txRef of newHistory) {
```

Also add a confirmation update pass for pending txids that now have block heights:
```typescript
  // Update block heights for pending transactions that are now confirmed
  const pendingTxids = await getPendingTransactionTxids(accountId)
  for (const txRef of history) {
    if (pendingTxids.has(txRef.tx_hash) && txRef.height > 0) {
      await updateTransactionBlockHeight(txRef.tx_hash, txRef.height, accountId)
    }
  }
```

**Step 3: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 4: Commit**

```bash
git add src/services/sync.ts src/services/database/txRepository.ts
git commit -m "perf: skip known txids in syncTransactionHistory for incremental sync (QUAL-2)"
```

---

## Task 10: ARCH-1 — Fix stale test mocks using ad-hoc pattern

**Context:** Production code uses `Result<T,E>` but some test mocks still use the old `{ success, error }` format.

**Files:**
- Modify: `src/components/modals/SendModal.test.tsx:132,156`
- Modify: `src/services/deeplink.test.ts:239,243`

**Step 1: Update SendModal.test.tsx mocks**

Change mock return values from:
```typescript
{ success: false, error: 'Insufficient funds' }
{ success: true, txid: 'txid123' }
```
To:
```typescript
{ ok: false, error: 'Insufficient funds' }
{ ok: true, value: { txid: 'txid123' } }
```

**Step 2: Update deeplink.test.ts mocks**

Change:
```typescript
mockHandleBRC100Request.mockResolvedValue({ success: true })
```
To match the actual return type of `handleBRC100Request`. Read the function to confirm its return type, then update the mock accordingly.

**Step 3: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 4: Commit**

```bash
git add src/components/modals/SendModal.test.tsx src/services/deeplink.test.ts
git commit -m "fix: update test mocks to match Result<T,E> return types (ARCH-1)"
```

---

## Task 11: SEC-11 — Remove get_mnemonic, add switch_account_from_store

**Context:** `get_mnemonic` returns the mnemonic to JS without clearing it from Rust memory. The main caller is account switching, which can be done entirely in Rust.

**Files:**
- Modify: `src-tauri/src/key_store.rs`
- Modify: `src/hooks/useAccountSwitching.ts`

**Step 1: Add `switch_account_from_store` Rust command**

In `key_store.rs`, add a new command that reads the mnemonic from the store, derives keys for a new account index, and re-stores them — all without sending the mnemonic to JS:

```rust
#[tauri::command]
pub async fn switch_account_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    account_index: u32,
) -> Result<Option<PublicWalletKeys>, String> {
    let mnemonic = {
        let store = key_store.lock().await;
        require_keys(&store)?;
        store.mnemonic.clone()
            .ok_or_else(|| "No mnemonic in key store for account switch".to_string())?
    };

    // Derive keys for new account (reuse existing store_keys logic)
    let keys = derive_and_store_keys(&key_store, &mnemonic, account_index).await?;
    Ok(Some(keys))
}
```

Register it in `lib.rs` alongside other key_store commands.

**Step 2: Update useAccountSwitching.ts to use new command**

In the `deriveKeysFromRust` function, replace the pattern:
```typescript
const mnemonic = await invoke<string | null>('get_mnemonic')
// ... derive keys in JS ...
```
With:
```typescript
const pubKeys = await invoke<PublicWalletKeys | null>('switch_account_from_store', { accountIndex })
```

**Step 3: Remove `get_mnemonic` command**

Delete the `get_mnemonic` function from `key_store.rs` and remove it from the command registration in `lib.rs`.

Update remaining callers (SettingsBackup.tsx, SettingsSecurity.tsx) to use `get_mnemonic_once` — these are one-time export operations where clearing after retrieval is correct.

**Step 4: Verify**

```bash
npm run typecheck
npm run test:run
cargo build --manifest-path src-tauri/Cargo.toml
```

**Step 5: Commit**

```bash
git add src-tauri/src/key_store.rs src-tauri/src/lib.rs src/hooks/useAccountSwitching.ts
git commit -m "security: add switch_account_from_store, remove get_mnemonic command (SEC-11)"
```

---

## Task 12: SEC-9 — Generate random HMAC key for rate limiter

**Context:** The rate limiter HMAC key is hardcoded in the binary. Replace with a random key generated at first launch and stored via OS keychain.

**Files:**
- Modify: `src-tauri/src/rate_limiter.rs`
- Modify: `src-tauri/src/lib.rs` (pass key during setup)

**Step 1: Add key generation/retrieval function**

In `rate_limiter.rs`, replace the hardcoded constant with a function:

```rust
use rand::Rng;

const INTEGRITY_KEY_NAME: &str = "simply-sats-ratelimit-hmac-key";

fn get_or_create_integrity_key(app: &tauri::AppHandle) -> Vec<u8> {
    // Try loading from secure storage
    if let Ok(existing) = app.try_state::<crate::secure_storage::SecureStore>() {
        if let Ok(Some(key_hex)) = existing.get(INTEGRITY_KEY_NAME) {
            if let Ok(key) = hex::decode(&key_hex) {
                if key.len() == 32 {
                    return key;
                }
            }
        }
    }

    // Generate new 32-byte random key
    let key: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen()).collect();
    let key_hex = hex::encode(&key);

    // Persist to secure storage
    if let Ok(store) = app.try_state::<crate::secure_storage::SecureStore>() {
        let _ = store.set(INTEGRITY_KEY_NAME, &key_hex);
    }

    key
}
```

Adapt this to the actual secure storage API used by the project.

**Step 2: Update compute_state_hmac and load_persisted_state**

Change them to accept `integrity_key: &[u8]` as a parameter instead of using the constant. Remove the `const INTEGRITY_KEY`.

**Step 3: Pass the key during app setup**

In `lib.rs`, during rate limiter initialization, call `get_or_create_integrity_key(app)` and pass the key to the rate limiter state.

**Step 4: Verify**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
npm run typecheck
npm run test:run
```

**Step 5: Commit**

```bash
git add src-tauri/src/rate_limiter.rs src-tauri/src/lib.rs
git commit -m "security: generate per-device HMAC key for rate limiter (SEC-9)"
```

---

## Task 13: BUG-8 — Add CSRF nonce to getPublicKey endpoint

**Context:** `handle_get_public_key` in the BRC-100 HTTP server validates origin but not CSRF nonce, allowing public key exfiltration without CSRF protection.

**Files:**
- Modify: `src-tauri/src/http_server.rs:389-417`
- Modify: `sdk/src/index.ts` (update SDK to send nonce for getPublicKey)

**Step 1: Refactor handle_get_public_key to use validate_and_parse_request**

Replace the manual origin validation and body parsing with the same `validate_and_parse_request` used by `handle_create_action`:

```rust
async fn handle_get_public_key(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let (args, origin) = match validate_and_parse_request(&state, request).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    let parsed: GetPublicKeyArgs = serde_json::from_value(args)
        .unwrap_or_default();

    log::debug!("getPublicKey request: {:?}", parsed);
    forward_to_frontend(state, "getPublicKey", serde_json::json!({
        "identityKey": parsed.identity_key.unwrap_or(false),
    }), origin).await
}
```

**Step 2: Update SDK to send nonce for getPublicKey**

In the SDK's `getPublicKey` method, ensure it follows the same pattern as `createAction` — first get a nonce, then include it in the request header.

**Step 3: Verify**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

**Step 4: Commit**

```bash
git add src-tauri/src/http_server.rs sdk/src/index.ts
git commit -m "security: require CSRF nonce for getPublicKey endpoint (BUG-8)"
```

---

## Task 14: SEC-5 — Wire existing Rust signing commands (partial WIF bridge migration)

**Context:** Several JS operations use `getWifForOperation` to get WIFs, but equivalent Rust commands already exist. Wire them in where possible. The full migration (locks, ordinals, tokens) needs new Rust commands — defer those.

**Files:**
- Modify: `src/services/brc100/actions.ts` (encrypt/decrypt → `encrypt_ecies_from_store`/`decrypt_ecies_from_store`)

**Step 1: Replace BRC-100 encrypt with Rust command**

In `actions.ts` around line 329, replace:
```typescript
const identityWif = await getWifForOperation('identity', 'encrypt', keys)
const identityKey = PrivateKey.fromWif(identityWif)
// ... ECDH shared secret derivation ...
```
With:
```typescript
const encryptedData = await invoke<string>('encrypt_ecies_from_store', {
  keyType: 'identity',
  plaintext: dataToEncrypt
})
```

Adapt to the actual ECIES command signature.

**Step 2: Replace BRC-100 decrypt with Rust command**

Similar pattern at line 379.

**Step 3: Verify**

```bash
npm run typecheck
npm run test:run
```

**Step 4: Commit**

```bash
git add src/services/brc100/actions.ts
git commit -m "security: use Rust ECIES commands for BRC-100 encrypt/decrypt (SEC-5 partial)"
```

---

## Task 15: QUAL-7 — Add test stubs for context providers

**Context:** All 9 context providers have zero tests. Add initial test coverage for the most critical ones.

**Files:**
- Create: `src/contexts/UIContext.test.tsx`
- Create: `src/contexts/LocksContext.test.tsx`

**Step 1: Create UIContext tests**

Test the most important behavior: toast management, theme toggle, unit display.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
// ... setup provider wrapper ...

describe('UIContext', () => {
  it('should toggle display unit between sats and BSV', () => { ... })
  it('should add and dismiss toasts', () => { ... })
  it('should toggle theme', () => { ... })
})
```

**Step 2: Create LocksContext tests**

Test lock detection, handleLock, handleUnlock state management.

**Step 3: Verify**

```bash
npm run test:run
```

**Step 4: Commit**

```bash
git add src/contexts/UIContext.test.tsx src/contexts/LocksContext.test.tsx
git commit -m "test: add initial context provider tests for UIContext and LocksContext (QUAL-7)"
```

---

## Final Verification

```bash
npm run lint          # 0 errors
npm run typecheck     # clean compile
npm run test:run      # all tests passing (count > 1606)
cargo build --manifest-path src-tauri/Cargo.toml  # Rust builds
```
