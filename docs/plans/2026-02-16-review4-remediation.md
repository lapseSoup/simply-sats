# Review #4 Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 34+ findings from Review #4 across security, bugs, architecture, and quality.

**Architecture:** Sequential 6-batch approach. Each batch is verified (typecheck + lint + test) before proceeding. Quick security and bug fixes first, then medium fixes, then architecture, quality, and finally the major C1 WIF migration.

**Tech Stack:** TypeScript 5.9, React 19, Tauri 2 (Rust), Vitest, SQLite

**Verification command (run after every batch):**
```bash
npm run typecheck && npm run lint && npm run test:run
```

---

## Batch 1: Quick Security Fixes

### Task 1.1: Rate Limiter Fail-Closed (C2)

**Files:**
- Modify: `src/services/rateLimiter.ts:44-48,74-78`
- Test: `src/services/rateLimiter.test.ts` (if exists, add fail-closed test)

**Step 1:** In `checkUnlockRateLimit()` catch block (~line 47), change:
```typescript
// OLD: Fail open - allow attempt if backend unavailable
return { isLimited: false, remainingMs: 0 }
```
to:
```typescript
// Fail closed - block attempts if backend unavailable
return { isLimited: true, remainingMs: 30000 }
```

**Step 2:** In `recordFailedUnlockAttempt()` catch block (~line 77), change:
```typescript
return { isLocked: false, lockoutMs: 0, attemptsRemaining: MAX_ATTEMPTS }
```
to:
```typescript
// Fail closed - assume locked if backend unavailable
return { isLocked: true, lockoutMs: 60000, attemptsRemaining: 0 }
```

**Step 3:** Run verification.

### Task 1.2: Remove "Never" Auto-Lock (H2)

**Files:**
- Modify: `src/services/autoLock.ts:~221`
- Modify: `src/services/autoLock.test.ts` (update TIMEOUT_OPTIONS test)

**Step 1:** Remove `{ label: 'Never', value: 0 }` from the `TIMEOUT_OPTIONS` array.

**Step 2:** Update the test that checks for the "Never" option — it should now expect 5 options instead of 6, and the "Never" assertion should be removed.

**Step 3:** Run verification.

### Task 1.3: URL Encode API Parameters (H3)

**Files:**
- Modify: `src/infrastructure/api/wocClient.ts`

**Step 1:** Find all string interpolations that put addresses into URLs. Wrap each `${address}` with `${encodeURIComponent(address)}`. Key locations:
- `getBalanceSafe`: `${cfg.baseUrl}/address/${encodeURIComponent(address)}/balance`
- `getUtxosSafe`: `${cfg.baseUrl}/address/${encodeURIComponent(address)}/unspent`
- `getTransactionHistorySafe`: `${cfg.baseUrl}/address/${encodeURIComponent(address)}/history`
- Any other address/txid interpolations in the file

**Step 2:** Run verification.

### Task 1.4: Disable Crypto Fallback in Production (M1)

**Files:**
- Modify: `src/services/crypto.ts:~165-167,~210-213`

**Step 1:** In the `encrypt` function, after the Tauri try/catch (~line 165), change the fallback to only work in dev:
```typescript
} catch (e) {
  if (!import.meta.env.DEV) {
    throw new Error('Encryption backend unavailable')
  }
  cryptoLogger.error('Rust encrypt_data failed, falling back to Web Crypto', { error: e })
}
```

**Step 2:** In the `decrypt` function, apply the same pattern after the Tauri try/catch (~line 210-213). Keep the existing re-throw for Rust-originated errors, but guard the Web Crypto fallback:
```typescript
cryptoLogger.error('Rust decrypt_data unavailable, falling back to Web Crypto', { error: e })
if (!import.meta.env.DEV) {
  throw new Error('Decryption backend unavailable')
}
```

**Step 3:** Run verification.

### Task 1.5: Scope FS Capabilities (M6)

