# A-3 Continuation: Result<T,E> Migration — High-Traffic Repos

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the A-3 Result<T,E> migration for the remaining high-traffic database repositories (utxoRepository, txRepository, syncRepository, basketRepository), consolidateUtxos, and accounts.ts — converting throw/null patterns to typed Result<T, DbError | AppError> returns.

**Architecture:** `DbError` and `AppError` are already defined in `src/services/errors.ts`. `Result<T,E>`, `ok()`, `err()` are in `src/domain/types.ts`. The key design rule: `Result<T | null, DbError>` distinguishes "not found" (ok(null)) from "DB failure" (err(DbError)). Phase order: lowest-impact first (syncRepository → basketRepository → consolidateUtxos → txRepository → utxoRepository → accounts.ts). Each phase is a separate commit.

**Tech Stack:** TypeScript 5.9, Vitest, `Result<T,E>` from `src/domain/types.ts`, `DbError`/`AppError` from `src/services/errors.ts`

---

## Pre-flight

```bash
cd /Users/kitclawd/simply-sats
git checkout -b refactor/a3-continuation-result-migration
npm run typecheck   # 0 errors
npm run test:run    # 1595 tests pass
```

---

### Task 1: Migrate syncRepository.ts (3 functions, 4 callers in sync.ts only)

**Files:**
- Modify: `src/infrastructure/database/syncRepository.ts`
- Callers to update: `src/services/sync.ts`

**Step 1: Read the file**

```bash
cat src/infrastructure/database/syncRepository.ts
```

**Step 2: Understand the 3 functions**

- `getLastSyncedHeight(db)` — returns `Promise<number>` (probably returns 0 on miss)
- `updateSyncState(db, ...)` — returns `Promise<void>` (throws on error)
- `getAllSyncStates(db)` — returns `Promise<SyncState[]>` (throws on error)

**Step 3: Migrate all 3 functions**

Pattern for each:
```typescript
// BEFORE
export async function getLastSyncedHeight(db: Database): Promise<number> {
  const rows = await db.select<...>('SELECT ...')
  return rows[0]?.height ?? 0
}

// AFTER
export async function getLastSyncedHeight(db: Database): Promise<Result<number, DbError>> {
  try {
    const rows = await db.select<...>('SELECT ...')
    return ok(rows[0]?.height ?? 0)
  } catch (e) {
    return err(new DbError(`getLastSyncedHeight failed: ${e instanceof Error ? e.message : String(e)}`, 'QUERY_FAILED', e))
  }
}
```

Add import at top of file:
```typescript
import { type Result, ok, err } from '../../domain/types'
import { DbError } from '../../../services/errors'
```

Note: check the actual relative path to errors.ts from `src/infrastructure/database/` — it's likely `../../services/errors`.

**Step 4: Update callers in sync.ts**

```bash
grep -n "getLastSyncedHeight\|updateSyncState\|getAllSyncStates" src/services/sync.ts
```

For each call site, convert from try/catch or direct use to Result handling:
```typescript
// BEFORE
const height = await getLastSyncedHeight(db)
// or
try { await updateSyncState(db, ...) } catch (e) { logger.error(...) }

// AFTER
const heightResult = await getLastSyncedHeight(db)
const height = heightResult.ok ? heightResult.value : 0  // fallback on DB error
// or
const updateResult = await updateSyncState(db, ...)
if (!updateResult.ok) { logger.error('syncState update failed', updateResult.error) }
```

**Step 5: Typecheck and test**

```bash
npx tsc --noEmit
npm run test:run 2>&1 | tail -5
```

Expected: 0 errors, all tests pass.

**Step 6: Commit**

