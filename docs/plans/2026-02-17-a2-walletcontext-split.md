# A-2: WalletContext God Object Split

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break the 79-property WalletContext God Object into focused sub-contexts and migrate all 16 consumers to use specific hooks instead of the monolithic `useWallet()`, reducing unnecessary re-renders and improving separation of concerns.

**Architecture:** The context is already split internally (`WalletStateContext` + `WalletActionsContext`) but `useWallet()` merges them back together, defeating the purpose. The approach: (1) expose `useWalletState()` and `useWalletActions()` as the primary consumer API; (2) make `useWallet()` a deprecated convenience wrapper; (3) migrate the 16 consumers to use specific hooks. Do NOT create new micro-contexts — the existing `SyncContext`, `LocksContext`, `AccountsContext`, `TokensContext` etc. are already the right decomposition. Consumers who need more granular subscriptions should call those directly. `App.tsx` is the only legitimate heavy consumer (orchestration role) — it can keep using `useWallet()`.

**Tech Stack:** TypeScript, React 19, React Context, Vitest

---

## Pre-flight

```bash
cd /Users/kitclawd/simply-sats
git checkout main
git checkout -b refactor/a2-walletcontext-split
npm run typecheck   # 0 errors
npm run test:run    # all pass
```

---

### Task 1: Expose `useWalletState` and `useWalletActions` in the public API

Currently these hooks exist but aren't exported from `src/contexts/index.ts`.

**Files:**
- Read: `src/contexts/WalletContext.tsx`
- Read: `src/contexts/index.ts`
- Modify: `src/contexts/index.ts`

**Step 1: Read both files to confirm current exports**

```bash
grep -n "export" src/contexts/index.ts
grep -n "useWalletState\|useWalletActions\|useWallet" src/contexts/WalletContext.tsx | head -20
```

**Step 2: Add exports to contexts/index.ts**

Add to the wallet section of `src/contexts/index.ts`:
```typescript
export { useWalletState, useWalletActions } from './WalletContext'
```

**Step 3: Add JSDoc deprecation notice to `useWallet()`**

In `src/contexts/WalletContext.tsx`, add a deprecation comment above the `useWallet` function:

```typescript
/**
 * @deprecated Use useWalletState() for read-only state or useWalletActions() for
 * write operations. useWallet() merges both contexts, causing unnecessary re-renders
 * in components that only need state or only need actions.
 *
 * Exception: App.tsx (orchestration) may continue using useWallet().
 */
export function useWallet() { ... }
```

**Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/contexts/index.ts src/contexts/WalletContext.tsx
git commit -m "refactor(context): export useWalletState/useWalletActions, deprecate useWallet

Sets up the migration path. useWallet() still works for App.tsx
and backward compatibility but is now marked @deprecated.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Migrate light consumers (1-4 properties) — 9 files

These files use so few properties that switching to a targeted hook is trivial.

**Files to migrate:**
- `src/components/modals/OrdinalTransferModal.tsx` — `handleTransferOrdinal, feeRateKB` → `useWalletActions()` + `useWalletState()`
- `src/components/modals/OrdinalListModal.tsx` — `handleListOrdinal, feeRateKB` → `useWalletActions()` + `useWalletState()`
- `src/components/modals/ConsolidateModal.tsx` — `wallet, fetchData` → `useWalletState()` + `useWalletActions()`
- `src/components/modals/settings/SettingsTransactions.tsx` — `feeRateKB, setFeeRate` → `useWalletState()` + `useWalletActions()`
- `src/components/modals/settings/SettingsAdvanced.tsx` — `wallet, performSync, fetchData` → split appropriately
- `src/components/modals/settings/SettingsBackup.tsx` — `wallet, sessionPassword, performSync` → split
- `src/components/modals/BackupRecoveryModal.tsx` — `wallet, refreshAccounts` → split
- `src/components/tabs/UTXOsTab.tsx` — `utxos` → consider `useSync()` directly
- `src/components/modals/ReceiveModal.tsx` — `wallet, contacts, refreshContacts, activeAccountId` → split

**For each file:**

**Step 1: Read the file to see current destructuring**

**Step 2: Replace `useWallet()` import and call**

Pattern:
```typescript
// BEFORE
import { useWallet } from '../../contexts'
const { feeRateKB, setFeeRate } = useWallet()

// AFTER
import { useWalletState, useWalletActions } from '../../contexts'
const { feeRateKB } = useWalletState()
const { setFeeRate } = useWalletActions()
```