**Files:**
- Modify: `src-tauri/capabilities/default.json`

**Step 1:** Replace the broad FS permissions with scoped versions. Change:
```json
"fs:allow-write-text-file",
"fs:allow-read-text-file",
```
to (check Tauri 2 docs for exact scope syntax — may need a scope object):
```json
{
  "identifier": "fs:allow-write-text-file",
  "allow": [{ "path": "$APPDATA/**" }, { "path": "$DOWNLOAD/**" }]
},
{
  "identifier": "fs:allow-read-text-file",
  "allow": [{ "path": "$APPDATA/**" }, { "path": "$DOWNLOAD/**" }]
},
```
Note: `$DOWNLOAD` is needed for backup exports. Verify the exact Tauri 2 scope syntax — it may use `"scope"` instead of `"allow"`.

**Step 2:** Run `npm run tauri:dev` to verify the app still starts and can read/write files (backups, etc.).

### Task 1.6: Document HMAC Key Trade-off (M4)

**Files:**
- Modify: `src-tauri/src/rate_limiter.rs:~20`

**Step 1:** Add a doc comment above the `INTEGRITY_KEY` constant:
```rust
/// HMAC key for rate limit state integrity verification.
///
/// SECURITY NOTE: This key is hardcoded and extractable from the binary.
/// It provides defense-in-depth against casual tampering of the rate limit
/// state file, but cannot prevent a determined attacker with binary access
/// from forging valid HMACs. A stronger approach would derive this key from
/// a device-specific secret stored in the OS keychain. Accepted trade-off
/// for current threat model (local desktop app).
const INTEGRITY_KEY: &[u8] = b"SimplySats-RateLimit-Integrity-K";
```

**Step 2:** Run verification.

### Task 1.7: Verify Batch 1

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: 0 type errors, 0 lint errors, all tests pass.

---

## Batch 2: Quick Bug Fixes

### Task 2.1: Global Unhandled Rejection Handler (C5)

**Files:**
- Modify: `src/main.tsx`

**Step 1:** Add before the `createRoot` call:
```typescript
import { createLogger } from './services/logger'

const appLogger = createLogger('App')

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  appLogger.error('Unhandled promise rejection', {
    reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
    stack: event.reason instanceof Error ? event.reason.stack : undefined
  })
})
```

**Step 2:** Run verification.

### Task 2.2: Fix Falsy Account ID Checks (H5)

**Files:**
- Modify: `src/hooks/useWalletSend.ts:~70` — `activeAccountId || undefined` → `activeAccountId ?? undefined`
- Modify: `src/services/database/txRepository.ts:~393` — `if (accountId)` → `if (accountId != null)`

**Step 1:** In `useWalletSend.ts`, find `getDerivedAddresses(activeAccountId || undefined)` and change to `getDerivedAddresses(activeAccountId ?? undefined)`.

**Step 2:** In `txRepository.ts` `searchTransactionsByLabels`, find `if (accountId)` and change to `if (accountId != null)`.

**Step 3:** Search the entire codebase for other `accountId || undefined` or `activeAccountId || undefined` patterns and fix them all:
```bash
grep -rn 'accountId || undefined\|activeAccountId || undefined' src/
```

**Step 4:** Run verification.

### Task 2.3: Negative Balance Guard (H6)

**Files:**
- Modify: `src/infrastructure/api/wocClient.ts:~147`

**Step 1:** Change:
```typescript
return ok(data.confirmed + data.unconfirmed)
```
to:
```typescript
return ok(Math.max(0, data.confirmed + data.unconfirmed))
```

**Step 2:** Run verification.

### Task 2.4: Fix Falsy Row Mapping (M7)

**Files:**
- Modify: `src/services/database/txRepository.ts`