```bash
git add src/infrastructure/database/syncRepository.ts src/services/sync.ts
git commit -m "$(cat <<'EOF'
refactor(db): migrate syncRepository to Result<T,DbError> (A-3 continuation)

3 functions converted: getLastSyncedHeight, updateSyncState, getAllSyncStates.
sync.ts updated to handle Result returns.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Audit and clean up basketRepository.ts (0 callers — likely dead code)

**Files:**
- Read: `src/infrastructure/database/basketRepository.ts`
- Read: `src/infrastructure/database/index.ts`

**Step 1: Confirm it has zero callers**

```bash
grep -rn "getBaskets\|createBasket\|ensureBasket\|basketRepository" src/ --include="*.ts" --include="*.tsx" | grep -v "infrastructure/database" | grep -v ".test."
```

**Step 2: Decision**

- If 0 callers: delete the file and remove from barrel. Dead code is worse than missing code.
- If callers exist (grep lied): migrate it with the same DbError pattern as syncRepository.

**Step 3a: If deleting (preferred)**

```bash
rm src/infrastructure/database/basketRepository.ts
```

Remove the export line from `src/infrastructure/database/index.ts`:
```typescript
// Remove this line:
export * from './basketRepository'
```

Check if basket-related tables still matter (they may be used by ordinals/BSV-20 tokens). If the tables are live but the repo functions are unused, leave the file but add a comment noting it's unused.

**Step 3b: If migrating (0 callers, but keep for future use)**

Apply same DbError pattern as Task 1.

**Step 4: Typecheck and test**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(db): remove/migrate basketRepository (A-3 continuation)

Dead code removal: basketRepository had 0 call sites.
[OR: migrated to Result<T,DbError> pattern]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrate consolidateUtxos in wallet/transactions.ts (1 call site: ConsolidateModal)

**Files:**
- Modify: `src/services/wallet/transactions.ts`
- Caller: `src/components/modals/ConsolidateModal.tsx`

**Step 1: Read the current consolidateUtxos function**

```bash
grep -n "consolidateUtxos" src/services/wallet/transactions.ts
# Then read 50 lines around the function definition
```

**Step 2: Find the call site**

```bash
grep -n "consolidateUtxos" src/components/modals/ConsolidateModal.tsx
```

Note whether ConsolidateModal uses try/catch or expects a return value.

**Step 3: Write a failing test**

In `src/services/wallet/transactions.test.ts`, find the consolidateUtxos test suite. Add a test that expects Result:

```typescript
it('consolidateUtxos returns err when markUtxosPendingSpend fails', async () => {
  vi.mocked(markUtxosPendingSpend).mockRejectedValueOnce(new Error('DB error'))
  const result = await consolidateUtxos(db, keys, utxos)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error.message).toContain('DB error')
  }
})
```

Run to confirm it fails:
```bash
npx vitest run src/services/wallet/transactions.test.ts -t "consolidateUtxos" 2>&1 | tail -15
```

**Step 4: Migrate the function**

```typescript
// BEFORE
export async function consolidateUtxos(
  db: Database,
  keys: WalletKeys,
  utxos: UTXO[]
): Promise<{ txid: string; outputSats: number; fee: number }> {
  if (!accountId) throw new AppError('...', ErrorCodes.INVALID_STATE)
  // ...
}

// AFTER
export async function consolidateUtxos(
  db: Database,
  keys: WalletKeys,
  utxos: UTXO[]
): Promise<Result<{ txid: string; outputSats: number; fee: number }, AppError>> {
  if (!accountId) return err(new AppError('...', ErrorCodes.INVALID_STATE))
  // ... wrap internal throws in try/catch, return ok({...}) at success
}
```

**Step 5: Run failing test — confirm it now passes**

```bash
npx vitest run src/services/wallet/transactions.test.ts -t "consolidateUtxos"
```

**Step 6: Update ConsolidateModal.tsx call site**

```typescript
// BEFORE
try {
  const result = await consolidateUtxos(db, keys, utxos)
  setTxid(result.txid)
} catch (e) {
  setError(e instanceof Error ? e.message : 'Consolidation failed')
}

// AFTER
const result = await consolidateUtxos(db, keys, utxos)
if (!result.ok) {
  setError(result.error.message)
  return
}
setTxid(result.value.txid)
```

**Step 7: Typecheck and full test run**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -5
```

**Step 8: Commit**

```bash
git add src/services/wallet/transactions.ts src/components/modals/ConsolidateModal.tsx
git add src/services/wallet/transactions.test.ts
git commit -m "$(cat <<'EOF'
refactor(wallet): migrate consolidateUtxos to Result<T,AppError> (A-3 continuation)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migrate txRepository.ts (16 functions, ~51 call sites across 10 files)

This is the first high-traffic migration. Migrate the repo functions first, then update all callers.

**Files:**
- Modify: `src/infrastructure/database/txRepository.ts`
- Callers (10 files): `sync.ts`, `useTransactionLabels.ts`, `wallet/lockReconciliation.ts`, `SearchTab.tsx`, `brc100/locks.ts`, `brc100/actions.ts`, `useWalletInit.ts`, `useAccountSwitching.ts`, `SyncContext.tsx`, `TransactionDetailModal.tsx`

**Step 1: Read the repository**

```bash
cat src/infrastructure/database/txRepository.ts
```

Identify: which functions return `T | null` vs throw vs return arrays.

**Step 2: Migrate all 16 exported functions**

Apply the pattern:
- `getAllTransactions(db)` → `Promise<Result<Transaction[], DbError>>`
- `getTransactionByTxid(db, txid)` → `Promise<Result<Transaction | null, DbError>>`  ← null = not found
- `addTransaction(db, tx)` → `Promise<Result<void, DbError>>`
- etc.

Wrap every function body in try/catch. `ok()` for success, `err(new DbError(..., 'QUERY_FAILED'))` for failures.

**Step 3: Typecheck immediately after the repo file**

```bash
npx tsc --noEmit 2>&1 | head -40
```

This will show all the broken call sites. That's expected — use the errors to guide the next step.

**Step 4: Update call sites one file at a time**

Work through each caller file. For each `await txRepo.someFunction(db, ...)` call:
- If it used try/catch: remove try/catch, add Result check
- If it used the return value directly: unwrap with `.value` or provide fallback

Pattern for array returns (most common):
```typescript
// BEFORE
const txs = await getAllTransactions(db)
setTransactions(txs)