If a component only uses state properties → only call `useWalletState()`.
If a component only uses action properties → only call `useWalletActions()`.
If it uses both → call both hooks.

**Step 3: After each batch of 3 files, typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 4: Commit the batch**

```bash
git add src/components/
git commit -m "refactor(components): migrate light useWallet() consumers to split hooks

Migrated 9 components with 1-4 properties to use useWalletState()
and/or useWalletActions() instead of the merged useWallet() hook.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Migrate medium consumers (5-9 properties) — 4 files

**Files to migrate:**
- `src/components/modals/SendModal.tsx` — `wallet, balance, utxos, feeRateKB, handleSend`
- `src/components/modals/LockModal.tsx` — `wallet, balance, utxos, networkInfo, handleLock`
- `src/components/modals/settings/SettingsSecurity.tsx` — `wallet, sessionPassword, autoLockMinutes, setAutoLockMinutes, lockWallet`
- `src/components/wallet/Header.tsx` — `wallet, networkInfo, syncing, performSync, fetchData, accounts, activeAccountId, switchAccount, balance`

**Step 1: For each file, read and classify each property**

Properties from `WalletStateContext` → `useWalletState()`
Properties from `WalletActionsContext` → `useWalletActions()`

**Step 2: Apply the same split pattern as Task 2**

For `Header.tsx` (9 properties — the most complex of this group):
```typescript
// BEFORE
const { wallet, networkInfo, syncing, performSync, fetchData,
        accounts, activeAccountId, switchAccount, balance } = useWallet()

// AFTER
const { wallet, networkInfo, syncing, accounts, activeAccountId, balance } = useWalletState()
const { performSync, fetchData, switchAccount } = useWalletActions()
```

**Step 3: Typecheck after each file**

```bash
npx tsc --noEmit
```

**Step 4: Run tests**

```bash
npm run test:run
```

**Step 5: Commit**

```bash
git add src/components/
git commit -m "refactor(components): migrate medium useWallet() consumers to split hooks

Migrated 4 components (SendModal, LockModal, SettingsSecurity, Header)
to use useWalletState() and useWalletActions() separately.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Keep `App.tsx` on `useWallet()` — verify and document

`App.tsx` uses 25 properties (orchestration role). It legitimately needs most of the context. Leave it using `useWallet()` with a comment explaining why.

**Files:**
- Modify: `src/App.tsx` (comment only, no structural change)

**Step 1: Add a comment to the useWallet() call in App.tsx**

```typescript
// App.tsx is the top-level orchestrator. It legitimately needs both wallet state
// and actions for lifecycle management, routing, and modal control. useWallet()
// is acceptable here; other components should use useWalletState/useWalletActions.
const { wallet, loading, /* ...rest of destructuring... */ } = useWallet()
```

**Step 2: Typecheck + lint + tests**

```bash
npm run typecheck && npm run lint && npm run test:run
```

Expected: 0 errors, all pass.

**Step 3: Final commit**

```bash
git add src/App.tsx
git commit -m "docs(App): document intentional useWallet() usage for orchestration role

App.tsx is the legitimate exception to the useWalletState/useWalletActions
split pattern — it acts as the lifecycle orchestrator and needs both.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Verify no unintended `useWallet()` consumers remain

**Step 1: Check all remaining useWallet() consumers**

```bash
grep -rn "useWallet()" src/ --include="*.tsx" --include="*.ts" | grep -v "App.tsx" | grep -v "WalletContext.tsx"
```

Expected: 0 matches (all migrated or left intentionally).

**Step 2: Verify `useWallet` is still exported (backward compat for SDK/tests)**

```bash
grep "useWallet" src/contexts/index.ts
```

Expected: All three are exported — `useWallet`, `useWalletState`, `useWalletActions`.

**Step 3: Final full verification**

```bash
npm run typecheck
npm run lint
npm run test:run
```

Expected: 0 TypeScript errors, lint clean, all tests pass.

**Step 4: Push and open PR**

```bash
git push -u origin refactor/a2-walletcontext-split
```

Open PR: `refactor/a2-walletcontext-split` → `main`

---

## Notes

- **Do not** create new micro-contexts (`TransactionContext`, `OrdinalContext`, etc.). The current provider hierarchy already has `SyncContext`, `LocksContext`, etc. Components that need very granular subscriptions can use those existing context hooks directly in a follow-up refactor.
- **Do not** change `WalletProvider` internals — only change what consumers call.
- The goal is: 15 of 16 consumers use focused hooks. Only `App.tsx` uses the merged `useWallet()`.