**Step 1:** In both `searchTransactionsByLabels` (~line 425) and `searchTransactions` (~line 459), find all `row.X || undefined` patterns and replace with `row.X ?? undefined`:
- `amount: row.amount || undefined` → `amount: row.amount ?? undefined`
- `blockHeight: row.block_height || undefined` → `blockHeight: row.block_height ?? undefined`
- `description: row.description || undefined` → `description: row.description ?? undefined`
- `rawTx: row.raw_tx || undefined` → `rawTx: row.raw_tx ?? undefined`
- `confirmedAt: row.confirmed_at || undefined` → `confirmedAt: row.confirmed_at ?? undefined`

Search for ALL `|| undefined` patterns in this file and convert to `?? undefined`.

**Step 2:** Run verification.

### Task 2.5: Stale Locks Dedup via Ref (M8)

**Files:**
- Modify: `src/contexts/LocksContext.tsx:~100-136`

**Step 1:** Add a ref to track locks for dedup checking. Near the top of the component (after `useState`):
```typescript
const locksRef = useRef(locks)
useEffect(() => { locksRef.current = locks }, [locks])
```

**Step 2:** In `handleLock`, change the dedup check (~line 112) from:
```typescript
const recentDuplicate = locks.find(l =>
```
to:
```typescript
const recentDuplicate = locksRef.current.find(l =>
```

**Step 3:** Remove `locks` from the `handleLock` dependency array (~line 136) since we now use the ref.

**Step 4:** Run verification.

### Task 2.6: BASKETS Dedup (Low)

**Files:**
- Modify: `src/services/sync.ts:~128`

**Step 1:** Remove the local `BASKETS` constant definition (~lines 128-134).

**Step 2:** Add import at the top of the file:
```typescript
import { BASKETS } from '../domain/types'
```

**Step 3:** Verify all `BASKETS.` references still resolve. Also check that `brc100.ts` imports BASKETS from the right place — it should import from `sync.ts` or `domain/types.ts`, not have its own copy.

**Step 4:** Run verification.

### Task 2.7: Verify Batch 2

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: 0 type errors, 0 lint errors, all tests pass.

---

## Batch 3: Medium Bug Fixes

### Task 3.1: Coin-Control WIF Assignment (C3)

**Files:**
- Modify: `src/hooks/useWalletSend.ts:~59-66`

**Step 1:** When `selectedUtxos` is provided, look up each UTXO's address against derived addresses. Replace the coin-control mapping block:
```typescript
// When coin-control UTXOs are selected, look up the correct WIF for each
const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
const derivedMap = new Map<string, string>() // address → WIF
for (const d of derivedAddrs) {
  if (d.privateKeyWif) {
    derivedMap.set(d.address, d.privateKeyWif)
  }
}

const extendedUtxos: ExtendedUTXO[] = spendableUtxos.map(u => {
  // Check if this UTXO belongs to a derived address
  const utxoAddress = u.address || wallet.walletAddress
  const wif = derivedMap.get(utxoAddress) || wallet.walletWif
  return {
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    script: u.lockingScript || '',
    wif,
    address: utxoAddress
  }
})
```

**Step 2:** Verify `DatabaseUTXO` type includes an `address` field. If not, check the UTXO database schema — the `address` column should exist from the sync process. If `DatabaseUTXO` doesn't have `address`, add it to the type and ensure the query populates it.

**Step 3:** Run verification.

### Task 3.2: Account Derivation Index (C4)

**Files:**
- Create: `src-tauri/migrations/NNNN_add_derivation_index.sql` (use next migration number)
- Modify: `src/contexts/AccountsContext.tsx:~155-159`
- Modify: `src/services/database/` (account repository if it exists)

**Step 1:** Create migration:
```sql
ALTER TABLE accounts ADD COLUMN derivation_index INTEGER;
-- Backfill: set derivation_index = id - 1 for existing accounts (assumes sequential creation)
UPDATE accounts SET derivation_index = id - 1 WHERE derivation_index IS NULL;
```

