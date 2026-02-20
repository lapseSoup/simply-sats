# Silent Background Sync After Send/Lock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove "balance may take a moment to update" warning toasts after sends/locks by automatically triggering a background `performSync()` that silently reconciles balance from the blockchain.

**Architecture:** After any successful broadcast (whether or not the local DB write succeeded), show only a clean success toast, close the modal, then fire `void performSync()` — a non-blocking background sync that refreshes balance from the blockchain. The existing `fetchData()` call (which reads from local DB) still runs first for instant feedback. If the local DB write failed, `performSync()` is the recovery mechanism. On the normal path, it's a confirmation.

**Tech Stack:** React 19, TypeScript 5.9, `useWalletActions()` context hook (provides both `performSync` and `fetchData`), Vite/Tauri

---

## Background

`performSync()` is wrapped in `WalletContext` as a 3-param closure `(isRestore?, forceReset?, silent?) => Promise<void>`. It:
1. Fetches UTXOs from the blockchain (network call, ~2–5 seconds)
2. Marks spent UTXOs in the local DB
3. Records change UTXOs
4. Updates displayed balance

`fetchData()` is the fast local-read counterpart — no network calls, reads DB immediately.

`void performSync()` — intentionally unawaited. TypeScript's `@typescript-eslint/no-floating-promises` rule requires the explicit `void` operator. The `WalletContext` wrapper already guards against stale account updates.

---

## Task 1: Fix SendModal — Single Recipient

**Files:**
- Modify: `src/components/modals/SendModal.tsx:19-22` (destructure), `120-148` (executeSend)

**Step 1: Add `performSync` to the `useWalletActions()` destructure**

In `SendModal.tsx` at line 21, change:
```typescript
const { handleSend, handleSendMulti } = useWalletActions()
```
to:
```typescript
const { handleSend, handleSendMulti, performSync } = useWalletActions()
```

**Step 2: Update `executeSend` — replace warning toast with background sync**

Current code at lines 130–143:
```typescript
if (isOk(result)) {
  showToast(`Sent ${sendSats.toLocaleString()} sats!`)
  onClose()
} else {
  const errorMsg = result.error || 'Send failed'
  // Broadcast succeeded but local DB write failed — tx is on-chain, close and warn via toast.
  // Detect via BROADCAST_SUCCEEDED_DB_FAILED error code or legacy "broadcast succeeded" substring.
  if (errorMsg.includes('broadcast succeeded') || errorMsg.includes('BROADCAST_SUCCEEDED_DB_FAILED')) {
    showToast('Sent! Balance may take a moment to update.', 'warning')
    onClose()
  } else {
    setSendError(errorMsg)
  }
}
```

Replace with:
```typescript
if (isOk(result)) {
  showToast(`Sent ${sendSats.toLocaleString()} sats!`)
  onClose()
  void performSync()
} else {
  const errorMsg = result.error || 'Send failed'
  if (errorMsg.includes('broadcast succeeded') || errorMsg.includes('BROADCAST_SUCCEEDED_DB_FAILED')) {
    // TX is on-chain. Show clean success toast and silently sync to reconcile balance.
    showToast(`Sent ${sendSats.toLocaleString()} sats!`)
    onClose()
    void performSync()
  } else {
    setSendError(errorMsg)
  }
}
```

**Step 3: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: No new errors. `performSync` is already typed on `WalletActionsContextType`. `void` satisfies the no-floating-promises rule.

**Step 4: Commit**

```bash
cd /Users/kitclawd/simply-sats && git add src/components/modals/SendModal.tsx && git commit -m "fix: silent background sync after single send, remove warning toast"
```

---

## Task 2: Fix SendModal — Multi-Recipient

**Files:**
- Modify: `src/components/modals/SendModal.tsx:150-178` (executeSendMulti)

**Step 1: Hoist `totalSat` and update `executeSendMulti`**

Current code at lines 150–178:
```typescript
const executeSendMulti = async () => {
  setSending(true)
  setSendError('')

  const parsedRecipients: RecipientOutput[] = recipients.map(r => ({
    address: r.address,
    satoshis: displayInSats
      ? Math.round(parseFloat(r.amount || '0'))
      : btcToSatoshis(parseFloat(r.amount || '0'))
  }))

  const result = await handleSendMulti(parsedRecipients, selectedUtxos ?? undefined)

  if (isOk(result)) {
    const totalSat = parsedRecipients.reduce((sum, r) => sum + r.satoshis, 0)
    showToast(`Sent ${totalSat.toLocaleString()} sats to ${parsedRecipients.length} recipients!`)
    onClose()
  } else {
    const errorMsg = result.error || 'Send failed'
    if (errorMsg.includes('broadcast succeeded') || errorMsg.includes('BROADCAST_SUCCEEDED_DB_FAILED')) {
      showToast('Sent! Balance may take a moment to update.', 'warning')
      onClose()
    } else {
      setSendError(errorMsg)
    }
  }

  setSending(false)
}
```

