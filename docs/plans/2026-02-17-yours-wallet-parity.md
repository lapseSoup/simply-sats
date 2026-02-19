# Yours Wallet Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring Simply Sats to full feature parity with Yours Wallet across 13 identified gaps, ordered by priority and implementation complexity.

**Architecture:** Each feature is self-contained. Priority 1 items (testnet UI, multi-recipient, send max) are UI/service layer changes. Priority 2 items (ordinal inscription, marketplace buy, message signing) add new service+modal pairs. Priority 3 items (24-word seed, WIF export) extend onboarding flows. SPV is the largest architectural change and is scoped as a separate deep-dive task.

**Tech Stack:** TypeScript 5.9, React 19, `@bsv/sdk` v1.10.3, `js-1sat-ord` v0.1.91, Vitest 4, Tauri 2, SQLite, Tailwind CSS 4

---

## Quick Reference

| Task | Feature | Priority | Complexity |
|------|---------|----------|-----------|
| 1 | Send Max button | P1 | Trivial — UI only (already has MAX button!) |
| 2 | Testnet / network switching UI | P1 | Small — infrastructure exists, needs Settings UI |
| 3 | Multi-recipient transactions | P1 | Medium — domain + UI changes |
| 4 | Ordinal inscription creation | P1 | Medium — new service + modal |
| 5 | Ordinals marketplace purchase | P2 | Medium — extends existing marketplace.ts |
| 6 | Standalone message signing UI | P2 | Small — new modal only |
| 7 | MNEE stablecoin support | P2 | Small — token recognition only |
| 8 | SDK method parity audit | P2 | Research + small additions |
| 9 | 24-word seed phrase support | P3 | Small — onboarding extension |
| 10 | WIF key export/import | P3 | Small — settings + onboarding |
| 11 | Per-dApp tagged derivation SDK | P3 | Small — SDK method addition |
| 12 | SPV verification | P1 | Large — architectural (separate deep-dive) |

---

## Pre-flight Checks

Before starting any task:
```bash
cd /Users/kitclawd/simply-sats
npm run typecheck   # must pass: 0 errors
npm run lint        # must pass: 0 errors
npm run test:run    # must pass: all tests green
```

---

## Task 1: Send Max Button (ALREADY DONE — verify only)

**Files:**
- Read: `src/components/modals/SendModal.tsx`

**Note:** The `SendModal.tsx` already has a MAX button at lines ~115-120:
```tsx
<button
  className="input-action"
  onClick={() => setSendAmount(displayInSats ? String(maxSendSats) : satoshisToBtc(maxSendSats).toFixed(8))}
  type="button"
>
  MAX
</button>
```

**Step 1: Verify it works**
Run the app and confirm the MAX button appears in the Send modal and correctly populates the amount field.

**Step 2: Check test coverage**
Run: `npm run test:run -- --reporter=verbose src/components/modals/SendModal.test.tsx`

If there is no test for MAX button, add one:
```typescript
it('MAX button fills in max sendable amount', async () => {
  // render SendModal with mock UTXOs
  // click MAX button
  // assert amount field = maxSendSats
})
```

**Result:** Task 1 is already complete. No code changes needed.

---

## Task 2: Testnet / Network Switching UI

**Files:**
- Read: `src/infrastructure/storage/localStorage.ts` (network section)
- Read: `src/services/config.ts` (getCurrentNetwork, setNetwork)
- Modify: `src/components/modals/settings/SettingsNetwork.tsx` (create new)
- Modify: `src/components/modals/SettingsModal.tsx` (add SettingsNetwork)
- Modify: `src/components/modals/settings/index.ts` (barrel export)
- Test: `src/components/modals/settings/SettingsNetwork.test.tsx` (create new)

**Context:** `src/services/config.ts` already has `getCurrentNetwork()` and `setNetwork()`. `src/infrastructure/storage/localStorage.ts` already has `localStorage.network.get/set()`. Only a Settings UI component is missing.

**Step 1: Read the settings barrel export**
```bash
cat src/components/modals/settings/index.ts
```

**Step 2: Write a failing test**

Create `src/components/modals/settings/SettingsNetwork.test.tsx`:
```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsNetwork } from './SettingsNetwork'
import * as config from '../../../services/config'

vi.mock('../../../services/config', () => ({
  getCurrentNetwork: vi.fn().mockReturnValue('mainnet'),
  setNetwork: vi.fn(),
}))
vi.mock('../../../contexts', () => ({
  useWalletState: () => ({ wallet: { address: '1test' } }),
  useWalletActions: () => ({ handleLock: vi.fn() }),
}))
vi.mock('../../../contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}))

describe('SettingsNetwork', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows current network as mainnet by default', () => {
    render(<SettingsNetwork />)
    expect(screen.getByText(/mainnet/i)).toBeTruthy()
  })

  it('calls setNetwork when switching to testnet', () => {
    render(<SettingsNetwork />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'testnet' } })
    expect(config.setNetwork).toHaveBeenCalledWith('testnet')
  })
})
```

**Step 3: Run test to confirm it fails**
```bash
npm run test:run -- src/components/modals/settings/SettingsNetwork.test.tsx
```
Expected: FAIL — `SettingsNetwork` not found.

**Step 4: Create `src/components/modals/settings/SettingsNetwork.tsx`**
```tsx
import { useState } from 'react'
import { getCurrentNetwork, setNetwork } from '../../../services/config'
import { useUI } from '../../../contexts/UIContext'

export function SettingsNetwork() {
  const [network, setNetworkState] = useState<'mainnet' | 'testnet'>(getCurrentNetwork())
  const { showToast } = useUI()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value as 'mainnet' | 'testnet'
    setNetwork(selected)
    setNetworkState(selected)
    showToast(`Switched to ${selected}. Restart the app to apply.`, 'info')
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Network</h3>
      <div className="form-group">
        <label className="form-label" htmlFor="network-select">Active Network</label>
        <select
          id="network-select"
          className="form-input"
          value={network}
          onChange={handleChange}
        >
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
        </select>
        {network === 'testnet' && (
          <p className="form-hint" style={{ color: 'var(--warning)' }}>
            ⚠️ Testnet — coins have no real value. Restart app after switching.
          </p>
        )}
      </div>
    </section>
  )
}
```

