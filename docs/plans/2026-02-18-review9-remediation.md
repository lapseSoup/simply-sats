# Review #9 Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 10 open issues from Review #9 (S-19, S-20, B-16, B-17, B-18, A-10, A-11, Q-10, Q-11, Q-12).

**Architecture:** Fixes are independent and ordered by priority. Each touches a small surface area. No migrations needed. S-19 (derived WIF in DB) is the most architecturally significant — it removes the WIF column from active use and re-derives keys at spend time. All other fixes are 1-5 line changes.

**Tech Stack:** TypeScript 5.9, React 19, Vitest, Rust/Tauri (S-20 only)

---

## Task 1: B-18 — Fix misleading error code on rollback failure (quick win)

**Files:**
- Modify: `src/services/errors.ts` (add new error code)
- Modify: `src/services/wallet/transactions.ts:120-129` (use correct code)

**Context:** When broadcast fails AND rollback fails, the code uses `BROADCAST_SUCCEEDED_DB_FAILED` (-32018) which is semantically wrong — broadcast did NOT succeed. No runtime impact (message string is what UI checks), but confusing in logs and BRC-100 error responses.

**Step 1: Add new error code to errors.ts**

In `src/services/errors.ts`, find the `ErrorCodes` object (line ~9). After `BROADCAST_SUCCEEDED_DB_FAILED: -32018`, add:

```typescript
  UTXO_STUCK_IN_PENDING: -32020
```

**Step 2: Use correct code in transactions.ts**

In `src/services/wallet/transactions.ts` around line 120, change:
```typescript
// BEFORE:
      throw new AppError(
        'Transaction failed and wallet state could not be fully restored. Your balance may appear incorrect until the next sync.',
        ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED,
```
to:
```typescript
// AFTER:
      throw new AppError(
        'Transaction failed and wallet state could not be fully restored. Your balance may appear incorrect until the next sync.',
        ErrorCodes.UTXO_STUCK_IN_PENDING,
```

Also update the comment above it from:
```typescript
      // Surface this as a BROADCAST_SUCCEEDED_DB_FAILED-style error so the
      // UI can warn the user their wallet may show incorrect balances until
      // the next sync (which will clean up the stale pending status).
```
to:
```typescript
      // Both broadcast AND rollback failed — UTXOs are stuck in pending state.
      // User sees an error (the tx was NOT sent). Next sync will clean up stale pending status.
```

**Step 3: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/services/errors.ts src/services/wallet/transactions.ts
git commit -m "fix(errors): use UTXO_STUCK_IN_PENDING code when broadcast+rollback both fail (B-18)"
```

---

## Task 2: A-11 — Add DbError→AppError bridge

**Files:**
- Modify: `src/services/errors.ts` (add `toAppError()` method to `DbError` class)

**Context:** `DbError extends Error` (not `AppError`). When DB repos return `Result<T, DbError>`, callers who call `AppError.fromUnknown(dbErr)` lose the structured `DbError.code`. Need a bridge.

**Step 1: Add `toAppError()` method to `DbError` class**

In `src/services/errors.ts`, find the `DbError` class (line ~294). After the constructor, add:

```typescript
  /**
   * Convert to AppError, preserving the DbError code in context.
   * Use this when surfacing DB errors through the AppError hierarchy.
   */
  toAppError(): AppError {
    return new AppError(this.message, ErrorCodes.DATABASE_ERROR, {
      dbCode: this.code,
      originalError: this.cause instanceof Error ? this.cause.message : String(this.cause ?? '')
    })
  }
```

**Step 2: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/services/errors.ts
git commit -m "feat(errors): add DbError.toAppError() bridge to preserve dbCode in AppError context (A-11)"
```

---

## Task 3: B-16 — Type knownUnlockedLocksRef as read-only in context

**Files:**
- Modify: `src/contexts/LocksContext.tsx` (change interface type only)

