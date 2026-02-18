# A-3: Result<T,E> Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the wallet service layer from exception-throwing and nullable-return error handling to the `Result<T,E>` pattern already established in `httpClient.ts`, starting with the highest-value Tier 1 targets (wallet/transactions/sync) and progressing to Tier 2 (database repositories).

**Architecture:** `Result<T,E>` is already defined in `src/domain/types.ts` with `ok()`, `err()`, `isOk()`, `isErr()`, `mapResult()` helpers. `httpClient.ts` is the reference implementation. `WalletResult = Result<{txid: string}, string>` is already used in the context layer. The migration adds typed error variants per domain (`WalletError`, `DbError`) and converts functions tier-by-tier: Tier 1 = core wallet ops (transactions, core, sync); Tier 2 = database repositories. Tests are updated from `.rejects.toThrow()` to `isErr()` assertions. Context call sites are updated after each tier. **Do not** convert BRC-100 services or crypto primitives in this pass — those have different error models.

**Tech Stack:** TypeScript, Vitest (TDD), `Result<T,E>` from `src/domain/types.ts`

---

## Pre-flight

```bash
cd /Users/kitclawd/simply-sats
git checkout main    # Start from main after A-9 and A-8 are merged
git checkout -b refactor/a3-result-migration
npm run typecheck
npm run test:run
```

---

### Task 1: Define domain error types

**Files:**
- Modify: `src/domain/types.ts` OR create `src/services/errors.ts` (check if it exists first)

**Step 1: Check what already exists**

```bash
cat src/services/errors.ts 2>/dev/null || echo "FILE NOT FOUND"
grep -n "AppError\|WalletError\|DbError\|ErrorCodes" src/services/errors.ts src/domain/types.ts 2>/dev/null | head -30
```

**Step 2: Read the existing error definitions**

Read `src/services/errors.ts` fully. Note what `AppError`, `ErrorCodes`, and any wallet error types already exist.

**Step 3: Add `DbError` type if not present**

In `src/services/errors.ts`, add if missing:

```typescript
export class DbError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'QUERY_FAILED' | 'CONSTRAINT' | 'CONNECTION',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'DbError'
  }
}
```

**Step 4: Ensure `WalletError` covers Tier 1 error cases**

The wallet services throw `AppError` with `ErrorCodes`. Verify `AppError` has `code` and `message`. If `WalletResult = Result<{txid: string}, string>` is too loose (string errors), consider whether to keep it for UI simplicity or tighten it. **Recommendation: keep `WalletResult` as-is for UI-facing results; use `Result<T, AppError>` for internal service functions.**

**Step 5: Commit error types**

```bash
git add src/services/errors.ts src/domain/types.ts
git commit -m "feat(errors): add DbError type for database Result migration (A-3)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Tier 1a — Migrate `wallet/transactions.ts`

This is the highest-value migration target: `sendBSV`, `sendBSVMultiKey`, `broadcastTransaction`.

**Files:**
- Read: `src/services/wallet/transactions.ts`
- Modify: `src/services/wallet/transactions.ts`
- Modify: `src/services/wallet/transactions.test.ts` (if exists) or create it

**Step 1: Read the file**

```bash
cat src/services/wallet/transactions.ts
```

Note all exported functions and where they throw (`InvalidAmountError`, `InvalidAddressError`, `InsufficientFundsError`, `AppError`).

**Step 2: Write failing tests for Result-based signatures**

In `src/services/wallet/transactions.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { isErr, isOk } from '../../domain/types'
// Import functions under test

describe('sendBSV returns Result', () => {
  it('returns err for invalid amount', async () => {
    const result = await sendBSV({ amount: -1, /* ...other params */ })
    expect(isErr(result)).toBe(true)
    if (!isOk(result)) {
      expect(result.error.code).toBe('INVALID_AMOUNT')
    }
  })

  it('returns err for insufficient funds', async () => {
    const result = await sendBSV({ amount: 999999999, /* ...params with empty utxos */ })
    expect(isErr(result)).toBe(true)
  })
})
```

**Step 3: Run to confirm tests fail**

```bash
npx vitest run src/services/wallet/transactions.test.ts 2>&1 | tail -20
```

**Step 4: Convert `sendBSV` signature**

```typescript
// BEFORE
export async function sendBSV(params: SendParams): Promise<{ txid: string }> {
  if (params.amount <= 0) throw new InvalidAmountError('Amount must be positive')
  // ...
  return { txid }
}