**Step 2:** In `AccountsContext.tsx`, change the account index calculation:
```typescript
// Use max existing derivation_index to avoid collision
const existingIndices = allAccounts.map(a => (a as { derivation_index?: number }).derivation_index ?? (a.id ?? 0) - 1)
const newAccountIndex = existingIndices.length > 0
  ? Math.max(...existingIndices) + 1 : 1
```

**Step 3:** When creating the account, store the `derivation_index` in the database alongside the account record.

**Step 4:** Run verification.

### Task 3.3: Sync Cancellation on Account Switch (H7)

**Files:**
- Modify: `src/contexts/WalletContext.tsx:~230-233`
- Modify: `src/contexts/SyncContext.tsx` (if `syncPerformSync` doesn't accept cancellation)

**Step 1:** Check if `syncPerformSync` already accepts a cancellation token. If not, add one.

**Step 2:** In `performSync`, pass the current sync's cancellation token:
```typescript
const performSync = useCallback(async (isRestore = false, forceReset = false) => {
  if (!wallet) return
  const token = startNewSync() // This cancels any previous sync
  await syncPerformSync(wallet, activeAccountIdRef.current, isRestore, forceReset, token)
}, [wallet, syncPerformSync])
```

**Step 3:** Inside `syncPerformSync`, check `token.isCancelled` at key points (before each major API call batch, before DB writes).

**Step 4:** Run verification.

### Task 3.4: Frozen UTXOs in repairUTXOs (H8)

**Files:**
- Modify: `src/services/database/utxoRepository.ts:~530-560`

**Step 1:** First check if `frozen` column exists in the UTXOs table:
```bash
grep -rn 'frozen' src/services/database/ src-tauri/migrations/
```

**Step 2a:** If `frozen` column exists, add `AND frozen = 0` to both repair queries:
```sql
UPDATE utxos SET spendable = 1
WHERE spendable = 0
AND spent_at IS NULL
AND basket != 'locks'
AND frozen = 0
AND account_id = $1
```

**Step 2b:** If `frozen` column does NOT exist, check how frozen UTXOs are tracked. Look for `toggleUtxoFrozen` or similar. If frozen is tracked via a separate mechanism (e.g., a `frozen_utxos` table or a tag), add the appropriate exclusion. If there's no frozen mechanism yet, add a `frozen` column via migration:
```sql
ALTER TABLE utxos ADD COLUMN frozen INTEGER DEFAULT 0;
```

**Step 3:** Run verification.

### Task 3.5: Encapsulate transactionDepth (M9)

**Files:**
- Modify: `src/services/database/connection.ts:~16-17`

**Step 1:** Move `transactionDepth` from module-level into a closure or Map-based approach. The simplest fix: make `executeTransaction` accept and return the depth, using the queue to ensure sequential access:

Actually, the current implementation is already safe because the queue serializes all top-level transactions. The risk is only if someone calls `executeTransaction` directly. The simplest fix is to make `executeTransaction` private (not exported) and add a runtime guard:

```typescript
// Make executeTransaction truly private — only callable via withTransaction
async function executeTransaction<T>(
  operations: () => Promise<T>
): Promise<T> {
  // Guard: direct calls outside the queue at depth 0 would corrupt state
  if (transactionDepth === 0 && !isInsideQueue) {
    throw new Error('executeTransaction must be called via withTransaction()')
  }
  // ... rest of function
}
```

Add `let isInsideQueue = false` at module level, set it to `true` before running the queued operation and `false` after.

**Step 2:** Run verification.

### Task 3.6: Consolidate WocTransaction Types (M10)

**Files:**
- Modify: `src/infrastructure/api/wocClient.ts:~30-55`
- Modify: `src/services/wallet/types.ts:~95-110`
- Modify: `src/services/wallet/balance.ts` (remove `as unknown as` cast)

**Step 1:** Keep the canonical type in `src/services/wallet/types.ts` (it has `blockheight`). Add any missing fields from `wocClient.ts` (like optional `vin.vout`).

**Step 2:** In `wocClient.ts`, remove the local `WocTransaction` interface and import from `wallet/types.ts`:
```typescript
import type { WocTransaction } from '../../services/wallet/types'
```

**Step 3:** In `balance.ts`, remove the `as unknown as WocTransaction` cast — the types should now match.

**Step 4:** Run verification.

### Task 3.7: Verify Batch 3

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: 0 type errors, 0 lint errors, all tests pass.

---

## Batch 4: Architecture

### Task 4.1: BRC-100 Handler Dedup (H12)

**Files:**
- Modify: `src/services/brc100.ts`

**Step 1:** Extract `resolvePublicKey`:
```typescript
function resolvePublicKey(keys: WalletKeys, params: GetPublicKeyParams): string {
  if (params.identityKey) return keys.identityPubKey
  if (params.forOrdinals) return keys.ordPubKey
  return keys.walletPubKey
}
```

**Step 2:** Extract `resolveListOutputs`:
```typescript
async function resolveListOutputs(params: ListOutputsParams): Promise<{ outputs: OutputItem[]; totalOutputs: number }> {
  const basket = params.basket
  const includeSpent = params.includeSpent || false
  const includeTags = params.includeTags || []
  const limit = params.limit || 100
  const offset = params.offset || 0

  const currentHeight = await getCurrentBlockHeight()

  if (basket === 'wrootz_locks' || basket === 'locks') {
    const locks = await getLocksFromDB(currentHeight)
    const outputs = locks.map(lock => ({
      outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
      satoshis: lock.utxo.satoshis,
      lockingScript: lock.utxo.lockingScript,
      tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
      spendable: currentHeight >= lock.unlockBlock,
      customInstructions: JSON.stringify({
        unlockBlock: lock.unlockBlock,
        blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
      })
    }))
    return { outputs, totalOutputs: outputs.length }
  }

  let dbBasket: string = basket || BASKETS.DEFAULT
  if (basket === 'ordinals') dbBasket = BASKETS.ORDINALS
  else if (basket === 'identity') dbBasket = BASKETS.IDENTITY
  else if (!basket || basket === 'default') dbBasket = BASKETS.DEFAULT

  const utxos = await getUTXOsByBasket(dbBasket, !includeSpent)

  let filteredUtxos = utxos
  if (includeTags.length > 0) {
    filteredUtxos = utxos.filter(u =>
      u.tags && includeTags.some((tag: string) => u.tags?.includes(tag))
    )
  }

  const paginatedUtxos = filteredUtxos.slice(offset, offset + limit)

  const outputs = paginatedUtxos.map(u => ({
    outpoint: `${u.txid}.${u.vout}`,
    satoshis: u.satoshis,
    lockingScript: u.lockingScript,
    tags: u.tags || [],
    spendable: u.spendable
  }))

  return { outputs, totalOutputs: filteredUtxos.length }
}
```

**Step 3:** Replace all 3 `getPublicKey` handler blocks with calls to `resolvePublicKey()`.

**Step 4:** Replace both `listOutputs` handler blocks with calls to `resolveListOutputs()`.

**Step 5:** Run verification.

### Task 4.2: Batch Lock Detection (H10)

**Files:**
- Modify: `src/infrastructure/api/wocClient.ts` (add batch method)
- Modify: `src/services/wallet/locks.ts:~638-737`

**Step 1:** Add to wocClient:
```typescript
async getTransactionDetailsBatch(txids: string[], concurrency = 5): Promise<Map<string, WocTransaction>> {
  const results = new Map<string, WocTransaction>()

  // Process in batches of `concurrency`
  for (let i = 0; i < txids.length; i += concurrency) {
    const batch = txids.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map(async txid => {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/hash/${encodeURIComponent(txid)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        return { txid, data }
      })
    )
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.set(result.value.txid, result.value.data)
      }
    }
  }
  return results
}
```

**Step 2:** Refactor `detectLockedUtxos` to use the batch method:
- Collect all txids from history first
- Call `getTransactionDetailsBatch(txids)` once
- Iterate over results instead of making sequential calls

**Step 3:** Run verification.

### Task 4.3: Infrastructure Logger Dependency Fix (M13)

**Files:**
- Modify: `src/infrastructure/api/httpClient.ts:~12`
- Modify: `src/infrastructure/api/broadcastService.ts:~13`

**Step 1:** Check what `apiLogger` provides. If it's just `createLogger('API')`, create loggers locally in infrastructure:
```typescript
// Instead of importing from services
import { createLogger } from '../../services/logger'
// Create a local logger
const apiLogger = createLogger('API')
```

Actually, the import IS from `../../services/logger` already. The cleanest fix: move the `createLogger` factory function to `src/infrastructure/logging/index.ts` and have `src/services/logger.ts` re-export it. Or accept this as a cross-cutting concern and document it.

**Step 2:** If moving the logger, update all import paths. If documenting, add a comment in both files explaining the pragmatic exception.

**Step 3:** Run verification.

### Task 4.4: WalletContext Lock Reconciliation Extraction (M11)

**Files:**
- Create: `src/hooks/useLockReconciliation.ts`
- Modify: `src/contexts/WalletContext.tsx`

**Step 1:** Extract the 128-line lock-merge-detect logic from `WalletContext.fetchData` into a new hook or service function:
```typescript
export async function reconcileLocks(
  detectedLocks: LockedUTXO[],
  existingLocks: LockedUTXO[],
  knownUnlockedLocks: Set<string>,
  currentHeight: number,
  accountId?: number
): Promise<LockedUTXO[]> {
  // ... the merge/dedup/persist logic extracted from fetchData
}
```

**Step 2:** In WalletContext.fetchData, replace the inline logic with a call to `reconcileLocks()`.

**Step 3:** Run verification.

### Task 4.5: SettingsModal Split (M14)

**Files:**
- Create: `src/components/modals/settings/SettingsGeneral.tsx`
- Create: `src/components/modals/settings/SettingsBackup.tsx`
- Create: `src/components/modals/settings/SettingsSecurity.tsx`
- Create: `src/components/modals/settings/SettingsDebug.tsx`
- Create: `src/components/modals/settings/SettingsCache.tsx`
- Modify: `src/components/modals/SettingsModal.tsx`

**Step 1:** Identify the logical sections in SettingsModal (each section between dividers/headers). Create sub-components for each, passing necessary props/context.

**Step 2:** Replace the inline JSX in SettingsModal with the sub-components. SettingsModal becomes a thin wrapper that manages which section is shown.

**Step 3:** Each sub-component should import its own service dependencies (which will later be migrated to facade hooks in H9 — but that's a separate concern).

**Step 4:** Run verification.

### Task 4.6: Error Pattern Unification (M12/M15)

**Files:**
- Modify: `src/services/errors.ts`
- Modify: Service files that use raw error patterns

**Step 1:** Ensure `AppError.fromUnknown()` exists and works:
```typescript
static fromUnknown(error: unknown, context?: string): AppError {
  if (error instanceof AppError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AppError(message, 'UNKNOWN_ERROR', context)
}
```

**Step 2:** Start adopting at wallet service boundaries. In `src/services/wallet/transactions.ts`, `locks.ts`, `core.ts` — wrap catch blocks:
```typescript
} catch (e) {
  return err(AppError.fromUnknown(e, 'sendBSV').message)
}
```

**Step 3:** This is incremental — don't try to migrate all 61+ patterns at once. Focus on wallet operations (send, lock, unlock) and BRC-100 handlers.

**Step 4:** Run verification.

### Task 4.7: Verify Batch 4

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: 0 type errors, 0 lint errors, all tests pass.

---

## Batch 5: Quality & Low Priority

### Task 5.1: Test Coverage for Security-Critical Modules (H11)

**Files:**
- Create: `src/services/secureStorage.test.ts`
- Create: `src/services/brc100/signing.test.ts`
- Create: `src/services/certificates.test.ts`
- Create: `src/services/backupRecovery.test.ts`
- Create: `src/services/wallet/storage.test.ts`

**Step 1:** For each file, write tests covering:
- Happy path (normal operation)
- Error paths (invalid input, missing data)
- Edge cases (empty data, boundary values)
- For crypto/signing: verify output format, verify round-trip

Use `// @vitest-environment node` for tests that need Node.js crypto APIs.

Mock Tauri `invoke` calls using the existing test patterns in the codebase.

**Step 2:** Run: `npm run test:run` — all new tests should pass.

### Task 5.2: localStorage Migration (M16)

**Files:**
- Modify: 17 files with direct `localStorage` calls

**Step 1:** Search for all direct localStorage usage:
```bash
grep -rn 'localStorage\.' src/ --include='*.ts' --include='*.tsx' | grep -v 'infrastructure/storage' | grep -v 'test' | grep -v 'node_modules'
```

**Step 2:** For each file, replace direct calls with imports from the abstraction layer:
```typescript
import { storage } from '../infrastructure/storage/localStorage'
// or
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
```

Map each raw key to its `STORAGE_KEYS` equivalent. If a key doesn't exist in `STORAGE_KEYS`, add it.

**Step 3:** Run verification.

### Task 5.3: Render Optimization (M17)

**Files:**
- Modify: Components that use `useWallet()` but only need state OR actions

**Step 1:** Identify components that import `useWallet()` but only use state or only use actions:
```bash
grep -rn 'useWallet()' src/components/ --include='*.tsx'
```

**Step 2:** For components that only need state (balance, addresses, etc.), change to `useWalletState()`.
For components that only need actions (send, lock, etc.), change to `useWalletActions()`.

**Step 3:** Run verification.

### Task 5.4: Low Priority Fixes (batch)

**Fixes to apply:**

1. **handleKeyDown shared helper**: Create `src/utils/accessibility.ts` with:
```typescript
export function handleKeyDown(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}
```
Replace all 24+ inline duplicates.

2. **Dead `_messageBoxStatus`**: Remove from `SettingsModal.tsx:~89` (or its new sub-component after split).

3. **`cancellableDelay` listener cleanup**: In `src/services/cancellation.ts:~220-234`, remove the abort listener in the timeout callback.

4. **Toast timeout cleanup**: In `src/contexts/UIContext.tsx:~96-98`, track timeout IDs and clear on unmount.

5. **Password validation consistency**: In `src/services/wallet/storage.ts:~105`, use the same validation function as new wallet creation.

6. **getPublicKey CSRF**: In `src-tauri/src/http_server.rs` `getPublicKey` handler, add `validate_origin` call.

7. **Inline styles → CSS**: Move inline `style={{}}` objects from SettingsModal (now sub-components) to `App.css` or component CSS.

8. **`beforeunload` cleanup**: In `src/infrastructure/storage/localStorage.ts:~316`, return cleanup function from `registerExitCleanup()`.

**Step 1:** Apply each fix.
**Step 2:** Run verification after all low-priority fixes.

### Task 5.5: Verify Batch 5

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: 0 type errors, 0 lint errors, all tests pass.

---

## Batch 6: C1 WIF Migration (Major)

This is the largest single change. Each step must be verified independently.

### Task 6.1: Audit All WIF Usage Sites

**Step 1:** Find every location that accesses `wallet.walletWif`, `wallet.ordWif`, or `wallet.identityWif`:
```bash
grep -rn 'walletWif\|ordWif\|identityWif' src/ --include='*.ts' --include='*.tsx' | grep -v 'test' | grep -v 'node_modules' | grep -v 'types'
```

**Step 2:** Categorize each site:
- A) Already has a `_from_store` Tauri command equivalent
- B) Needs a new `_from_store` Tauri command
- C) Only needs the WIF for passing to another function (can be eliminated)
- D) Needs WIF for display/export (backup — addressed by H1)

