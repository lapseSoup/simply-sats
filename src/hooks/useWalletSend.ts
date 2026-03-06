/**
 * Hook for wallet send/transfer operations: send BSV, transfer ordinal, list ordinal, send token.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useCallback } from 'react'
import type { ActiveWallet, UTXO, Ordinal, ExtendedUTXO } from '../services/wallet'
import type { UTXO as DatabaseUTXO } from '../infrastructure/database'
import {
  getUTXOs,
  getUTXOLockingScript,
  sendBSVMultiKey,
  transferOrdinal
} from '../services/wallet'
import {
  sendBSVMultiKeyFromStore,
  sendBSVMultiOutput,
  sendBSVMultiOutputFromStore,
  type StoreBackedExtendedUTXO,
  type DerivedSignerDescriptor
} from '../services/wallet/transactions'
import { listOrdinal } from '../services/wallet/marketplace'
import {
  getDerivedAddresses,
  upsertTransaction
} from '../infrastructure/database'
import {
  ensureOrdinalCacheRowForTransferred
} from '../services/ordinalCache'
import { deriveChildKey } from '../services/keyDerivation'
import {
  getSpendableUtxosFromDatabase
} from '../services/sync'
import { findLocalAccountIdByAddress } from '../services/accounts'
import { audit } from '../services/auditLog'
import { walletLogger } from '../services/logger'
import { hasPrivateKeyMaterial, ok, err, type Result, type WalletResult, type WalletKeys } from '../domain/types'
import { ErrorCodes, AppError } from '../services/errors'
import type { RecipientOutput } from '../domain/transaction/builder'
import { isTauri } from '../utils/tauri'

/** Safely extract txid from an error context object */
function extractTxidFromContext(context: unknown): string {
  if (context != null && typeof context === 'object' && 'txid' in context) {
    const txid = (context as Record<string, unknown>).txid
    return typeof txid === 'string' ? txid : 'unknown'
  }
  return 'unknown'
}

function requireBrowserSendKeys(wallet: ActiveWallet, operationLabel: string): WalletKeys {
  if (!hasPrivateKeyMaterial(wallet)) {
    throw new Error(`No private keys available for browser ${operationLabel}`)
  }

  return wallet
}

/**
 * Build an array of ExtendedUTXOs for the browser/test send fallback.
 * Resolves derived address child keys via BRC-42 key derivation and optionally
 * fetches live UTXOs for derived addresses (skipped in coin-control mode).
 *
 * Shared by handleSend and handleSendMulti to eliminate duplicated key resolution logic.
 */