**Context:** `knownUnlockedLocksRef: MutableRefObject<Set<string>>` is in the context interface. Consumers can mutate `current` directly, bypassing `addKnownUnlockedLock()`. Typing it as `Readonly` signals the intent — consumers should read `.current` but not replace it.

**Step 1: Update the context interface type**

In `src/contexts/LocksContext.tsx`, find the interface property (around line 17):
```typescript
  /** Ref to knownUnlockedLocks — always current, safe to read inside stale closures */
  knownUnlockedLocksRef: MutableRefObject<Set<string>>
```
Change to:
```typescript
  /** Ref to knownUnlockedLocks — always current, safe to READ inside stale closures. Do not reassign .current. */
  knownUnlockedLocksRef: Readonly<MutableRefObject<Set<string>>>
```

**Step 2: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors (the value passed in is `MutableRefObject` which is assignable to `Readonly<MutableRefObject>`)

**Step 3: Commit**

```bash
git add src/contexts/LocksContext.tsx
git commit -m "fix(locks): type knownUnlockedLocksRef as Readonly in context interface (B-16)"
```

---

## Task 4: B-17 — syncAddress DB failure should throw, not return zero balance

**Files:**
- Modify: `src/services/sync.ts:268-273`
- Modify: `src/services/sync.test.ts` (add test for this path — covers Q-11 too)

**Context:** Post-A-3 migration, if `getSpendableUTXOs()` returns `!ok`, `syncAddress` returns `{ totalBalance: 0 }`. This silently zeroes the balance on a transient DB error. The pre-migration behavior (throw) was better: the caller in SyncContext caught it and preserved the stale balance.

**Step 1: Change the early return to a throw**

In `src/services/sync.ts` around line 268:
```typescript
// BEFORE:
  const spendableResult = await getSpendableUTXOs(accountId)
  if (!spendableResult.ok) {
    syncLogger.error(`[SYNC #${syncId}] Failed to query existing UTXOs from DB`, { error: spendableResult.error.message })
    return { address, basket, newUtxos: 0, spentUtxos: 0, totalBalance: 0 }
  }
  const existingUtxos = spendableResult.value
```
Change to:
```typescript
// AFTER:
  const spendableResult = await getSpendableUTXOs(accountId)
  if (!spendableResult.ok) {
    syncLogger.error(`[SYNC #${syncId}] Failed to query existing UTXOs from DB`, { error: spendableResult.error.message })
    throw spendableResult.error.toAppError()
  }
  const existingUtxos = spendableResult.value
```

Note: `spendableResult.error` is a `DbError` which now has `.toAppError()` (added in Task 2).

**Step 2: Write the failing test (Q-11)**

In `src/services/sync.test.ts`, find where existing `syncAddress` tests live (around line 115). Add a new test after the existing `syncAddress` describe block:

```typescript
it('throws when getSpendableUTXOs fails (preserves stale balance in caller)', async () => {
  // Arrange: WoC returns UTXOs, but DB query fails
  vi.mocked(wocClient.getUtxos).mockResolvedValueOnce([
    { txid: 'a'.repeat(64), vout: 0, satoshis: 5000, script: '76a914' + '0'.repeat(40) + '88ac' }
  ])
  vi.mocked(getSpendableUTXOs).mockResolvedValueOnce({
    ok: false,
    error: new DbError('DB locked', 'QUERY_FAILED')
  })

  // Act + Assert: should throw, not silently return 0
  await expect(
    syncAddress({ address: TEST_ADDRESS, accountId: 1, basket: 'default' })
  ).rejects.toThrow('DB locked')
})
```

**Step 3: Run the failing test**

```bash
cd /Users/kitclawd/simply-sats && npm run test:run -- sync.test
```
Expected: the new test FAILS (currently returns `{ totalBalance: 0 }` instead of throwing)

**Step 4: Apply the fix from Step 1, then run tests again**

```bash
cd /Users/kitclawd/simply-sats && npm run test:run -- sync.test
```
Expected: all tests pass including the new one

**Step 5: Run full typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/services/sync.ts src/services/sync.test.ts
git commit -m "fix(sync): throw on DB failure in syncAddress instead of returning zero balance (B-17, Q-11)"
```