**Step 5: Export from settings barrel**

Add to `src/components/modals/settings/index.ts`:
```typescript
export { SettingsNetwork } from './SettingsNetwork'
```

**Step 6: Add to SettingsModal**

In `src/components/modals/SettingsModal.tsx`, import and add `<SettingsNetwork />` after `<SettingsTransactions />`:
```tsx
import {
  SettingsWallet,
  SettingsAppearance,
  SettingsTransactions,
  SettingsNetwork,   // ADD
  SettingsSecurity,
  // ...
} from './settings'

// In JSX:
<SettingsTransactions />
<SettingsNetwork />   {/* ADD */}
<SettingsSecurity onClose={onClose} />
```

**Step 7: Run test to confirm it passes**
```bash
npm run test:run -- src/components/modals/settings/SettingsNetwork.test.tsx
```
Expected: PASS

**Step 8: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```
Expected: 0 errors

**Step 9: Commit**
```bash
git add src/components/modals/settings/SettingsNetwork.tsx \
        src/components/modals/settings/index.ts \
        src/components/modals/SettingsModal.tsx \
        src/components/modals/settings/SettingsNetwork.test.tsx
git commit -m "feat: add testnet/mainnet network switching UI in Settings"
```

---

## Task 3: Multi-Recipient Transactions

**Files:**
- Modify: `src/domain/transaction/builder.ts` (add `buildMultiOutputP2PKHTx`)
- Modify: `src/components/modals/SendModal.tsx` (add multi-recipient UI toggle)
- Modify: `src/adapters/walletAdapter.ts` (add multi-output send path)
- Test: `src/domain/transaction/builder.test.ts` (add multi-output tests)

**Context:** `buildP2PKHTx` takes a single `toAddress`. We add `buildMultiOutputP2PKHTx` that accepts `outputs: {address: string; satoshis: number}[]`. The `SendModal` gets a "Add recipient" button that shows a second address+amount row.

**Step 1: Read existing builder test file**
```bash
cat src/domain/transaction/builder.test.ts
```

**Step 2: Write failing tests in `src/domain/transaction/builder.test.ts`**

Add to the existing test file:
```typescript
describe('buildMultiOutputP2PKHTx', () => {
  it('builds a tx with two recipient outputs and change', async () => {
    const mockUtxo = { txid: 'a'.repeat(64), vout: 0, satoshis: 10000, script: '' }
    // Use JS fallback (not Tauri) by ensuring isTauri() returns false
    const result = await buildMultiOutputP2PKHTx({
      wif: TEST_WIF,                    // use existing test WIF from the file
      outputs: [
        { address: TEST_ADDRESS_1, satoshis: 3000 },
        { address: TEST_ADDRESS_2, satoshis: 3000 },
      ],
      selectedUtxos: [mockUtxo],
      totalInput: 10000,
      feeRate: 0.05,
    })
    expect(result.txid).toHaveLength(64)
    expect(result.numOutputs).toBe(3) // 2 recipients + change
    expect(result.fee).toBeGreaterThan(0)
    const recipientTotal = 3000 + 3000
    expect(result.totalSent).toBe(recipientTotal)
  })

  it('builds a tx with two recipients and no change when exact amount', async () => {
    // totalInput = exactly sum of outputs + fee
    const feeRate = 0.05
    const fee = calculateTxFee(1, 2, feeRate) // 2 outputs, no change
    const totalInput = 3000 + 3000 + fee
    const mockUtxo = { txid: 'b'.repeat(64), vout: 0, satoshis: totalInput, script: '' }
    const result = await buildMultiOutputP2PKHTx({
      wif: TEST_WIF,
      outputs: [
        { address: TEST_ADDRESS_1, satoshis: 3000 },
        { address: TEST_ADDRESS_2, satoshis: 3000 },
      ],
      selectedUtxos: [mockUtxo],
      totalInput,
      feeRate,
    })
    expect(result.change).toBe(0)
    expect(result.numOutputs).toBe(2)
  })

  it('throws if outputs are empty', async () => {
    const mockUtxo = { txid: 'c'.repeat(64), vout: 0, satoshis: 5000, script: '' }
    await expect(buildMultiOutputP2PKHTx({
      wif: TEST_WIF,
      outputs: [],
      selectedUtxos: [mockUtxo],
      totalInput: 5000,
      feeRate: 0.05,
    })).rejects.toThrow('at least one output')
  })

  it('throws if insufficient funds', async () => {
    const mockUtxo = { txid: 'd'.repeat(64), vout: 0, satoshis: 100, script: '' }
    await expect(buildMultiOutputP2PKHTx({
      wif: TEST_WIF,
      outputs: [{ address: TEST_ADDRESS_1, satoshis: 5000 }],
      selectedUtxos: [mockUtxo],
      totalInput: 100,
      feeRate: 0.05,
    })).rejects.toThrow('Insufficient funds')
  })
})
```

**Step 3: Run tests to confirm they fail**
```bash
npm run test:run -- src/domain/transaction/builder.test.ts
```
Expected: FAIL — `buildMultiOutputP2PKHTx` not found.

**Step 4: Add `BuildMultiOutputP2PKHTxParams` type and `buildMultiOutputP2PKHTx` function to `src/domain/transaction/builder.ts`**

Add after the existing types section:
```typescript
export interface RecipientOutput {
  address: string
  satoshis: number
}

export interface BuildMultiOutputP2PKHTxParams {
  wif: string
  outputs: RecipientOutput[]
  selectedUtxos: UTXO[]
  totalInput: number
  feeRate: number
}