// AFTER
const txResult = await getAllTransactions(db)
if (!txResult.ok) {
  logger.error('Failed to load transactions', txResult.error)
  setTransactions([])
  return
}
setTransactions(txResult.value)
```

Pattern for nullable returns:
```typescript
// BEFORE
const tx = await getTransactionByTxid(db, txid)
if (!tx) return

// AFTER
const txResult = await getTransactionByTxid(db, txid)
if (!txResult.ok) {
  logger.error('DB error looking up transaction', txResult.error)
  return
}
const tx = txResult.value  // null = not found, Transaction = found
if (!tx) return
```

Pattern for void mutations:
```typescript
// BEFORE
await addTransaction(db, tx)  // throws on error

// AFTER
const addResult = await addTransaction(db, tx)
if (!addResult.ok) {
  logger.error('Failed to save transaction', addResult.error)
  // decide: throw, return, or continue
}
```

**Step 5: After updating ALL callers, typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 6: Run tests**

```bash
npm run test:run 2>&1 | tail -5
```

Expected: All pass. If tests fail, check test files for txRepository usage that also needs updating.

**Step 7: Update txRepository tests if they exist**

```bash
cat src/infrastructure/database/txRepository.test.ts 2>/dev/null | head -30 || echo "NO TEST FILE"
```

If the test file exists and uses `.rejects.toThrow()` for the migrated functions, convert those assertions to Result checks.

**Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(db): migrate txRepository to Result<T,DbError> — 16 functions, 10 callers (A-3)

All 16 exported functions now return Result<T, DbError>.
Updated all 10 caller files (~51 call sites).
Distinguishes 'not found' (ok(null)) from 'DB error' (err(DbError)).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate utxoRepository.ts (18 functions, ~60 call sites across 7 files)

The highest-traffic repo. Same pattern as Task 4 but more functions and callers.

**Files:**
- Modify: `src/infrastructure/database/utxoRepository.ts`
- Callers (7 files): `sync.ts`, `wallet/transactions.ts`, `brc100/actions.ts`, `brc100/outputs.ts`, `wallet/locks.ts`, `wallet/lockReconciliation.ts`, `SyncContext.tsx`

**Step 1: Read the repository**

```bash
cat src/infrastructure/database/utxoRepository.ts
```

Pay special attention to:
- `getUtxoByOutpoint(db, txid, vout)` — returns `UTXO | null` (not found is ok(null))
- `getSpendableUTXOs(db, accountId)` — returns array
- `markUTXOSpent(db, txid, vout)` — mutation, returns void
- `markUtxosPendingSpend(db, outpoints)` — mutation used in transactions.ts

**Step 2: Migrate all 18 exported functions**

Same pattern as txRepository. Wrap in try/catch, ok() for success, err(DbError) for failures.

Key: `getUtxoByOutpoint` should return `Result<UTXO | null, DbError>` — ok(null) = not found.

**Step 3: Typecheck to see all broken callers**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
```

**Step 4: Update all 7 caller files**

Work through each file. The callers are:

**sync.ts** (~24 calls — most complex):
- Many calls to addUTXO, markUTXOSpent, getSpendableUTXOs, etc.
- For mutations: check result, log error, continue or abort sync
- For queries: check result, use empty array/0 as fallback on DB error

**wallet/transactions.ts** (~11 calls):
- markUtxosPendingSpend, confirmUtxosSpent, rollbackPendingSpend
- These are critical — on error, return err(AppError) propagating up

**brc100/actions.ts** (~11 calls):
- Similar to transactions — propagate errors up to BRC-100 response

**brc100/outputs.ts** (~5 calls):
- Read operations mostly — use fallbacks on error

**wallet/locks.ts** (~5 calls):
- lockBSV already returns Result — update to propagate DbError → AppError

**wallet/lockReconciliation.ts** (~2 calls):
- Low traffic, straightforward update

**SyncContext.tsx** (~2 calls):
- UI layer — log errors, show partial data rather than crashing

**Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 6: Run tests**

```bash
npm run test:run 2>&1 | tail -5
```

If utxoRepository.test.ts has `.rejects.toThrow()` tests for migrated functions, update them to Result assertions.

**Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(db): migrate utxoRepository to Result<T,DbError> — 18 functions, 7 callers (A-3)