---

## Task 5: A-10 — renameAccount returns boolean, surfaces error to UI

**Files:**
- Modify: `src/contexts/AccountsContext.tsx:220-238` (return `Promise<boolean>`, update interface)
- Modify: `src/components/modals/AccountManageList.tsx:15,40-44` (update prop type, handle false return)
- Modify: `src/components/modals/AccountModal.tsx:26` (update prop type)

**Context:** `renameAccount` returns `Promise<void>` even on failure. `AccountManageList` wraps it in try/catch expecting an exception — but since A-3, it returns on error instead of throwing, so the catch never fires. Need to return `boolean` so the component can show an error.

**Step 1: Update AccountsContext.tsx**

In `src/contexts/AccountsContext.tsx`, find the `renameAccount` callback (line ~222):
```typescript
// BEFORE:
  const renameAccount = useCallback(async (accountId: number, name: string): Promise<void> => {
    const result = await updateAccountName(accountId, name)
    if (!result.ok) {
      accountLogger.error('Failed to rename account', result.error)
    }
    await refreshAccounts()
  }, [refreshAccounts])
```
Change to:
```typescript
// AFTER:
  const renameAccount = useCallback(async (accountId: number, name: string): Promise<boolean> => {
    const result = await updateAccountName(accountId, name)
    if (!result.ok) {
      accountLogger.error('Failed to rename account', result.error)
      return false
    }
    await refreshAccounts()
    return true
  }, [refreshAccounts])
```

Also update **two** interfaces:

In `src/contexts/AccountsContext.tsx` (find `renameAccount:` in the `AccountsContextType` interface, around line 28):
```typescript
// BEFORE:
  renameAccount: (accountId: number, name: string) => Promise<void>
// AFTER:
  renameAccount: (accountId: number, name: string) => Promise<boolean>
```

In `src/contexts/WalletActionsContext.tsx:24`:
```typescript
// BEFORE:
  renameAccount: (accountId: number, name: string) => Promise<void>
// AFTER:
  renameAccount: (accountId: number, name: string) => Promise<boolean>
```

**Step 2: Update AccountManageList.tsx**

In `src/components/modals/AccountManageList.tsx`:

Update the prop type (line 15):
```typescript
// BEFORE:
  onRenameAccount?: (accountId: number, name: string) => Promise<void>
// AFTER:
  onRenameAccount?: (accountId: number, name: string) => Promise<boolean>
```

Update `handleRename` (lines 36-46):
```typescript
// BEFORE:
  const handleRename = async (accountId: number) => {
    if (!onRenameAccount || !editName.trim()) return

    try {
      await onRenameAccount(accountId, editName.trim())
      setEditingId(null)
      setEditName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename account')
    }
  }

// AFTER:
  const handleRename = async (accountId: number) => {
    if (!onRenameAccount || !editName.trim()) return

    const success = await onRenameAccount(accountId, editName.trim())
    if (success) {
      setEditingId(null)
      setEditName('')
    } else {
      setError('Failed to rename account')
    }
  }
```

**Step 3: Update AccountModal.tsx**

In `src/components/modals/AccountModal.tsx`, line 26:
```typescript
// BEFORE:
  onRenameAccount?: (accountId: number, name: string) => Promise<void>
// AFTER:
  onRenameAccount?: (accountId: number, name: string) => Promise<boolean>
```

**Step 4: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors. If there are errors mentioning `onRenameAccount`, check if `useAccountSwitching.ts` or `AppModals.tsx` pass `renameAccount` through — update those prop type annotations to match.

**Step 5: Run tests**