export interface BuiltMultiOutputTransaction extends BuiltTransaction {
  totalSent: number
}
```

Add the function after `buildP2PKHTx`:
```typescript
export async function buildMultiOutputP2PKHTx(
  params: BuildMultiOutputP2PKHTxParams
): Promise<BuiltMultiOutputTransaction> {
  const { wif, outputs, selectedUtxos, totalInput, feeRate } = params

  if (outputs.length === 0) {
    throw new Error('Must have at least one output')
  }

  const totalSent = outputs.reduce((sum, o) => sum + o.satoshis, 0)

  // Delegate to Rust when running inside Tauri
  if (isTauri()) {
    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      change: number
      changeAddress: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_multi_output_p2pkh_tx_from_store', {
      outputs,
      selectedUtxos: selectedUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? '',
      })),
      totalInput,
      feeRate,
    })
    return {
      tx: null,
      rawTx: result.rawTx,
      txid: result.txid,
      fee: result.fee,
      change: result.change,
      changeAddress: result.changeAddress,
      numOutputs: result.change > 0 ? outputs.length + 1 : outputs.length,
      spentOutpoints: result.spentOutpoints,
      totalSent,
    }
  }

  // JS fallback
  const privateKey = PrivateKey.fromWif(wif)
  const fromAddress = privateKey.toPublicKey().toAddress()
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  // Calculate fee: n inputs, m outputs + optional change
  // First estimate with change, then refine
  const prelimNumOutputs = outputs.length + 1 // assume change initially
  const fee = calculateTxFee(selectedUtxos.length, prelimNumOutputs, feeRate)
  const change = totalInput - totalSent - fee

  if (change < 0) {
    throw new Error(
      `Insufficient funds: need ${totalSent + fee} sats (${totalSent} + ${fee} fee), have ${totalInput}`
    )
  }

  const tx = new Transaction()

  for (const utxo of selectedUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey, 'all', false, utxo.satoshis, sourceLockingScript
      ),
      sequence: 0xffffffff,
    })
  }

  for (const output of outputs) {
    tx.addOutput({ lockingScript: new P2PKH().lock(output.address), satoshis: output.satoshis })
  }

  if (change > 0) {
    tx.addOutput({ lockingScript: new P2PKH().lock(fromAddress), satoshis: change })
  }

  await tx.sign()

  return {
    tx,
    rawTx: tx.toHex(),
    txid: tx.id('hex'),
    fee,
    change,
    changeAddress: fromAddress,
    numOutputs: tx.outputs.length,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout })),
    totalSent,
  }
}
```

**Step 5: Run tests to confirm they pass**
```bash
npm run test:run -- src/domain/transaction/builder.test.ts
```
Expected: PASS (new tests + all existing tests)

**Step 6: Add multi-recipient UI to SendModal**

The UI adds an "Add recipient" toggle. When active, replace the single address+amount with a list of rows.

In `src/components/modals/SendModal.tsx`, add state and UI:

```tsx
// Add to state declarations:
const [multiRecipient, setMultiRecipient] = useState(false)
const [recipients, setRecipients] = useState<Array<{ address: string; amount: string }>>([
  { address: '', amount: '' }
])

// Add helpers:
const addRecipient = () => setRecipients(r => [...r, { address: '', amount: '' }])
const removeRecipient = (i: number) => setRecipients(r => r.filter((_, idx) => idx !== i))
const updateRecipient = (i: number, field: 'address' | 'amount', value: string) =>
  setRecipients(r => r.map((rec, idx) => idx === i ? { ...rec, [field]: value } : rec))
```

In the form JSX, replace the single address+amount block with a conditional:
- When `multiRecipient === false`: render existing single address/amount fields (unchanged)
- When `multiRecipient === true`: render a list of `{address, amount}` row pairs with +/- buttons

Add a toggle link below the amount field:
```tsx
<button
  type="button"
  className="btn btn-ghost"
  style={{ fontSize: 12, padding: '4px 8px' }}
  onClick={() => setMultiRecipient(v => !v)}
>
  {multiRecipient ? '− Single recipient' : '+ Multiple recipients'}
</button>
```

Wire the multi-recipient send to call `handleSendMulti(recipients, selectedUtxos)` — add this to `walletAdapter.ts` analogous to `handleSend` but calling `buildMultiOutputP2PKHTx`.

**Step 7: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```
Expected: 0 errors

**Step 8: Commit**
```bash
git add src/domain/transaction/builder.ts \
        src/domain/transaction/builder.test.ts \
        src/components/modals/SendModal.tsx \
        src/adapters/walletAdapter.ts
git commit -m "feat: add multi-recipient transaction support"
```

---

## Task 4: Ordinal Inscription Creation

**Files:**
- Read: `src/services/wallet/ordinals.ts` (understand existing patterns)
- Read: `src/services/wallet/marketplace.ts` (understand broadcast pattern)
- Create: `src/services/wallet/inscribe.ts`
- Create: `src/components/modals/InscribeModal.tsx`
- Modify: `src/components/tabs/OrdinalsTab.tsx` (add Inscribe button)
- Test: `src/services/wallet/inscribe.test.ts`

**Context:** `js-1sat-ord` v0.1.91 has inscription creation utilities. The pattern mirrors `marketplace.ts` — use `js-1sat-ord` for the envelope script, fund with payment UTXOs, broadcast via `executeBroadcast`.

**Step 1: Check what js-1sat-ord exports for inscription**
```bash
node -e "const m = require('./node_modules/js-1sat-ord'); console.log(Object.keys(m))"
```
Look for: `createOrdinals`, `inscribeOrdinals`, or similar.

**Step 2: Write failing test in `src/services/wallet/inscribe.test.ts`**
```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildInscriptionTx } from './inscribe'

vi.mock('../../infrastructure/api/clients', () => ({ gpOrdinalsApi: { post: vi.fn() } }))
vi.mock('../sync', () => ({
  recordSentTransaction: vi.fn().mockResolvedValue(undefined),
  markUtxosPendingSpend: vi.fn().mockResolvedValue({ ok: true }),
  confirmUtxosSpent: vi.fn().mockResolvedValue({ ok: true }),
  rollbackPendingSpend: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./transactions', () => ({ broadcastTransaction: vi.fn().mockResolvedValue('a'.repeat(64)) }))

const TEST_WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y' // known test WIF

describe('buildInscriptionTx', () => {
  it('throws if no funding UTXOs', async () => {
    await expect(buildInscriptionTx({
      ordWif: TEST_WIF,
      paymentWif: TEST_WIF,
      paymentUtxos: [],
      content: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
    })).rejects.toThrow('No funding UTXOs')
  })
})
```

