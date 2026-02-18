# A-8: BRC-100 Key Parameter Injection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the module-level `getWalletKeys()` calls in BRC-100 certificate and listener code by injecting `WalletKeys` as explicit parameters, making key access traceable and testable.

**Architecture:** `src/services/brc100/state.ts` holds module-level key state for BRC-100. The `approveRequest()` / `executeApprovedRequest()` / `handleBRC100Request()` path already receives keys as parameters — that pattern is correct. The problem is `certificates.ts` (3 functions) and `listener.ts` (6 call sites) that call `getWalletKeys()` internally. After this refactor: all BRC-100 functions that need keys receive them as parameters. Module state (`getWalletKeys`) is only called at the boundary layer (`listener.ts` and `useBRC100.ts`) and immediately passed in. Certificate functions return `Result`-style errors when keys are absent rather than throwing.

**Tech Stack:** TypeScript, Vitest (TDD), BRC-100 Axum HTTP server in Rust (`src-tauri/src/http_server.rs` — read-only reference, no changes needed)

---

## Pre-flight

```bash
cd /Users/kitclawd/simply-sats
git checkout main
git checkout -b refactor/a8-brc100-key-injection
npm run typecheck  # 0 errors
npm run test:run   # all pass
```

---

### Task 1: Understand certificate function signatures

**Step 1: Read the current certificate file**

```bash
cat src/services/brc100/certificates.ts
```

Note: the 3 functions are `acquireCertificate`, `listCertificates`, `proveCertificate`. Each calls `getWalletKeys()` internally.

**Step 2: Read how certificates.ts is called**

```bash
grep -rn "acquireCertificate\|listCertificates\|proveCertificate" src/ --include="*.ts"
```

Note all call sites and what parameters they currently pass.

---

### Task 2: Refactor `certificates.ts` — inject keys as parameter

**Files:**
- Modify: `src/services/brc100/certificates.ts`

**Step 1: Write failing tests first**

In `src/services/brc100/certificates.test.ts` (create if it doesn't exist), add tests that verify:
1. Functions work correctly when keys are passed in
2. Functions return an error when `null` is passed (not throw)

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { acquireCertificate, listCertificates, proveCertificate } from './certificates'

describe('certificates with injected keys', () => {
  it('listCertificates returns empty array when keys are null', async () => {
    const result = await listCertificates(null, 'test-app', ['field1'])
    expect(result).toEqual([])
  })

  it('acquireCertificate returns error result when keys are null', async () => {
    const result = await acquireCertificate(null, 'test-app', ['field1'], { field1: 'value' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('locked')
  })
})
```

**Step 2: Run to confirm tests fail**

```bash
npx vitest run src/services/brc100/certificates.test.ts 2>&1 | tail -20
```

Expected: FAIL — functions don't accept `null` as first parameter yet.

**Step 3: Update `certificates.ts` signatures**

Change each function to accept `keys: WalletKeys | null` as the first parameter instead of calling `getWalletKeys()` internally.

Pattern for `listCertificates`:
```typescript
// BEFORE
export async function listCertificates(appDomain: string, fields: string[]): Promise<Certificate[]> {
  const keys = getWalletKeys()
  if (!keys) return []
  // ...
}

// AFTER
export async function listCertificates(
  keys: WalletKeys | null,
  appDomain: string,
  fields: string[]
): Promise<Certificate[]> {
  if (!keys) return []
  // ...
}
```

Pattern for `acquireCertificate` and `proveCertificate` — same change: add `keys: WalletKeys | null` as first param, remove internal `getWalletKeys()` call, return error Result or throw as appropriate (match existing behavior but now with explicit keys).

Remove the `import { getWalletKeys } from './state'` line from `certificates.ts` if it's no longer needed.

**Step 4: Run the new tests**

```bash
npx vitest run src/services/brc100/certificates.test.ts
```

Expected: PASS.

**Step 5: Fix all call sites of the certificate functions**

```bash
grep -rn "acquireCertificate\|listCertificates\|proveCertificate" src/ --include="*.ts"
```

For each call site in `actions.ts` or `listener.ts`, update to pass `getWalletKeys()` (or the injected `keys` parameter) as the first argument.

**Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 7: Run all tests**

```bash
npm run test:run
```

Expected: All pass.

**Step 8: Commit**

```bash
git add src/services/brc100/certificates.ts src/services/brc100/certificates.test.ts
git add $(git diff --name-only) # any call sites updated
git commit -m "refactor(brc100): inject WalletKeys into certificate functions (A-8)

Eliminates implicit getWalletKeys() calls in certificates.ts.
Functions now receive keys as first parameter, making dependencies
explicit and improving testability.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Refactor `listener.ts` — push `getWalletKeys()` to boundary

**Files:**
- Modify: `src/services/brc100/listener.ts`

`setupHttpServerListener()` calls `getWalletKeys()` in 6 places inline. The goal is to call it once at the top of each request handler and pass it down.

**Step 1: Read listener.ts**

```bash
cat src/services/brc100/listener.ts
```

Note the structure — identify each place `getWalletKeys()` is called. They should all be inside the request handler callback body.

**Step 2: Consolidate to a single boundary call per handler**

Pattern:

```typescript
// BEFORE: scattered calls inside handler
app.post('/brc100/sign', async (req, res) => {
  const keys1 = getWalletKeys()
  // ... some logic ...
  const keys2 = getWalletKeys()  // redundant second call
  if (!keys2) return res.status(401).json(...)
  // pass to downstream function
})

// AFTER: single call at top of handler
app.post('/brc100/sign', async (req, res) => {
  const keys = getWalletKeys()  // single boundary call
  if (!keys) return res.status(401).json({ error: 'Wallet locked' })
  // pass keys as parameter to all downstream functions
  await handleBRC100Request(request, keys, autoApprove)
})
```

**Step 3: Verify `getWalletKeys()` is only called once per handler**

```bash
grep -c "getWalletKeys" src/services/brc100/listener.ts
```

Expected: Count should equal the number of distinct request handlers (each handler calls it exactly once at the top, not multiple times per handler).

**Step 4: Typecheck and test**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: 0 errors, all tests pass.

**Step 5: Commit**

```bash
git add src/services/brc100/listener.ts
git commit -m "refactor(brc100): consolidate getWalletKeys() to handler boundaries in listener.ts

Each HTTP handler now fetches keys once at entry and passes them
as parameters, eliminating redundant module-state reads mid-handler.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Verify module state is now only used at boundaries

**Step 1: Audit all remaining `getWalletKeys()` calls**

```bash
grep -rn "getWalletKeys()" src/services/brc100/ --include="*.ts"
```

Expected: Only `listener.ts` (boundary) and any `useBRC100.ts` hook. No calls inside `certificates.ts`, `signing.ts`, `locks.ts`, or deep inside `actions.ts`.

**Step 2: Audit `setWalletKeys()` call sites (unchanged)**

```bash
grep -rn "setWalletKeys" src/ --include="*.ts" --include="*.tsx"
```

Verify the call sites from the previous session's S-15 fix are still intact:
- `WalletContext.tsx` — sets on wallet load
- `useWalletLock.ts` — sets to null on lock, sets keys on unlock
- `RestoreModal.tsx` — sets after restore
- `useAccountSwitching.ts` — sets after account switch

**Step 3: Full final verification**

```bash
npm run typecheck
npm run lint
npm run test:run
```

Expected: 0 TypeScript errors, no new lint errors, all tests pass.

**Step 4: Final commit if any cleanup needed, then PR**

```bash
git push -u origin refactor/a8-brc100-key-injection
```

Open PR: `refactor/a8-brc100-key-injection` → `main`