```bash
cd /Users/kitclawd/simply-sats && npm run test:run
```
Expected: all pass

**Step 6: Commit**

```bash
git add src/contexts/AccountsContext.tsx src/contexts/WalletActionsContext.tsx src/components/modals/AccountManageList.tsx src/components/modals/AccountModal.tsx
git commit -m "fix(accounts): renameAccount returns boolean so UI can detect and display failure (A-10)"
```

---

## Task 6: Q-10 — Fix function ordering in ReceiveModal

**Files:**
- Modify: `src/components/modals/ReceiveModal.tsx`

**Context:** `deriveReceiveAddress` and `saveDerivedAddress` are defined before the `if (!wallet) return null` guard, but later handlers (`handleContactSelect`, etc.) are defined after it. All should be after the guard consistently — but since these are regular functions (not hooks), the safe approach is to move the `return null` guard to just before the JSX, after all function definitions.

**Step 1: Move the early return guard**

In `src/components/modals/ReceiveModal.tsx`, the current structure is:
- line 39: `if (!wallet) return null`
- lines 41-82: function definitions
- lines 84+: more function definitions + JSX

Change to: remove the `if (!wallet) return null` at line 39, and add it just before the `return (` of the JSX (find the line that starts `return (` near the end of the component, before the `<>` or `<Modal`):

```typescript
// Add this immediately before the return statement that renders JSX:
  if (!wallet) return null

  return (
    // ... existing JSX
  )
```

**Step 2: Run typecheck and tests**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck && npm run test:run
```
Expected: 0 errors, all tests pass

**Step 3: Commit**

```bash
git add src/components/modals/ReceiveModal.tsx
git commit -m "refactor(ui): move early return guard to after function defs in ReceiveModal (Q-10)"
```

---

## Task 7: Q-12 — Route feeFromBytes through adapter in BRC100Modal

**Files:**
- Modify: `src/components/modals/BRC100Modal.tsx:2` (change import source)

**Context:** `BRC100Modal` imports `feeFromBytes` directly from `../../services/wallet`. Components should import through `../../adapters/walletAdapter` (which already re-exports `feeFromBytes`). This is already caught by the existing ESLint `no-restricted-imports` rule.

**Step 1: Change the import**

In `src/components/modals/BRC100Modal.tsx`, line 2:
```typescript
// BEFORE:
import { feeFromBytes } from '../../services/wallet'
// AFTER:
import { feeFromBytes } from '../../adapters/walletAdapter'
```

**Step 2: Run lint and typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run lint && npm run typecheck
```
Expected: 0 errors, and one fewer `no-restricted-imports` warning (53 instead of 54)

**Step 3: Commit**

```bash
git add src/components/modals/BRC100Modal.tsx
git commit -m "fix(imports): route feeFromBytes through walletAdapter in BRC100Modal (Q-12)"
```

---

## Task 8: S-19 — Remove child WIF from DB; re-derive at spend time

**Files:**
- Modify: `src/components/modals/ReceiveModal.tsx:55-82` (stop storing WIF)
- Modify: `src/hooks/useWalletSend.ts:58-107` (re-derive WIF at spend time)
- Modify: `src/infrastructure/database/addressRepository.ts` (make `privateKeyWif` optional in type)

**Context:** `saveDerivedAddress` writes `childPrivKey.toWif()` to the `derived_addresses` table. If the DB is exfiltrated, all BRC-42 derived key funds are compromised. Fix: store only the data already in the DB (`senderPubkey`, `invoiceNumber`) and re-derive the child key at spend time using the wallet's identity WIF (which is available via `getWifForOperation`).

The `derived_addresses` table already stores `sender_pubkey` and `invoice_number` — everything needed to re-derive.

**Step 1: Make `privateKeyWif` optional in the DB type**