**Step 3: Run test to confirm it fails**
```bash
npm run test:run -- src/services/wallet/inscribe.test.ts
```
Expected: FAIL — `buildInscriptionTx` not found.

**Step 4: Create `src/services/wallet/inscribe.ts`**
```typescript
/**
 * Ordinal inscription creation
 * Creates new 1Sat Ordinal inscriptions using js-1sat-ord
 */

import type { PrivateKey as BsvPrivateKey } from '@bsv/sdk'
import { PrivateKey, P2PKH } from '@bsv/sdk'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrivateKey = any

import type { UTXO } from './types'
import { broadcastTransaction } from './transactions'
import { recordSentTransaction, markUtxosPendingSpend, confirmUtxosSpent, rollbackPendingSpend } from '../sync'
import { walletLogger } from '../logger'

const inscribeLogger = walletLogger

export interface InscribeParams {
  /** WIF for the ordinals receiving address */
  ordWif: string
  /** WIF for payment (fee) UTXOs */
  paymentWif: string
  /** UTXOs to fund the inscription fee */
  paymentUtxos: UTXO[]
  /** Raw content bytes */
  content: Uint8Array
  /** MIME type e.g. 'image/png', 'text/plain' */
  contentType: string
  /** Address to receive the inscription */
  destinationAddress: string
}

function toOrdUtxoBase64(utxo: UTXO, pk: BsvPrivateKey) {
  let scriptHex: string
  if (utxo.script) {
    scriptHex = utxo.script
  } else {
    scriptHex = new P2PKH().lock(pk.toPublicKey().toAddress()).toHex()
  }
  const bytes = new Uint8Array(scriptHex.length / 2)
  for (let i = 0; i < scriptHex.length; i += 2) {
    bytes[i / 2] = parseInt(scriptHex.substring(i, i + 2), 16)
  }
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: btoa(String.fromCharCode(...bytes)),
  }
}

/**
 * Build and broadcast a 1Sat Ordinal inscription transaction.
 * Returns the txid of the inscription.
 */
export async function buildInscriptionTx(params: InscribeParams): Promise<string> {
  const { ordWif, paymentWif, paymentUtxos, content, contentType, destinationAddress } = params

  if (paymentUtxos.length === 0) {
    throw new Error('No funding UTXOs provided for inscription fee')
  }

  const { createOrdinals } = await import('js-1sat-ord')

  const ordPk = PrivateKey.fromWif(ordWif)
  const paymentPk = PrivateKey.fromWif(paymentWif)

  const fundingUtxos = paymentUtxos.slice(0, 3) // use up to 3 UTXOs for fee

  const utxosToSpend = fundingUtxos.map(u => ({ txid: u.txid, vout: u.vout }))

  const pendingResult = await markUtxosPendingSpend(utxosToSpend, 'inscribe-pending')
  if (!pendingResult.ok) {
    throw new Error(`Failed to mark UTXOs pending: ${pendingResult.error.message}`)
  }

  let txid: string
  try {
    // Convert content to base64 for js-1sat-ord
    const contentBase64 = btoa(String.fromCharCode(...content))

    const result = await createOrdinals({
      utxos: fundingUtxos.map(u => toOrdUtxoBase64(u, paymentPk)),
      destinations: [{
        address: destinationAddress,
        inscription: {
          dataB64: contentBase64,
          contentType,
        },
      }],
      paymentPk: paymentPk as AnyPrivateKey,
      changeAddress: paymentPk.toPublicKey().toAddress(),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txid = await broadcastTransaction(result.tx as any)
  } catch (err) {
    try { await rollbackPendingSpend(utxosToSpend) } catch { /* best-effort */ }
    throw err
  }

  try {
    await recordSentTransaction(txid, '', `Inscribed ${contentType} ordinal`, ['ordinal', 'inscribe'])
    const confirmResult = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult.ok) {
      inscribeLogger.warn('Failed to confirm UTXOs after inscription', { txid })
    }
  } catch (err) {
    inscribeLogger.warn('Failed to record inscription locally', { error: String(err) })
  }

  inscribeLogger.info('Ordinal inscribed', { txid, contentType })
  return txid
}
```

**Step 5: Run test to confirm it passes**
```bash
npm run test:run -- src/services/wallet/inscribe.test.ts
```
Expected: PASS