// AFTER
export async function sendBSV(params: SendParams): Promise<Result<{ txid: string }, AppError>> {
  if (params.amount <= 0) return err(new AppError('Amount must be positive', ErrorCodes.INVALID_AMOUNT))
  // ...
  return ok({ txid })
}
```

Apply same pattern to `sendBSVMultiKey` and `broadcastTransaction`.

**Step 5: Run tests — confirm pass**

```bash
npx vitest run src/services/wallet/transactions.test.ts
```

**Step 6: Fix call sites**

```bash
grep -rn "sendBSV\|sendBSVMultiKey\|broadcastTransaction" src/ --include="*.ts" --include="*.tsx" | grep -v "transactions.ts" | grep -v ".test.ts"
```

For each call site (likely in `useWalletSend.ts`, `WalletActionsContext.tsx`), update to unwrap the Result:

```typescript
// BEFORE
try {
  const { txid } = await sendBSV(params)
  onSuccess(txid)
} catch (e) {
  onError(e.message)
}

// AFTER
const result = await sendBSV(params)
if (!result.ok) {
  onError(result.error.message)
  return
}
onSuccess(result.value.txid)
```

**Step 7: Typecheck + test**

```bash
npx tsc --noEmit && npm run test:run
```

**Step 8: Commit**

```bash
git add src/services/wallet/transactions.ts src/services/wallet/transactions.test.ts
git add $(git diff --name-only)  # call sites
git commit -m "refactor(wallet): migrate transactions.ts to Result<T,E> pattern

sendBSV, sendBSVMultiKey, broadcastTransaction now return Result
instead of throwing for expected error conditions (A-3 Tier 1a).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Tier 1b — Migrate `wallet/core.ts`

**Files:**
- Read: `src/services/wallet/core.ts`
- Modify: `src/services/wallet/core.ts`

**Step 1: Read the file, identify exported throwing functions**

```bash
grep -n "export.*async\|throw new\|throw " src/services/wallet/core.ts | head -40
```

**Step 2: Write failing tests**

Focus on `createWallet`, `restoreWallet`, `importFromShaullet`:

```typescript
describe('createWallet returns Result', () => {
  it('returns err for weak password', async () => {
    const result = await createWallet({ password: 'short', mnemonic: undefined })
    expect(isErr(result)).toBe(true)
  })
})
```

**Step 3: Convert functions to Result returns**

Same pattern as Task 2: replace `throw` with `return err(...)`, wrap success with `return ok(...)`.

**Step 4: Fix call sites**

```bash
grep -rn "createWallet\|restoreWallet\|importFromShaullet" src/ --include="*.ts" --include="*.tsx" | grep -v "core.ts" | grep -v ".test.ts"
```

Update each call site.

**Step 5: Typecheck + test + commit**

```bash
npx tsc --noEmit && npm run test:run
git add -A
git commit -m "refactor(wallet): migrate core.ts to Result<T,E> pattern (A-3 Tier 1b)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Tier 1c — Migrate `wallet/locks.ts`

**Files:**
- Read: `src/services/wallet/locks.ts`
- Modify: `src/services/wallet/locks.ts`

Apply same pattern: read, write failing tests, convert throw→err, fix call sites, typecheck, commit.

Key functions: `lockBSV`, `unlockBSV`, `createTimeLock`.

```bash
git commit -m "refactor(wallet): migrate locks.ts to Result<T,E> pattern (A-3 Tier 1c)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Tier 2a — Migrate `database/utxoRepository.ts`

Database repositories return `T | null`. Migrate to `Result<T, DbError>`.

**Files:**
- Read: `src/infrastructure/database/utxoRepository.ts` (after A-9 is merged; or `src/services/database/utxoRepository.ts` if A-9 is not yet merged)
- Modify: same file
- Modify: `src/infrastructure/database/utxoRepository.test.ts`

**Step 1: Read the file**