All 18 exported functions now return Result<T, DbError>.
Updated all 7 caller files (~60 call sites) including sync.ts, transactions.ts,
brc100/actions.ts, locks.ts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate accounts.ts (key user-facing functions)

**Files:**
- Modify: `src/services/accounts.ts`
- Callers: `AccountsContext.tsx`, `useAccountSwitching.ts`, possibly others

**Step 1: Read accounts.ts and identify scope**

```bash
cat src/services/accounts.ts
```

Focus on functions the UI calls directly that throw on expected errors:
- `createAccount(db, keys, name)` — throws on validation failure
- `updateAccountName(db, id, name)` — throws on DB error
- `deleteAccount(db, id)` — throws on DB error

**Skip** internal helpers and functions that already return sensible defaults (like `getAllAccounts` which returns `[]` on error).

**Step 2: Migrate the 3 key mutation functions**

```typescript
// BEFORE
export async function createAccount(db, keys, name): Promise<Account> {
  if (!name) throw new AppError('Name required', ErrorCodes.VALIDATION_ERROR)
  // ...
  return account
}

// AFTER
export async function createAccount(db, keys, name): Promise<Result<Account, AppError>> {
  if (!name) return err(new AppError('Name required', ErrorCodes.VALIDATION_ERROR))
  // ...
  return ok(account)
}
```

**Step 3: Find and update callers**

```bash
grep -rn "createAccount\|updateAccountName\|deleteAccount" src/ --include="*.ts" --include="*.tsx" | grep -v "accounts.ts" | grep -v ".test."
```

For each call site in AccountsContext.tsx and useAccountSwitching.ts, convert from try/catch to Result handling.

**Step 4: Typecheck and test**

```bash
npx tsc --noEmit && npm run test:run 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add src/services/accounts.ts
git add $(git diff --name-only)  # caller files
git commit -m "$(cat <<'EOF'
refactor(accounts): migrate mutation functions to Result<T,AppError> (A-3 continuation)

createAccount, updateAccountName, deleteAccount now return Result
instead of throwing for expected failures.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Update REVIEW_FINDINGS.md and final verification

**Step 1: Final full verification**

```bash
npm run typecheck
npm run lint 2>&1 | tail -10
npm run test:run 2>&1 | tail -5
```

Expected: 0 TypeScript errors, lint unchanged from before, all tests pass.

**Step 2: Check for remaining throw/null patterns in migrated files**

```bash
echo "=== Remaining throws in migrated repos ==="
grep -rn "throw new\b" src/infrastructure/database/ --include="*.ts" | grep -v ".test."

echo "=== Remaining nullable returns in migrated repos ==="
grep -rn "return null\b\|: Promise<.*| null>" src/infrastructure/database/ --include="*.ts" | grep -v ".test." | grep -v "// ok(null)"
```

Review any matches — they may be legitimate (constructor-level throws, programmer errors) or missed migrations.

**Step 3: Update REVIEW_FINDINGS.md**

Change A-3 from `✅ Partial` to `✅ Fixed` and update the description.

**Step 4: Final commit**

```bash
git add REVIEW_FINDINGS.md
git commit -m "$(cat <<'EOF'
docs: mark A-3 as fully complete in REVIEW_FINDINGS.md

All remaining Result<T,E> migration targets addressed:
syncRepository, basketRepository (removed), consolidateUtxos,
txRepository, utxoRepository, accounts.ts mutations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Scope Boundaries

**In scope:**
- `src/infrastructure/database/syncRepository.ts`
- `src/infrastructure/database/basketRepository.ts` (delete if unused)
- `src/infrastructure/database/txRepository.ts`
- `src/infrastructure/database/utxoRepository.ts`
- `consolidateUtxos` in `src/services/wallet/transactions.ts`
- Key mutations in `src/services/accounts.ts`

**Out of scope (do not touch):**
- `src/services/sync.ts` function signatures (it's a service layer, not a repo — only update its *calls* to repos)
- `src/services/crypto.ts` (programmer errors, not user errors)
- `src/services/keyDerivation.ts` (same)
- `src/services/brc100/` (different error model, handled in A-8)
- `getCurrentBlockHeight` (separate concern)
- Any function in accounts.ts that already has sensible fallback behavior (returns [] or null quietly)

## Error Handling Philosophy

When a DB repo function fails and the caller is in sync.ts or SyncContext.tsx:
- **Log the error** (don't silently swallow)
- **Use a safe fallback** (empty array, 0, false) to let sync continue partially
- **Don't crash the sync** — a single DB failure shouldn't stop all data loading

When a DB repo function fails and the caller is in transactions.ts or locks.ts:
- **Propagate as AppError** — user-facing operations must not silently succeed on DB failure
- Convert DbError → AppError: `new AppError(dbError.message, ErrorCodes.DATABASE_ERROR)`