In `src/infrastructure/database/addressRepository.ts`, find the `DerivedAddress` interface/type. Change:
```typescript
  privateKeyWif: string
```
to:
```typescript
  privateKeyWif?: string  // Deprecated: do not store; re-derive from senderPubkey+invoiceNumber at spend time
```

Also update `addDerivedAddress` — if `privateKeyWif` is in the INSERT statement, make it conditional:
```typescript
// In the INSERT SQL, change the privateKeyWif column to insert NULL when not provided:
// Find the INSERT and change the value to: derivedAddr.privateKeyWif ?? null
```

**Step 2: Stop storing WIF in ReceiveModal**

In `src/components/modals/ReceiveModal.tsx`, in `saveDerivedAddress` (around lines 55-82):
```typescript
// BEFORE:
      const childPrivKey = deriveChildPrivateKey(receiverPriv, senderPub, invoiceNumber)

      await addDerivedAddress({
        address,
        senderPubkey: senderPubKey,
        invoiceNumber,
        privateKeyWif: childPrivKey.toWif(),   // ← remove this line
        label: label || `From ${senderPubKey.substring(0, 8)}...`,
        createdAt: Date.now()
      }, activeAccountId ?? undefined)

// AFTER (remove childPrivKey derivation and the privateKeyWif field):
      await addDerivedAddress({
        address,
        senderPubkey: senderPubKey,
        invoiceNumber,
        label: label || `From ${senderPubKey.substring(0, 8)}...`,
        createdAt: Date.now()
      }, activeAccountId ?? undefined)
```

Also remove the import of `deriveChildPrivateKey` from `ReceiveModal.tsx` if it's no longer used anywhere in the file (check if `deriveChildPrivateKey` is still called elsewhere in that file).

**Step 3: Re-derive child key at spend time in useWalletSend**

In `src/hooks/useWalletSend.ts`, in the `handleSend` callback, the code currently reads derived address WIFs from the DB:
```typescript
// Around line 63-68:
      const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
      for (const d of derivedAddrs) {
        if (d.privateKeyWif) {
          derivedMap.set(d.address, d.privateKeyWif)
        }
      }
```

Replace with re-derivation:
```typescript
      const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
      for (const d of derivedAddrs) {
        if (d.privateKeyWif) {
          // Legacy: stored WIF (still use it if present, for backwards compatibility)
          derivedMap.set(d.address, d.privateKeyWif)
        } else if (d.senderPubkey && d.invoiceNumber) {
          // New path: re-derive from senderPubkey + invoiceNumber
          try {
            const { PrivateKey, PublicKey } = await import('@bsv/sdk')
            const { deriveChildPrivateKey } = await import('../services/keyDerivation')
            const identityWif = await getWifForOperation('identity', 'rederiveChild', wallet)
            const receiverPriv = PrivateKey.fromWif(identityWif)
            const senderPub = PublicKey.fromString(d.senderPubkey)
            const childKey = deriveChildPrivateKey(receiverPriv, senderPub, d.invoiceNumber)
            derivedMap.set(d.address, childKey.toWif())
          } catch (e) {
            walletLogger.warn('Failed to re-derive child key for derived address, skipping', {
              address: d.address,
              error: e instanceof Error ? e.message : String(e)
            })
          }
        }
      }
```

Note: The dynamic imports (`await import(...)`) keep the wallet module lazy. Alternatively, add static imports at the top of `useWalletSend.ts` if `deriveChildPrivateKey` and `PrivateKey`/`PublicKey` are already imported elsewhere in the file.

**Step 4: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: 0 errors. If `privateKeyWif` is referenced as non-optional somewhere else in the DB layer, TypeScript will flag it — add `?? null` or `?? ''` as appropriate.

**Step 5: Run tests**

```bash
cd /Users/kitclawd/simply-sats && npm run test:run
```
Expected: all pass. The test mocks don't test the re-derive path directly, but no existing tests should break.

**Step 6: Commit**