Identify functions returning `Promise<T | null>` or throwing.

**Step 2: Write failing tests**

```typescript
describe('getUtxo returns Result', () => {
  it('returns err NOT_FOUND for missing utxo', async () => {
    const result = await getUtxo(db, 'nonexistent-txid', 0)
    expect(isErr(result)).toBe(true)
    if (!isOk(result)) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
  })
})
```

**Step 3: Convert signatures**

```typescript
// BEFORE
export async function getUtxo(db: Database, txid: string, vout: number): Promise<UTXO | null>

// AFTER
export async function getUtxo(db: Database, txid: string, vout: number): Promise<Result<UTXO, DbError>>
```

**Step 4: Fix call sites (SyncContext, useUtxoManagement, etc.)**

```bash
grep -rn "getUtxo\|getAllUtxos\|saveUtxo\|deleteUtxo" src/ --include="*.ts" --include="*.tsx" | grep -v "utxoRepository"
```

**Step 5: Typecheck + test + commit**

```bash
npx tsc --noEmit && npm run test:run
git add -A
git commit -m "refactor(db): migrate utxoRepository to Result<T,DbError> (A-3 Tier 2a)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Tier 2b — Migrate remaining database repositories

Apply same pattern to each remaining repo in order of risk (lower-traffic first):

1. `contactRepository.ts` (low traffic, simple CRUD)
2. `addressRepository.ts` (low traffic)
3. `actionRepository.ts` (BRC-100 action log)
4. `txRepository.ts` (medium traffic)
5. `lockRepository.ts` (medium traffic)
6. `syncRepository.ts` (high traffic — do last)

**For each repository:**
1. Read the file
2. Write failing tests
3. Convert `T | null` returns to `Result<T, DbError>`
4. Fix call sites
5. Typecheck + test
6. Commit with message: `refactor(db): migrate <name>Repository to Result (A-3 Tier 2b)`

---

### Task 7: Update tests that use `.rejects.toThrow()`

After the service migrations, some tests will still use exception-assertion style. Find and fix them.

**Step 1: Find remaining exception-style tests**

```bash
grep -rn "rejects.toThrow\|toThrowError" src/ --include="*.test.ts" | grep -v ".test.ts.bak"
```

**Step 2: For each match**, convert to Result assertion:

```typescript
// BEFORE
await expect(sendBSV(badParams)).rejects.toThrow('Invalid amount')

// AFTER
const result = await sendBSV(badParams)
expect(isErr(result)).toBe(true)
expect(result.ok ? '' : result.error.message).toContain('Invalid amount')
```

**Step 3: Run tests**

```bash
npm run test:run
```

Expected: All pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update exception assertions to Result-style for migrated services (A-3)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

```bash
npm run typecheck
npm run lint
npm run test:run
```

Expected: 0 TypeScript errors, lint clean, all tests pass.

**Check Result adoption coverage:**

```bash
echo "=== Functions still throwing (check for any missed) ==="
grep -rn "throw new AppError\|throw new InvalidAmount" src/services/wallet/ src/services/database/ --include="*.ts"

echo "=== Functions still returning null (check for any missed) ==="
grep -rn "return null\|Promise<.*| null>" src/services/wallet/ src/services/database/ --include="*.ts" | grep -v ".test.ts" | grep -v "//.*return null"
```

Review matches and migrate any stragglers.

**Final push and PR:**

```bash
git push -u origin refactor/a3-result-migration
```

Open PR: `refactor/a3-result-migration` → `main`

---

## Scope Boundaries

**In scope:**
- `src/services/wallet/transactions.ts`, `core.ts`, `locks.ts`
- `src/infrastructure/database/` all 10 repos (or `src/services/database/` if A-9 not merged yet)
- Call sites in hooks and contexts

**Out of scope (separate pass):**
- `src/services/brc100/` (different error model, handled in A-8 or separately)
- `src/services/crypto.ts` (crypto primitives — exceptions are appropriate for programming errors)
- `src/services/keyDerivation.ts` (BIP-44 errors are programmer errors, not user errors)
- `src/services/sync.ts` (complex cancellation logic — do in a follow-up)
- `src/services/tokens.ts` (low priority, few call sites)
