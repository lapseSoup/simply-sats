# A-9: Move Database Repos to Infrastructure Layer

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all database repository files from `src/services/database/` to `src/infrastructure/database/` to enforce the layered architecture (Components → Hooks → Contexts → Services → Domain / Infrastructure).

**Architecture:** Database repositories are infrastructure concerns (raw data access), not service concerns (business logic). Currently `src/infrastructure/database/index.ts` is nearly empty and just re-exports from `src/services/database/`. After this refactor, `src/services/database/` is deleted and all files live in `src/infrastructure/database/`. All 23 import sites get updated paths. No logic changes — purely mechanical file moves + path updates.

**Tech Stack:** TypeScript, Vitest, git mv for safe renames

---

## Pre-flight

```bash
cd /Users/kitclawd/simply-sats
git checkout -b refactor/a9-database-infrastructure-layer
npm run typecheck  # confirm 0 errors before starting
npm run test:run   # confirm all tests pass before starting
```

Expected: 0 TypeScript errors, all tests pass.

---

### Task 1: Move implementation files

**Files:**
- Move: `src/services/database/connection.ts` → `src/infrastructure/database/connection.ts`
- Move: `src/services/database/types.ts` → `src/infrastructure/database/types.ts`
- Move: `src/services/database/utxoRepository.ts` → `src/infrastructure/database/utxoRepository.ts`
- Move: `src/services/database/txRepository.ts` → `src/infrastructure/database/txRepository.ts`
- Move: `src/services/database/lockRepository.ts` → `src/infrastructure/database/lockRepository.ts`
- Move: `src/services/database/syncRepository.ts` → `src/infrastructure/database/syncRepository.ts`
- Move: `src/services/database/basketRepository.ts` → `src/infrastructure/database/basketRepository.ts`
- Move: `src/services/database/addressRepository.ts` → `src/infrastructure/database/addressRepository.ts`
- Move: `src/services/database/contactRepository.ts` → `src/infrastructure/database/contactRepository.ts`
- Move: `src/services/database/actionRepository.ts` → `src/infrastructure/database/actionRepository.ts`
- Move: `src/services/database/ordinalRepository.ts` → `src/infrastructure/database/ordinalRepository.ts`
- Move: `src/services/database/backup.ts` → `src/infrastructure/database/backup.ts`

**Step 1: Use git mv for all implementation files**

```bash
cd /Users/kitclawd/simply-sats
git mv src/services/database/connection.ts src/infrastructure/database/connection.ts
git mv src/services/database/types.ts src/infrastructure/database/types.ts
git mv src/services/database/utxoRepository.ts src/infrastructure/database/utxoRepository.ts
git mv src/services/database/txRepository.ts src/infrastructure/database/txRepository.ts
git mv src/services/database/lockRepository.ts src/infrastructure/database/lockRepository.ts
git mv src/services/database/syncRepository.ts src/infrastructure/database/syncRepository.ts
git mv src/services/database/basketRepository.ts src/infrastructure/database/basketRepository.ts
git mv src/services/database/addressRepository.ts src/infrastructure/database/addressRepository.ts
git mv src/services/database/contactRepository.ts src/infrastructure/database/contactRepository.ts
git mv src/services/database/actionRepository.ts src/infrastructure/database/actionRepository.ts
git mv src/services/database/ordinalRepository.ts src/infrastructure/database/ordinalRepository.ts
git mv src/services/database/backup.ts src/infrastructure/database/backup.ts
```

**Step 2: Move test files**

```bash
git mv src/services/database/utxoRepository.test.ts src/infrastructure/database/utxoRepository.test.ts
git mv src/services/database/txRepository.test.ts src/infrastructure/database/txRepository.test.ts
git mv src/services/database/lockRepository.test.ts src/infrastructure/database/lockRepository.test.ts
```

**Step 3: Verify files moved correctly**

```bash
ls src/infrastructure/database/
ls src/services/database/
```

Expected: `src/infrastructure/database/` has 15 files (12 impl + 3 tests + existing index.ts). `src/services/database/` has only `index.ts` remaining.

---

### Task 2: Fix internal imports within moved files

The moved files may import each other using relative paths like `./connection` or `./types`. These still work since they're all in the same directory. But check for any cross-directory imports.

**Step 1: Check for any imports that now point to wrong location**

```bash
grep -rn "from.*services/database" src/infrastructure/database/
```