**Step 6: Create `src/components/modals/InscribeModal.tsx`**
```tsx
import { useState, useRef } from 'react'
import { Modal } from '../shared/Modal'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { buildInscriptionTx } from '../../services/wallet/inscribe'

interface InscribeModalProps {
  onClose: () => void
}

const MAX_FILE_SIZE = 100 * 1024 // 100KB — keep inscriptions small

export function InscribeModal({ onClose }: InscribeModalProps) {
  const { wallet, utxos } = useWalletState()
  const { refreshWallet } = useWalletActions()
  const { showToast } = useUI()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [inscribing, setInscribing] = useState(false)
  const [error, setError] = useState('')

  if (!wallet) return null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setError(`File too large (max 100KB). Selected: ${(f.size / 1024).toFixed(1)}KB`)
      return
    }
    setError('')
    setFile(f)
  }

  const handleInscribe = async () => {
    if (!file || !wallet) return
    setInscribing(true)
    setError('')

    try {
      const buffer = await file.arrayBuffer()
      const content = new Uint8Array(buffer)

      const txid = await buildInscriptionTx({
        ordWif: wallet.ordWif,
        paymentWif: wallet.wif,
        paymentUtxos: utxos.map(u => ({
          txid: u.txid,
          vout: u.vout,
          satoshis: u.satoshis,
          script: u.script,
        })),
        content,
        contentType: file.type || 'application/octet-stream',
        destinationAddress: wallet.ordAddress,
      })

      showToast(`Inscribed! TX: ${txid.slice(0, 12)}...`)
      await refreshWallet()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription failed')
    } finally {
      setInscribing(false)
    }
  }

  return (
    <Modal onClose={onClose} title="Inscribe Ordinal">
      <div className="modal-content compact">
        <p className="form-hint" style={{ marginBottom: 12 }}>
          Create a new 1Sat Ordinal inscription. The file will be permanently stored on-chain.
        </p>

        <div className="form-group">
          <label className="form-label">File (max 100KB)</label>
          <input
            ref={fileRef}
            type="file"
            className="form-input"
            onChange={handleFileChange}
            accept="image/*,text/*,application/json"
          />
          {file && (
            <p className="form-hint">
              {file.name} — {(file.size / 1024).toFixed(1)}KB — {file.type}
            </p>
          )}
        </div>

        {error && (
          <div className="warning compact" role="alert">
            <span className="warning-text">{error}</span>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleInscribe}
          disabled={!file || inscribing}
          aria-busy={inscribing}
        >
          {inscribing ? 'Inscribing…' : 'Inscribe'}
        </button>
      </div>
    </Modal>
  )
}
```

**Step 7: Add Inscribe button to OrdinalsTab**

In `src/components/tabs/OrdinalsTab.tsx` (or wherever ordinals are rendered), add an "Inscribe" button that opens `InscribeModal`. Follow the existing modal open pattern used by `OrdinalTransferModal`.

**Step 8: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```
Expected: 0 errors. Fix any issues with wallet property names (check `wallet.ordWif`, `wallet.ordAddress` against actual WalletKeys type in `src/domain/types.ts`).

**Step 9: Commit**
```bash
git add src/services/wallet/inscribe.ts \
        src/services/wallet/inscribe.test.ts \
        src/components/modals/InscribeModal.tsx \
        src/components/tabs/OrdinalsTab.tsx
git commit -m "feat: add ordinal inscription creation"
```

---

## Task 5: Ordinals Marketplace — Purchase

**Files:**
- Read: `src/services/wallet/marketplace.ts` (understand existing pattern)
- Modify: `src/services/wallet/marketplace.ts` (add `purchaseOrdinal`)
- Modify: `src/components/modals/OrdinalModal.tsx` (add buy button for listed ordinals)
- Test: `src/services/wallet/marketplace.test.ts` (add purchase test)

**Context:** `js-1sat-ord` exports `purchaseOrdListing`. The pattern is identical to `listOrdinal`/`cancelOrdinalListing` already in `marketplace.ts`.

**Step 1: Check js-1sat-ord for purchase function**
```bash
node -e "const m = require('./node_modules/js-1sat-ord'); console.log(Object.keys(m).filter(k => k.toLowerCase().includes('purch') || k.toLowerCase().includes('buy')))"
```

**Step 2: Write failing test**

Add to `src/services/wallet/marketplace.test.ts` (create if not exists):
```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { purchaseOrdinal } from './marketplace'

vi.mock('./transactions', () => ({ broadcastTransaction: vi.fn().mockResolvedValue('a'.repeat(64)) }))
vi.mock('../sync', () => ({
  recordSentTransaction: vi.fn().mockResolvedValue(undefined),
  markUtxosPendingSpend: vi.fn().mockResolvedValue({ ok: true }),
  confirmUtxosSpent: vi.fn().mockResolvedValue({ ok: true }),
  rollbackPendingSpend: vi.fn().mockResolvedValue(undefined),
}))

const TEST_WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y'

describe('purchaseOrdinal', () => {
  it('throws if insufficient payment UTXOs', async () => {
    await expect(purchaseOrdinal({
      paymentWif: TEST_WIF,
      paymentUtxos: [],
      ordAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      priceSats: 10000,
    })).rejects.toThrow()
  })
})
```

**Step 3: Run test to confirm it fails**
```bash
npm run test:run -- src/services/wallet/marketplace.test.ts
```

**Step 4: Add `purchaseOrdinal` to `src/services/wallet/marketplace.ts`**

```typescript
/**
 * Purchase a listed ordinal by paying the listing price.
 *
 * @param paymentWif - WIF private key for payment UTXOs
 * @param paymentUtxos - UTXOs to fund the purchase
 * @param ordAddress - Address to receive the purchased ordinal
 * @param listingUtxo - The UTXO of the listed ordinal (in OrdinalLock)
 * @param priceSats - The listing price in satoshis
 * @returns Transaction ID of the purchase
 */