async function buildBrowserSendInputs(
  wallet: ActiveWallet,
  activeAccountId: number | null,
  operationLabel: string,
  selectedUtxos?: DatabaseUTXO[]
): Promise<{ extendedUtxos: ExtendedUTXO[]; walletWif: string; derivedMap: Map<string, string> }> {
  const browserKeys = requireBrowserSendKeys(wallet, operationLabel)
  const derivedMap = new Map<string, string>() // address -> WIF

  const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

  // Build a map of derived address -> WIF for correct per-UTXO signing
  const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
  for (const d of derivedAddrs) {
    if (d.senderPubkey && d.invoiceNumber) {
      // Re-derive the child private key from (identityKey + senderPubkey + invoiceNumber)
      // so we never need the WIF stored in the database
      try {
        const childKey = await deriveChildKey(
          browserKeys.identityWif,
          d.senderPubkey,
          d.invoiceNumber
        )
        derivedMap.set(d.address, childKey.wif)
      } catch (e) {
        walletLogger.warn('Failed to re-derive child key for derived address', {
          address: d.address,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    } else if (d.privateKeyWif) {
      // Legacy: support old records that still have WIF stored
      derivedMap.set(d.address, d.privateKeyWif)
    }
  }

  const walletWif = browserKeys.walletWif

  const extendedUtxos: ExtendedUTXO[] = spendableUtxos.map(u => {
    // Look up the correct WIF: derived address WIF, or fall back to wallet WIF
    const utxoAddress = u.address || wallet.walletAddress
    const wif = derivedMap.get(utxoAddress) || walletWif
    return {
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript || '',
      wif,
      address: utxoAddress
    }
  })

  // Include derived address UTXOs only when NOT in coin control mode
  if (!selectedUtxos) {
    for (const derived of derivedAddrs) {
      const derivedWif = derivedMap.get(derived.address)
      if (derivedWif) {
        try {
          const derivedUtxos = await getUTXOs(derived.address)
          for (const u of derivedUtxos) {
            extendedUtxos.push({
              ...u,
              wif: derivedWif,
              address: derived.address
            })
          }
        } catch (e) {
          walletLogger.warn('Failed to fetch derived address UTXOs, skipping', {
            address: derived.address,
            error: e instanceof Error ? e.message : String(e)
          })
        }
      }
    }
  }

  // Deduplicate UTXOs by txid:vout to prevent double-spend attempts
  const seen = new Set<string>()
  const deduplicatedUtxos = extendedUtxos.filter(u => {
    const key = `${u.txid}:${u.vout}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { extendedUtxos: deduplicatedUtxos, walletWif, derivedMap }
}

async function buildStoreBackedSendInputs(
  wallet: ActiveWallet,
  activeAccountId: number | null,
  selectedUtxos?: DatabaseUTXO[]
): Promise<{ utxos: StoreBackedExtendedUTXO[]; derivedSigners: DerivedSignerDescriptor[] }> {
  const derivedSigners = new Map<string, DerivedSignerDescriptor>()
  const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)
  const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)

  for (const derived of derivedAddrs) {
    if (derived.senderPubkey && derived.invoiceNumber) {
      derivedSigners.set(derived.address, {
        address: derived.address,
        senderPubkey: derived.senderPubkey,
        invoiceNumber: derived.invoiceNumber
      })
    } else if (derived.privateKeyWif) {
      derivedSigners.set(derived.address, {
        address: derived.address,
        legacyWif: derived.privateKeyWif
      })
    }
  }

  const utxos: StoreBackedExtendedUTXO[] = spendableUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    script: u.lockingScript || '',
    address: u.address || wallet.walletAddress
  }))

  if (!selectedUtxos) {
    for (const derived of derivedAddrs) {
      if (!derivedSigners.has(derived.address)) continue
      try {
        const derivedUtxos = await getUTXOs(derived.address)
        for (const utxo of derivedUtxos) {
          utxos.push({
            txid: utxo.txid,
            vout: utxo.vout,
            satoshis: utxo.satoshis,
            script: utxo.script ?? '',
            address: derived.address
          })
        }
      } catch (e) {
        walletLogger.warn('Failed to fetch derived address UTXOs, skipping', {
          address: derived.address,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  const seen = new Set<string>()
  const deduplicatedUtxos = utxos.filter(utxo => {
    const key = `${utxo.txid}:${utxo.vout}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    utxos: deduplicatedUtxos,
    derivedSigners: [...derivedSigners.values()]
  }
}

interface UseWalletSendOptions {
  wallet: ActiveWallet | null
  activeAccountId: number | null
  fetchData: () => Promise<void>
  refreshTokens: () => Promise<void>
  setOrdinals: (ordinals: Ordinal[]) => void
  getOrdinals: () => Ordinal[]
  sendTokenAction: (
    wallet: ActiveWallet,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ) => Promise<Result<{ txid: string }, string>>
  /** Fire-and-forget: background-sync all inactive accounts after a send. */
  syncInactiveAccountsBackground?: () => void
}

interface UseWalletSendReturn {
  handleSend: (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]) => Promise<WalletResult>
  handleSendMulti: (recipients: RecipientOutput[], selectedUtxos?: DatabaseUTXO[]) => Promise<WalletResult>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<WalletResult>
  handleListOrdinal: (ordinal: Ordinal, priceSats: number) => Promise<WalletResult>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<WalletResult>
}

export function useWalletSend({
  wallet,
  activeAccountId,
  fetchData,
  refreshTokens,
  setOrdinals,
  getOrdinals,
  sendTokenAction,
  syncInactiveAccountsBackground
}: UseWalletSendOptions): UseWalletSendReturn {
  const mirrorInternalReceives = useCallback(async (
    txid: string,
    recipients: Array<{ address: string; satoshis: number }>
  ): Promise<void> => {
    if (activeAccountId == null || recipients.length === 0) return

    const sumsByAccount = new Map<number, number>()
    for (const recipient of recipients) {
      if (!recipient.address || recipient.satoshis <= 0) continue
      try {
        const recipientAccountId = await findLocalAccountIdByAddress(recipient.address)
        if (recipientAccountId == null || recipientAccountId === activeAccountId) continue
        sumsByAccount.set(
          recipientAccountId,
          (sumsByAccount.get(recipientAccountId) ?? 0) + recipient.satoshis
        )
      } catch (e) {
        walletLogger.warn('Internal transfer lookup failed', {
          address: recipient.address,
          error: String(e)
        })
      }
    }

    if (sumsByAccount.size === 0) return

    await Promise.all(
      Array.from(sumsByAccount.entries()).map(async ([recipientAccountId, amount]) => {
        const txResult = await upsertTransaction({
          txid,
          description: `Received ${amount} sats (internal transfer)`,
          createdAt: Date.now(),
          status: 'pending',
          amount,
          labels: ['receive', 'internal']
        }, recipientAccountId)
        if (!txResult.ok) {
          walletLogger.warn('Failed to mirror internal receive transaction', {
            txid,
            recipientAccountId,
            error: txResult.error.message
          })
        }
      })
    )
  }, [activeAccountId])

  const mirrorInternalOrdinalReceive = useCallback(async (
    txid: string,
    ordinal: Ordinal,
    recipientAddress: string
  ): Promise<void> => {
    if (activeAccountId == null || !recipientAddress) return

    try {
      const recipientAccountId = await findLocalAccountIdByAddress(recipientAddress)
      if (recipientAccountId == null || recipientAccountId === activeAccountId) return

      await ensureOrdinalCacheRowForTransferred(ordinal.origin, recipientAccountId)

      const txResult = await upsertTransaction({
        txid,
        description: `Received ordinal ${ordinal.origin} (internal transfer)`,
        createdAt: Date.now(),
        status: 'pending',
        amount: 1,
        labels: ['ordinal', 'receive', 'internal']
      }, recipientAccountId)

      if (!txResult.ok) {
        walletLogger.warn('Failed to mirror internal ordinal receive transaction', {
          txid,
          recipientAccountId,
          origin: ordinal.origin,
          error: txResult.error.message
        })
      }
    } catch (e) {
      walletLogger.warn('Internal ordinal transfer lookup failed', {
        address: recipientAddress,
        origin: ordinal.origin,
        error: String(e)
      })
    }
  }, [activeAccountId])

  const handleSend = useCallback(async (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    let derivedMap: Map<string, string> | undefined
    try {
      const sendResult = isTauri()
        ? await (async () => {
          const result = await buildStoreBackedSendInputs(wallet, activeAccountId, selectedUtxos)
          return sendBSVMultiKeyFromStore(address, amountSats, result.utxos, result.derivedSigners, activeAccountId ?? undefined)
        })()
        : await (async () => {
          const result = await buildBrowserSendInputs(wallet, activeAccountId, 'sendBSV', selectedUtxos)
          derivedMap = result.derivedMap
          return sendBSVMultiKey(result.walletWif, address, amountSats, result.extendedUtxos, activeAccountId ?? undefined)
        })()
      if (!sendResult.ok) {
        // Q-65: Use error code instead of fragile string matching for broadcast-succeeded-but-DB-failed
        if (sendResult.error.code === ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED) {
          const txid = extractTxidFromContext(sendResult.error.context)
          walletLogger.warn('Broadcast succeeded but DB write failed — treating as success', { txid })
          return ok({ txid, warning: sendResult.error.message })
        }
        return err(sendResult.error.message)
      }
      const { txid } = sendResult.value
      await mirrorInternalReceives(txid, [{ address, satoshis: amountSats }])
      await fetchData()
      syncInactiveAccountsBackground?.()
      audit.transactionSent(txid, amountSats, activeAccountId ?? undefined)
      return ok({ txid })
    } catch (e) {
      // Q-65: Also handle thrown AppError with BROADCAST_SUCCEEDED_DB_FAILED code
      if (e instanceof AppError && e.code === ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED) {
        const txid = extractTxidFromContext(e.context)
        return ok({ txid, warning: e.message })
      }
      return err(e instanceof Error ? e.message : 'Send failed')
    } finally {
      derivedMap?.clear()
    }
  }, [wallet, fetchData, activeAccountId, syncInactiveAccountsBackground, mirrorInternalReceives])


  const handleSendMulti = useCallback(async (recipients: RecipientOutput[], selectedUtxos?: DatabaseUTXO[]): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    let derivedMap: Map<string, string> | undefined
    try {
      const totalSent = recipients.reduce((sum, r) => sum + r.satoshis, 0)
      const sendResult = isTauri()
        ? await (async () => {
          const result = await buildStoreBackedSendInputs(wallet, activeAccountId, selectedUtxos)
          return sendBSVMultiOutputFromStore(recipients, result.utxos, result.derivedSigners, activeAccountId ?? undefined)
        })()
        : await (async () => {
          const result = await buildBrowserSendInputs(wallet, activeAccountId, 'sendBSVMulti', selectedUtxos)
          derivedMap = result.derivedMap
          return sendBSVMultiOutput(result.walletWif, recipients, result.extendedUtxos, activeAccountId ?? undefined)
        })()
      if (!sendResult.ok) {
        if (sendResult.error.code === ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED) {
          const txid = extractTxidFromContext(sendResult.error.context)
          walletLogger.warn('Multi-send broadcast succeeded but DB write failed — treating as success', { txid })
          return ok({ txid, warning: sendResult.error.message })
        }
        return err(sendResult.error.message)
      }
      const { txid } = sendResult.value
      await mirrorInternalReceives(
        txid,
        recipients.map(r => ({ address: r.address, satoshis: r.satoshis }))
      )
      await fetchData()
      syncInactiveAccountsBackground?.()
      audit.transactionSent(txid, totalSent, activeAccountId ?? undefined)
      return ok({ txid })
    } catch (e) {
      if (e instanceof AppError && e.code === ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED) {
        const txid = extractTxidFromContext(e.context)
        return ok({ txid, warning: e.message })
      }
      return err(e instanceof Error ? e.message : 'Multi-recipient send failed')
    } finally {
      derivedMap?.clear()
    }
  }, [wallet, fetchData, activeAccountId, syncInactiveAccountsBackground, mirrorInternalReceives])

  const handleTransferOrdinal = useCallback(async (
    ordinal: Ordinal,
    toAddress: string
  ): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return err('No funding UTXOs available for transfer fee')
      }

      const lockingScript = await getUTXOLockingScript(ordinal.txid, ordinal.vout)
      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: lockingScript ?? ''
      }

      // B-24: Guard against null activeAccountId during initialization
      if (!activeAccountId) return err('No active account — cannot transfer ordinal')

      const txid = await transferOrdinal(
        '',
        ordinalUtxo,
        toAddress,
        '',
        fundingUtxos,
        activeAccountId,
        ordinal.origin
      )

      // Optimistically remove the transferred ordinal from UI state immediately
      // so the count drops right away without waiting for the next full sync.
      setOrdinals(getOrdinals().filter(o => !(o.txid === ordinal.txid && o.vout === ordinal.vout)))

      await mirrorInternalOrdinalReceive(txid, ordinal, toAddress)
      await fetchData()
      syncInactiveAccountsBackground?.()
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Transfer failed')
    }
  }, [wallet, activeAccountId, fetchData, setOrdinals, getOrdinals, syncInactiveAccountsBackground, mirrorInternalOrdinalReceive])

  const handleListOrdinal = useCallback(async (
    ordinal: Ordinal,
    priceSats: number
  ): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return err('No funding UTXOs available for listing fee')
      }

      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: ''
      }

      const listResult = await listOrdinal(
        ordinalUtxo,
        fundingUtxos,
        wallet.walletAddress,
        wallet.ordAddress,
        priceSats
      )

      if (!listResult.ok) {
        return err(listResult.error)
      }

      await fetchData()
      return ok({ txid: listResult.value })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Listing failed')
    }
  }, [wallet, fetchData])

  const handleSendToken = useCallback(async (
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    const result = await sendTokenAction(wallet, ticker, protocol, amount, toAddress)

    if (result.ok) {
      await fetchData()
      await refreshTokens()
      return ok({ txid: result.value.txid })
    }

    return err(result.error || 'Token transfer failed')
  }, [wallet, fetchData, refreshTokens, sendTokenAction])

  return {
    handleSend,
    handleSendMulti,
    handleTransferOrdinal,
    handleListOrdinal,
    handleSendToken
  }
}