Document the categorization before proceeding.

### Task 6.2: Create Missing Tauri Commands

**Files:**
- Modify: `src-tauri/src/key_store.rs` or `src-tauri/src/lib.rs`

For each category B site, create the corresponding Rust Tauri command that reads the WIF from the key store and performs the operation in Rust (or at minimum returns a signed result).

Key commands needed (based on review):
- `send_bsv_from_store` (if not already existing)
- `lock_bsv_from_store` (if not already existing)
- `sign_brc100_from_store`
- `encrypt_brc100_from_store`
- `export_encrypted_backup_from_store` (H1)
- `migrate_legacy_wallet` (H4)

### Task 6.3: Remove WIFs from Frontend WalletKeys Type

**Files:**
- Modify: `src/domain/types.ts` (or wherever `WalletKeys` is defined)

Make `walletWif`, `ordWif`, `identityWif` optional or remove them entirely. This will cause TypeScript errors everywhere they're accessed — which is exactly what we want. Fix each error by replacing with the appropriate `_from_store` Tauri command call.

### Task 6.4: Migrate Each Call Site

Work through each TypeScript error, file by file:
- `useWalletSend.ts` → use `send_bsv_from_store`
- `LocksContext.tsx` → use `lock_bsv_from_store`
- `TokensContext.tsx` → use token-specific `_from_store` command
- `brc100/signing.ts` → use `sign_brc100_from_store`
- `brc100/cryptography.ts` → use `encrypt_brc100_from_store`
- `SettingsModal.tsx` (backup) → use `export_encrypted_backup_from_store`
- `ReceiveModal.tsx` → if it only displays addresses (not WIFs), no change needed
- `ConsolidateModal.tsx` → use `send_bsv_from_store` variant