Replace with:
```typescript
const executeSendMulti = async () => {
  setSending(true)
  setSendError('')

  const parsedRecipients: RecipientOutput[] = recipients.map(r => ({
    address: r.address,
    satoshis: displayInSats
      ? Math.round(parseFloat(r.amount || '0'))
      : btcToSatoshis(parseFloat(r.amount || '0'))
  }))

  const totalSat = parsedRecipients.reduce((sum, r) => sum + r.satoshis, 0)
  const result = await handleSendMulti(parsedRecipients, selectedUtxos ?? undefined)

  if (isOk(result)) {
    showToast(`Sent ${totalSat.toLocaleString()} sats to ${parsedRecipients.length} recipients!`)
    onClose()
    void performSync()
  } else {
    const errorMsg = result.error || 'Send failed'
    if (errorMsg.includes('broadcast succeeded') || errorMsg.includes('BROADCAST_SUCCEEDED_DB_FAILED')) {
      // TX is on-chain. Show clean success toast and silently sync to reconcile balance.
      showToast(`Sent ${totalSat.toLocaleString()} sats to ${parsedRecipients.length} recipients!`)
      onClose()
      void performSync()
    } else {
      setSendError(errorMsg)
    }
  }

  setSending(false)
}
```

**Step 2: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: No errors.

**Step 3: Commit**

```bash
cd /Users/kitclawd/simply-sats && git add src/components/modals/SendModal.tsx && git commit -m "fix: silent background sync after multi-recipient send, remove warning toast"
```

---

## Task 3: Fix LockModal — Add Background Sync on Clean Success

**Files:**
- Modify: `src/components/modals/LockModal.tsx:108-132` (executeLock)

**Step 1: Restructure `executeLock` to fire background sync on clean path only**

Current code at lines 116–129:
```typescript
if (isOk(result)) {
  if (result.value.warning) {
    showToast(result.value.warning, 'warning')
    // Sync automatically to pick up the lock record from blockchain
    await performSync()
  } else {
    showToast(`Locked ${lockSats.toLocaleString()} sats for ${blocks} blocks!`)
  }
  // Ensure Activity tab reflects the new lock transaction immediately
  await fetchData()
  onClose()
} else {
  setLockError(result.error || 'Lock failed')
}
```

Replace with:
```typescript
if (isOk(result)) {
  if (result.value.warning) {
    showToast(result.value.warning, 'warning')
    // Sync automatically to pick up the lock record from blockchain
    await performSync()
    await fetchData()
    onClose()
  } else {
    showToast(`Locked ${lockSats.toLocaleString()} sats for ${blocks} blocks!`)
    await fetchData()
    onClose()
    // Background sync to confirm balance from blockchain after local DB update
    void performSync()
  }
} else {
  setLockError(result.error || 'Lock failed')
}
```

Note: The warning path keeps `await performSync()` (blocking, already was there) and does NOT add the background `void performSync()` to avoid a double sync. The clean path gets the new `void performSync()` after `onClose()`.

**Step 2: Run typecheck**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck
```
Expected: No errors. `performSync` is already destructured in `LockModal` (line 25).

**Step 3: Commit**

```bash
cd /Users/kitclawd/simply-sats && git add src/components/modals/LockModal.tsx && git commit -m "fix: silent background sync after lock success"
```

---

## Task 4: Fix ConsolidateModal

**Files:**
- Modify: `src/components/modals/ConsolidateModal.tsx:18` (destructure), `74-80` (success handler)

**Step 1: Add `performSync` to the `useWalletActions()` destructure**

At line 18, change:
```typescript
const { fetchData } = useWalletActions()
```
to:
```typescript
const { fetchData, performSync } = useWalletActions()
```

**Step 2: Fire background sync after `fetchData()` in `handleConsolidate`**

Current code at lines 74–80:
```typescript
setTxid(result.value.txid)
setStatus('success')

// Refresh wallet data
await fetchData()

uiLogger.info('Consolidation successful', { txid: result.value.txid })
```

Replace with:
```typescript
setTxid(result.value.txid)
setStatus('success')

// Refresh wallet data from local DB instantly
await fetchData()
// Background sync to confirm balance from blockchain
void performSync()

uiLogger.info('Consolidation successful', { txid: result.value.txid })
```

**Step 3: Run typecheck and lint**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck && npm run lint
```
Expected: No errors. `void performSync()` satisfies `@typescript-eslint/no-floating-promises`.

**Step 4: Commit**

```bash
cd /Users/kitclawd/simply-sats && git add src/components/modals/ConsolidateModal.tsx && git commit -m "fix: silent background sync after UTXO consolidation"
```

---

## Task 5: Final Verification

**Step 1: Full typecheck and lint pass**

```bash
cd /Users/kitclawd/simply-sats && npm run typecheck && npm run lint
```
Expected: Zero errors, zero warnings on the changed files.

**Step 2: Run tests**

```bash
cd /Users/kitclawd/simply-sats && npm run test:run
```
Expected: All 657 tests pass (these are unit tests; the changed code is modal-level UI logic with no unit tests currently, but existing tests should not regress).

**Step 3: Manual smoke test checklist**

In `npm run tauri:dev` or `npm run dev`:
- [ ] Send a small amount → "Sent X sats!" green toast fires → modal closes immediately → balance updates from blockchain within ~5 seconds (no manual sync needed)
- [ ] Send to multiple recipients → same behavior
- [ ] Lock BSV (clean path) → "Locked X sats for Y blocks!" green toast → modal closes → balance updates
- [ ] Consolidate UTXOs → success screen shows → balance updates while success screen is visible
- [ ] Verify NO "Balance may take a moment to update" warning toast appears in any of the above flows