export async function purchaseOrdinal(params: {
  paymentWif: string
  paymentUtxos: UTXO[]
  ordAddress: string
  listingUtxo: UTXO
  priceSats: number
}): Promise<string> {
  const { paymentWif, paymentUtxos, ordAddress, listingUtxo, priceSats } = params

  if (paymentUtxos.length === 0) {
    throw new Error('No payment UTXOs available to purchase ordinal')
  }

  const { purchaseOrdListing } = await import('js-1sat-ord')
  const paymentPk = PrivateKey.fromWif(paymentWif)

  // Select UTXOs that cover the price + estimated fee
  const fundingToUse = paymentUtxos.slice(0, 3)
  const totalFunding = fundingToUse.reduce((s, u) => s + u.satoshis, 0)
  if (totalFunding < priceSats) {
    throw new Error(`Insufficient funds: need at least ${priceSats} sats, have ${totalFunding}`)
  }

  const utxosToSpend = fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))

  const pendingResult = await markUtxosPendingSpend(utxosToSpend, 'purchase-pending')
  if (!pendingResult.ok) {
    throw new Error(`Failed to mark UTXOs pending: ${pendingResult.error.message}`)
  }

  let txid: string
  try {
    const result = await purchaseOrdListing({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      listingUtxo: toOrdUtxo(listingUtxo),
      ordAddress,
      paymentPk: paymentPk as AnyPrivateKey,
      changeAddress: paymentPk.toPublicKey().toAddress(),
    })
    txid = await broadcastTransaction(result.tx as unknown as Transaction)
  } catch (err) {
    try { await rollbackPendingSpend(utxosToSpend) } catch { /* best-effort */ }
    throw err
  }

  try {
    await recordSentTransaction(
      txid, '',
      `Purchased ordinal ${listingUtxo.txid.slice(0, 8)}... for ${priceSats} sats`,
      ['ordinal', 'purchase']
    )
    const confirmResult = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult.ok) {
      mpLogger.warn('Failed to confirm UTXOs after purchase', { txid })
    }
  } catch (err) {
    mpLogger.warn('Failed to record purchase locally', { error: String(err) })
  }

  mpLogger.info('Ordinal purchased', { txid, price: priceSats })
  return txid
}
```

**Step 5: Add Buy button to OrdinalModal**

In `src/components/modals/OrdinalModal.tsx`: if the ordinal has a `listPrice` (i.e., it's in an OrdinalLock), show a "Buy for X sats" button that calls `purchaseOrdinal`.

**Step 6: Run tests, typecheck, lint**
```bash
npm run test:run -- src/services/wallet/marketplace.test.ts
npm run typecheck && npm run lint
```

**Step 7: Commit**
```bash
git add src/services/wallet/marketplace.ts \
        src/services/wallet/marketplace.test.ts \
        src/components/modals/OrdinalModal.tsx
git commit -m "feat: add ordinal marketplace purchase functionality"
```

---

## Task 6: Standalone Message Signing UI

**Files:**
- Create: `src/components/modals/SignMessageModal.tsx`
- Modify: `src/components/modals/settings/SettingsWallet.tsx` (add Sign Message button)
- Modify: `src/components/modals/AppModals.tsx` or wherever modals are registered

**Context:** The BRC-100 flow already calls `createSignature` via the HTTP server. For standalone use, we expose a simple sign+verify form using `@bsv/sdk` directly.

**Step 1: Read SettingsWallet.tsx**
```bash
cat src/components/modals/settings/SettingsWallet.tsx
```

**Step 2: Create `src/components/modals/SignMessageModal.tsx`**
```tsx
import { useState } from 'react'
import { PrivateKey, Hash } from '@bsv/sdk'
import { Modal } from '../shared/Modal'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'

interface SignMessageModalProps {
  onClose: () => void
}