### Task 6.5: Mnemonic State Cleanup (M3)

**Files:**
- Modify: `src/contexts/ModalContext.tsx`

Replace `newMnemonic` useState with a flow that uses `get_mnemonic_once()` from Rust. The UI component that displays the mnemonic should call the Tauri command directly and never store the full mnemonic in React state. Add a hard auto-clear timeout as a safety net.

### Task 6.6: Session Token Documentation (M5)

**Files:**
- Modify: `src-tauri/src/lib.rs:~464-470`

Add doc comment:
```rust
/// Returns the session token for BRC-100 HTTP API authentication.
///
/// SECURITY NOTE: This token is necessarily accessible from frontend JS
/// because the SDK needs it for HTTP requests to the BRC-100 server.
/// An XSS in the webview would grant full API access. This is an accepted
/// trade-off — the CSP and Tauri's webview isolation mitigate the risk.
```

### Task 6.7: SQL Capability Scoping (M2)

**Files:**
- Modify: `src-tauri/capabilities/default.json`

Check if Tauri 2's sql plugin supports scoped permissions. If yes, restrict to specific tables or query patterns. If not, document the trade-off and consider moving the most sensitive operations (UTXO management) behind dedicated Tauri commands.

### Task 6.8: Verify Batch 6

Run: `npm run typecheck && npm run lint && npm run test:run`
Then manually test: wallet creation, send BSV, lock BSV, BRC-100 operations, backup export, account switching.

---

## Final Verification

After all 6 batches:
1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 errors
3. `npm run test:run` — all pass (expect more tests than 1098 after H11)
4. `npm run tauri:dev` — app starts, basic operations work
5. Update `REVIEW_FINDINGS.md` with remediation status
6. Update `tasks/todo.md` with completed items
7. Commit all changes