Expected: No matches (the moved files shouldn't import from `services/database`; they import from `./connection`, `./types` etc. which still work).

**Step 2: If any matches found**, update each import in the flagged file from `../services/database/X` to `./X`.

**Step 3: Verify typecheck passes on just the infrastructure folder**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: Errors will exist (importers not updated yet) but none should be *within* `src/infrastructure/database/`.

---

### Task 3: Replace `src/infrastructure/database/index.ts`

Currently this file re-exports from `src/services/database/`. Replace it with a direct barrel export of everything in the new location.

**Files:**
- Modify: `src/infrastructure/database/index.ts`

**Step 1: Read the current index.ts**

```bash
cat src/infrastructure/database/index.ts
```

**Step 2: Replace with barrel export of local files**

Write `src/infrastructure/database/index.ts`:

```typescript
// Infrastructure: database repositories and connection
// This is the canonical location for all DB access code.
export * from './connection'
export * from './types'
export * from './utxoRepository'
export * from './txRepository'
export * from './lockRepository'
export * from './syncRepository'
export * from './basketRepository'
export * from './addressRepository'
export * from './contactRepository'
export * from './actionRepository'
export * from './ordinalRepository'
export * from './backup'
```

---

### Task 4: Replace `src/services/database/index.ts` with re-export shim

Keep `src/services/database/index.ts` temporarily as a re-export shim pointing to the new location. This lets us update importers gradually and also serves as a migration breadcrumb.

**Files:**
- Modify: `src/services/database/index.ts`

**Step 1: Write the shim**

Write `src/services/database/index.ts`:

```typescript
// DEPRECATED: Database repositories have moved to src/infrastructure/database/
// This shim is kept temporarily while importers are updated.
// TODO: Remove this file after all importers have been migrated (A-9).
export * from '../infrastructure/database'
```

**Step 2: Verify typecheck — shim should resolve all importer errors temporarily**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: 0 errors (shim keeps old import paths working).

**Step 3: Run tests to confirm nothing is broken yet**

```bash
npm run test:run
```

Expected: All tests pass.

**Step 4: Commit the file moves + shim**

```bash
git add -A
git commit -m "refactor: move database repos to infrastructure layer (shim in place)

- Moved 12 implementation files + 3 test files from services/database/
  to infrastructure/database/ per layered architecture (A-9)
- Replaced infrastructure/database/index.ts with direct barrel export
- Left services/database/index.ts as temporary re-export shim
- Zero logic changes, all tests pass

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Update all 23 import sites

Now update every file that imports from `services/database` to import from `infrastructure/database` instead.

**Files to update** (in order — contexts/hooks first, then components, then services):

**Group 1: Services (4 files)**
- `src/services/brc100/actions.ts`
- `src/services/brc100/listener.ts`
- `src/services/brc100/locks.ts`
- `src/services/brc100/outputs.ts`

**Group 2: Hooks (6 files)**
- `src/hooks/useWalletInit.ts`
- `src/hooks/useWalletActions.ts`
- `src/hooks/useWalletSend.ts`
- `src/hooks/useUtxoManagement.ts`
- `src/hooks/useTransactionLabels.ts`
- `src/hooks/useAccountSwitching.ts`

**Group 3: Contexts (3 files)**
- `src/contexts/SyncContext.tsx`
- `src/contexts/WalletActionsContext.tsx`
- `src/contexts/WalletStateContext.tsx`

**Group 4: Components (9 files)**
- `src/App.tsx`
- `src/components/modals/SendModal.tsx`
- `src/components/modals/ReceiveModal.tsx`
- `src/components/modals/CoinControlModal.tsx`
- `src/components/modals/settings/SettingsBackup.tsx`
- `src/components/modals/RestoreModal.tsx`
- `src/components/modals/TransactionDetailModal.tsx`
- `src/components/tabs/SearchTab.tsx`
- `src/components/tabs/UTXOsTab.tsx`
- `src/components/wallet/Header.tsx`

**Step 1: Automated sed replacement**

The import paths differ by depth. The pattern to replace varies:
- `from '../services/database'` → `from '../infrastructure/database'`
- `from '../../services/database'` → `from '../../infrastructure/database'`
- `from '../../../services/database'` → `from '../../../infrastructure/database'`

```bash
# Run from project root
# Depth 1: hooks/, services/brc100/ (one level deep from src/)
find src/hooks src/services/brc100 -name "*.ts" -o -name "*.tsx" | \
  xargs grep -l "from.*services/database" | \
  xargs sed -i '' "s|from '../services/database'|from '../infrastructure/database'|g"

# Depth 1 for contexts (same depth)
find src/contexts -name "*.ts" -o -name "*.tsx" | \
  xargs grep -l "from.*services/database" | \
  xargs sed -i '' "s|from '../../services/database'|from '../../infrastructure/database'|g"

# Depth 2: components/ subdirectories
find src/components src -maxdepth 1 -name "*.tsx" | \
  xargs grep -l "from.*services/database" | \
  xargs sed -i '' "s|from '../../services/database'|from '../../infrastructure/database'|g; \
                   s|from '../../../services/database'|from '../../../infrastructure/database'|g"
```

**Step 2: Verify no remaining imports from services/database (except the shim itself)**

```bash
grep -rn "from.*services/database" src/ --include="*.ts" --include="*.tsx" | \
  grep -v "src/services/database/index.ts"
```

Expected: 0 matches.

**Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 4: Run tests**

```bash
npm run test:run
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: update all 23 import sites to use infrastructure/database

All consumers now import from src/infrastructure/database/ directly.
The services/database shim is no longer needed by any importer.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Delete the shim and services/database directory

**Step 1: Delete the shim and the now-empty services/database directory**

```bash
rm src/services/database/index.ts
rmdir src/services/database
```

**Step 2: Typecheck and test**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: 0 errors, all tests pass.

**Step 3: Run lint**

```bash
npm run lint
```

Expected: No new errors. The `no-restricted-imports` ESLint rule may now flag `infrastructure/database` imports from components — check `eslint.config.js` and update the restricted patterns list if needed (components should use context hooks, not infra directly).

**Step 4: Update ESLint restricted imports if needed**

If `eslint.config.js` restricted `**/services/database*`, also add `**/infrastructure/database*` to the list so components can't bypass contexts to hit DB directly.

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: remove services/database shim and empty directory

Database repositories now live exclusively in infrastructure/database/.
Updated ESLint no-restricted-imports to cover new path.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

```bash
npm run typecheck
npm run lint
npm run test:run
```

Expected: 0 TypeScript errors, lint clean, all tests pass.

Then open a PR: `refactor/a9-database-infrastructure-layer` → `main`.