export function SignMessageModal({ onClose }: SignMessageModalProps) {
  const { wallet } = useWalletState()
  const { showToast } = useUI()
  const [message, setMessage] = useState('')
  const [signature, setSignature] = useState('')
  const [verifyMessage, setVerifyMessage] = useState('')
  const [verifySignature, setVerifySignature] = useState('')
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'sign' | 'verify'>('sign')

  if (!wallet) return null

  const handleSign = () => {
    try {
      const privKey = PrivateKey.fromWif(wallet.wif)
      const msgBytes = new TextEncoder().encode(message)
      const hash = Hash.sha256(Array.from(msgBytes))
      const sig = privKey.sign(hash)
      setSignature(sig.toDER('hex') as string)
      showToast('Message signed')
    } catch (err) {
      showToast('Signing failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    }
  }

  const handleVerify = () => {
    try {
      const privKey = PrivateKey.fromWif(wallet.wif)
      const pubKey = privKey.toPublicKey()
      const msgBytes = new TextEncoder().encode(verifyMessage)
      const hash = Hash.sha256(Array.from(msgBytes))
      // Import Signature from @bsv/sdk
      const { Signature } = require('@bsv/sdk') as typeof import('@bsv/sdk')
      const sig = Signature.fromDER(Buffer.from(verifySignature, 'hex'))
      setVerifyResult(pubKey.verify(hash, sig))
    } catch {
      setVerifyResult(false)
    }
  }

  return (
    <Modal onClose={onClose} title="Sign / Verify Message">
      <div className="modal-content compact">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn ${tab === 'sign' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('sign')}>Sign</button>
          <button className={`btn ${tab === 'verify' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('verify')}>Verify</button>
        </div>

        {tab === 'sign' && (
          <>
            <div className="form-group">
              <label className="form-label">Message</label>
              <textarea className="form-input" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleSign} disabled={!message}>Sign</button>
            {signature && (
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Signature (DER hex)</label>
                <textarea className="form-input mono" rows={3} readOnly value={signature} />
                <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => { navigator.clipboard.writeText(signature); showToast('Copied') }}>Copy</button>
              </div>
            )}
          </>
        )}

        {tab === 'verify' && (
          <>
            <div className="form-group">
              <label className="form-label">Message</label>
              <textarea className="form-input" rows={3} value={verifyMessage} onChange={e => setVerifyMessage(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Signature (DER hex)</label>
              <textarea className="form-input mono" rows={3} value={verifySignature} onChange={e => setVerifySignature(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleVerify} disabled={!verifyMessage || !verifySignature}>Verify</button>
            {verifyResult !== null && (
              <div className={`warning compact ${verifyResult ? 'success' : ''}`} style={{ marginTop: 12 }}>
                {verifyResult ? '✓ Valid signature' : '✗ Invalid signature'}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
```

**Step 3: Add "Sign Message" button to SettingsWallet**

In `src/components/modals/settings/SettingsWallet.tsx`, add a button that opens `SignMessageModal`. Follow the same pattern as other modals in settings (local `showSignMessage` state + conditional render).

**Step 4: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```
Fix any import issues. Note: `require('@bsv/sdk')` in the verify handler should be replaced with a proper top-level import of `Signature`.

**Step 5: Commit**
```bash
git add src/components/modals/SignMessageModal.tsx \
        src/components/modals/settings/SettingsWallet.tsx
git commit -m "feat: add standalone message sign/verify modal"
```

---

## Task 7: MNEE Stablecoin Recognition

**Files:**
- Read: `src/services/tokens.ts` (understand Token type and fetchTokenBalances)
- Modify: `src/services/tokens.ts` (add MNEE detection)
- Modify: `src/components/tabs/TokensTab.tsx` or wherever tokens are displayed (add MNEE icon/label)

**Context:** MNEE is a BSV-21 token. Its contract txid is publicly known. We add it as a well-known token so it displays with a recognizable label and USD value estimate.

**Step 1: Look up MNEE contract txid**
Search the Yours Wallet codebase or GorillaPool for the MNEE BSV-21 contract txid.
```bash
# Check if MNEE is mentioned anywhere in the codebase already
grep -r "MNEE\|mnee" src/ --include="*.ts" --include="*.tsx"
```

**Step 2: Add MNEE as a well-known token constant**

In `src/config/index.ts`, add to a new `KNOWN_TOKENS` section:
```typescript
export const KNOWN_TOKENS = {
  MNEE: {
    ticker: 'MNEE',
    protocol: 'bsv21' as const,
    name: 'MNEE USD',
    decimals: 2,
    // contractTxid: discovered in step 1
  },
} as const
```

**Step 3: Ensure MNEE displays properly**

In `src/services/tokens.ts`, in `fetchTokenBalances`, tokens are already fetched from GorillaPool. MNEE will appear automatically once the user holds it. The KNOWN_TOKENS config lets the UI show a consistent name and decimal precision.

Update `syncTokenBalances` to seed MNEE as a known token in the DB if not already present (so it shows even with zero balance when first seen):
```typescript
// After fetching balances, ensure known tokens are in DB
import { KNOWN_TOKENS } from '../../config'
for (const knownToken of Object.values(KNOWN_TOKENS)) {
  const existing = await getTokenByTicker(knownToken.ticker)
  if (!existing) {
    await upsertToken({ ...knownToken, verified: true, contractTxid: undefined })
  }
}
```

**Step 4: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```

**Step 5: Commit**
```bash
git add src/config/index.ts src/services/tokens.ts
git commit -m "feat: add MNEE stablecoin as well-known token"
```

---

## Task 8: SDK Method Parity Audit

**Files:**
- Read: `sdk/src/index.ts` (current SDK methods)
- Read: Yours Wallet Provider API docs (public reference)
- Modify: `sdk/src/index.ts` (add missing methods)

**Yours Provider API methods to check against Simply Sats SDK:**

| Yours Method | Simply Sats Equivalent | Gap? |
|---|---|---|
| `getAddresses()` | `getPublicKey()` | Partial — Yours returns payment+ordinals addresses |
| `getBalance()` | `getBalance()` | ✅ |
| `sendBsv()` | `createAction()` | ✅ (different API) |
| `getUtxos()` | `listOutputs()` | ✅ |
| `signMessage()` | `createSignature()` | ✅ |
| `encrypt()`/`decrypt()` | Not in SDK | ❌ Missing |
| `getExchangeRate()` | Not in SDK | ❌ Missing |
| `getTokenBalance()` | Not in SDK | ❌ Missing |
| `transferOrdinal()` | Not in SDK | ❌ Missing |
| `lockBsv()` | `lockBSV()` | ✅ |
| `getSignatures()` | Not in SDK | ❌ Missing (batch signing) |

**Step 1: Add missing SDK methods**

In `sdk/src/index.ts`, add:
```typescript
/** Get current USD exchange rate for BSV */
async getExchangeRate(): Promise<{ rate: number; currency: string }> {
  return this.request<{ rate: number; currency: string }>('getExchangeRate')
}

/** Get token balance for a specific ticker */
async getTokenBalance(ticker: string): Promise<{ ticker: string; balance: string; decimals: number }> {
  return this.request<{ ticker: string; balance: string; decimals: number }>('getTokenBalance', { ticker })
}

/** Encrypt data using the wallet identity key */
async encrypt(options: { data: string; pubKey?: string; nonce?: string }): Promise<{ encryptedData: string }> {
  return this.request<{ encryptedData: string }>('encrypt', options)
}

/** Decrypt data using the wallet identity key */
async decrypt(options: { encryptedData: string; pubKey?: string; nonce?: string }): Promise<{ data: string }> {
  return this.request<{ data: string }>('decrypt', options)
}
```

**Step 2: Add corresponding HTTP endpoints to Tauri backend**

In `src-tauri/src/http_server.rs`, add handlers for `getExchangeRate`, `getTokenBalance`, `encrypt`, `decrypt`. These delegate to the existing Rust/JS implementations.

Note: `encrypt`/`decrypt` already work via BRC-100 `createSignature` internally. The SDK just needs to expose them.

**Step 3: Typecheck SDK**
```bash
cd sdk && npm run build && cd ..
```

**Step 4: Commit**
```bash
git add sdk/src/index.ts src-tauri/src/http_server.rs
git commit -m "feat: add missing SDK methods for Yours Wallet API parity (encrypt, decrypt, getExchangeRate, getTokenBalance)"
```

---

## Task 9: 24-Word Seed Phrase Support

**Files:**
- Read: `src/services/keyDerivation.ts`
- Read: `src/components/onboarding/` (list files)
- Modify: `src/components/onboarding/CreateWallet.tsx` (or equivalent) — add 12/24 word toggle
- Modify: `src/services/keyDerivation.ts` — accept 24-word mnemonics (likely already works)
- Test: `src/services/keyDerivation.test.ts` — add 24-word test

**Context:** `bip39` library (already a dependency) supports both 12 and 24 word mnemonics. `generateMnemonic()` defaults to 128 bits (12 words); 256 bits gives 24 words. Key derivation is identical — just more entropy.

**Step 1: Check current mnemonic generation**
```bash
grep -n "generateMnemonic\|128\|256\|wordlist" src/services/keyDerivation.ts | head -20
```

**Step 2: Write failing test**

In `src/services/keyDerivation.test.ts`, add:
```typescript
it('derives wallet keys from a 24-word mnemonic', async () => {
  const { generateMnemonic } = await import('bip39')
  const mnemonic24 = generateMnemonic(256) // 24 words
  const words = mnemonic24.split(' ')
  expect(words).toHaveLength(24)
  // Should derive valid keys without throwing
  const keys = await deriveWalletKeys(mnemonic24)
  expect(keys.address).toMatch(/^1[a-zA-Z0-9]{25,34}$/)
})
```

**Step 3: Run test** — it likely already passes. If so, the service layer is fine.

**Step 4: Update onboarding UI to offer 12 vs 24 word choice**

In the wallet creation flow, add a radio/toggle:
```tsx
<div className="form-group">
  <label className="form-label">Seed Phrase Length</label>
  <div style={{ display: 'flex', gap: 12 }}>
    <label><input type="radio" value="12" checked={wordCount === 12} onChange={() => setWordCount(12)} /> 12 words</label>
    <label><input type="radio" value="24" checked={wordCount === 24} onChange={() => setWordCount(24)} /> 24 words (recommended)</label>
  </div>
</div>
```

Generate mnemonic with:
```typescript
const mnemonic = generateMnemonic(wordCount === 24 ? 256 : 128)
```

**Step 5: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```

**Step 6: Commit**
```bash
git add src/services/keyDerivation.ts \
        src/services/keyDerivation.test.ts \
        src/components/onboarding/
git commit -m "feat: add 24-word seed phrase support in wallet creation"
```

---

## Task 10: WIF Private Key Export/Import

**Files:**
- Read: `src/components/modals/settings/SettingsWallet.tsx`
- Read: `src/components/onboarding/RestoreModal.tsx` (or equivalent restore flow)
- Modify: `src/components/modals/settings/SettingsWallet.tsx` (add WIF export)
- Modify: `src/components/onboarding/` (add WIF import option)

**Step 1: Add WIF Export to SettingsWallet**

```tsx
// In SettingsWallet.tsx, add a "Export WIF" section with password confirmation
const [showWif, setShowWif] = useState(false)

// After password confirmation:
const wif = wallet.wif  // already in memory when wallet is unlocked
// Display in a copyable textarea with warning
```

**Step 2: Add WIF Import to Onboarding**

In the restore flow, add an alternative tab "Import WIF":
```tsx
// Allow user to paste a WIF and derive the wallet
// Use PrivateKey.fromWif(wif).toPublicKey().toAddress() to get address
// Store as a WIF-only wallet (no mnemonic)
```

**Security note:** Show a prominent warning that WIF import means no seed phrase backup.

**Step 3: Typecheck and lint**
```bash
npm run typecheck && npm run lint
```

**Step 4: Commit**
```bash
git add src/components/modals/settings/SettingsWallet.tsx \
        src/components/onboarding/
git commit -m "feat: add WIF private key export and import"
```

---

## Task 11: Per-dApp Tagged Derivation in SDK

**Files:**
- Read: `sdk/src/index.ts`
- Read: `src/services/brc100/` (understand key derivation path)
- Modify: `sdk/src/index.ts` (add `getTaggedKey` method)
- Modify: `src-tauri/src/http_server.rs` (add endpoint)

**Context:** Yours Wallet derives a deterministic keypair per dApp using a tag string. Simply Sats uses BRC-42/43 ECDH for privacy. Tagged derivation adds a complementary approach: `HMAC-SHA256(masterKey, tag)` → deterministic child key per dApp.

**Step 1: Add SDK method**
```typescript
/** Get a deterministic key derived from a tag string (per-dApp key isolation) */
async getTaggedKey(options: { tag: string; nonce?: string }): Promise<{ publicKey: string; address: string }> {
  return this.request<{ publicKey: string; address: string }>('getTaggedKey', options)
}
```

**Step 2: Add HTTP endpoint in `src-tauri/src/http_server.rs`**

Add a `getTaggedKey` route that:
1. Validates session token
2. Derives child key: `HMAC-SHA256(identity_private_key_bytes, tag_utf8_bytes)`
3. Returns the public key and address

**Step 3: Commit**
```bash
git add sdk/src/index.ts src-tauri/src/http_server.rs
git commit -m "feat: add per-dApp tagged key derivation to SDK"
```

---

## Task 12: SPV Verification (Architectural — Separate Deep-Dive)

**This is the largest gap and requires a dedicated plan.** SPV cannot be added incrementally to the existing API-trust model without significant refactoring. Scope:

1. **Block header tracking:** Fetch and store block headers (80 bytes each). Requires a new `blockHeaders` table and sync loop.
2. **Merkle proof verification:** For each incoming transaction, fetch a merkle proof and verify against the stored block header.
3. **BEEF format support:** Replace raw hex broadcasting with BEEF (Background Evaluation Extended Format) that bundles the tx + merkle proofs.
4. **@bsv/sdk upgrade:** v1.10.3 lacks SPV classes. Evaluate upgrading to a newer version or using `@bsv/overlay-express` / `spv-store`.

**Recommended approach:**
- Upgrade `@bsv/sdk` to latest
- Add a `ChainTracker` service that fetches and caches block headers from WhatsOnChain
- Add `verifyMerkleProof(txid, proof, blockHash)` to the transaction service
- Verify proofs lazily (on tx display) rather than blocking on sync

**Action:** Create a separate plan `docs/plans/YYYY-MM-DD-spv-verification.md` after completing Tasks 1-11.

---

## Post-Implementation Verification

After all tasks:

```bash
# Full test suite must pass
npm run test:run

# Zero type errors
npm run typecheck

# Zero lint errors
npm run lint

# Build must succeed
npm run build
```

Run the app (`npm run tauri:dev`) and manually verify:
- [ ] Settings > Network shows mainnet/testnet toggle
- [ ] SendModal has MAX button (already present) and multi-recipient toggle
- [ ] Ordinals tab has Inscribe button
- [ ] OrdinalModal shows Buy button for listed ordinals
- [ ] Settings > Wallet has Sign Message and Export WIF buttons
- [ ] Wallet creation offers 12/24 word choice
- [ ] Restore flow accepts WIF import