```bash
git add src/components/modals/ReceiveModal.tsx src/hooks/useWalletSend.ts src/infrastructure/database/addressRepository.ts
git commit -m "security(s19): stop storing derived child WIF in SQLite; re-derive from senderPubkey+invoiceNumber at spend time"
```

---

## Task 9: S-20 — Add trusted-origin check to createAction/lockBSV/unlockBSV in Rust

**Files:**
- Modify: `src-tauri/src/http_server.rs`

**Context:** `createAction`, `lockBSV`, `unlockBSV` handlers rely solely on session token + CSRF nonce. Read-only ops already check trusted origins. Apply the same origin check to state-changing ops for defense-in-depth.

**Step 1: Find the existing trusted-origin check helper**

In `src-tauri/src/http_server.rs`, search for how trusted origins are currently checked (look for `check_trusted_origin`, `trusted_origins`, or `Origin` header handling). Understand the existing pattern before applying it.

**Step 2: Apply the same origin check to createAction handler**

Find the `createAction` handler function. Before the existing token validation (or right after it), add the same origin check that read-only ops use. The exact code depends on the existing helper — replicate the pattern exactly.

If there's a helper like `check_trusted_origin(&state, &headers)`, add:
```rust
// After session token check, before processing the request:
check_trusted_origin(&state, &headers).await?;
```

Apply the same pattern to `lockBSV` and `unlockBSV` handlers.

**Step 3: Build the Tauri backend**

```bash
cd /Users/kitclawd/simply-sats && npx tauri build --debug 2>&1 | tail -20
```
Or just check compilation:
```bash
cd /Users/kitclawd/simply-sats/src-tauri && cargo check 2>&1 | tail -20
```
Expected: compiles cleanly

**Step 4: Commit**

```bash
git add src-tauri/src/http_server.rs
git commit -m "security(s20): apply trusted-origin validation to createAction/lockBSV/unlockBSV handlers"
```

---

## Task 10: Update REVIEW_FINDINGS.md

Mark all fixed issues in `REVIEW_FINDINGS.md`:

- S-19 → ✅ Fixed (v6) — `ReceiveModal.tsx` + `useWalletSend.ts`: WIF no longer stored; re-derived at spend time
- B-18 → ✅ Fixed (v6) — `transactions.ts:122`: uses `UTXO_STUCK_IN_PENDING` code
- A-11 → ✅ Fixed (v6) — `errors.ts`: `DbError.toAppError()` bridge added
- B-16 → ✅ Fixed (v6) — `LocksContext.tsx:17`: `Readonly<MutableRefObject<...>>` in interface
- B-17 → ✅ Fixed (v6) — `sync.ts:271`: throws on DB failure instead of returning 0
- Q-11 → ✅ Fixed (v6) — `sync.test.ts`: test added for DB failure path in `syncAddress`
- A-10 → ✅ Fixed (v6) — `AccountsContext.tsx:222` + `AccountManageList.tsx`: returns boolean, error shown to user
- Q-10 → ✅ Fixed (v6) — `ReceiveModal.tsx`: guard moved to after all function defs
- Q-12 → ✅ Fixed (v6) — `BRC100Modal.tsx:2`: imports from `walletAdapter` not `services/wallet`
- S-20 → ✅ Fixed (v6) — `http_server.rs`: trusted-origin check on `createAction`/`lockBSV`/`unlockBSV`

Update the Summary table totals and rating to reflect 60/60 fixed.

```bash
git add REVIEW_FINDINGS.md
git commit -m "docs: mark all Review #9 issues fixed in REVIEW_FINDINGS.md"
```

---

## Verification

After all tasks:

```bash
cd /Users/kitclawd/simply-sats
npm run typecheck   # must be 0 errors
npm run lint        # must be 0 errors (warnings OK, but count should drop by 1 for Q-12)
npm run test:run    # all 657+ tests must pass
```

Final state: REVIEW_FINDINGS.md shows 60/60 issues resolved. Rating 9.5+/10.
