/**
 * Hook for wallet send/transfer operations: send BSV, transfer ordinal, list ordinal, send token.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useCallback } from 'react'
import { PrivateKey, PublicKey } from '@bsv/sdk'
import type { WalletKeys, UTXO, Ordinal, ExtendedUTXO } from '../services/wallet'
import type { UTXO as DatabaseUTXO } from '../infrastructure/database'
import {
  getUTXOs,
  getUTXOLockingScript,
  sendBSVMultiKey,
  transferOrdinal,
  getWifForOperation
} from '../services/wallet'
import { sendBSVMultiOutput } from '../services/wallet/transactions'
import { listOrdinal } from '../services/wallet/marketplace'
import {
  getDerivedAddresses
} from '../infrastructure/database'
import { deriveChildPrivateKey } from '../services/keyDerivation'
import {
  getSpendableUtxosFromDatabase
} from '../services/sync'
import { audit } from '../services/auditLog'
import { walletLogger } from '../services/logger'
import { ok, err, type Result, type WalletResult } from '../domain/types'
import type { RecipientOutput } from '../domain/transaction/builder'

interface UseWalletSendOptions {
  wallet: WalletKeys | null
  activeAccountId: number | null
  fetchData: () => Promise<void>
  refreshTokens: () => Promise<void>
  setOrdinals: (ordinals: Ordinal[]) => void
  getOrdinals: () => Ordinal[]
  sendTokenAction: (
    wallet: WalletKeys,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ) => Promise<Result<{ txid: string }, string>>
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
  sendTokenAction
}: UseWalletSendOptions): UseWalletSendReturn {
  const handleSend = useCallback(async (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    const derivedMap = new Map<string, string>() // address → WIF
    try {
      const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

      // Build a map of derived address → WIF for correct per-UTXO signing
      const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
      const identityWif = await getWifForOperation('identity', 'sendBSV-deriveChildKey', wallet)
      for (const d of derivedAddrs) {
        if (d.senderPubkey && d.invoiceNumber) {
          // Re-derive the child private key from (identityKey + senderPubkey + invoiceNumber)
          // so we never need the WIF stored in the database
          try {
            const childKey = deriveChildPrivateKey(
              PrivateKey.fromWif(identityWif),
              PublicKey.fromString(d.senderPubkey),
              d.invoiceNumber
            )
            derivedMap.set(d.address, childKey.toWif())
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

      const walletWif = await getWifForOperation('wallet', 'sendBSV', wallet)

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

      const sendResult = await sendBSVMultiKey(walletWif, address, amountSats, deduplicatedUtxos, activeAccountId ?? undefined)
      if (!sendResult.ok) {
        return err(sendResult.error.message)
      }
      const { txid } = sendResult.value
      await fetchData()
      audit.transactionSent(txid, amountSats, activeAccountId ?? undefined)
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Send failed')
    } finally {
      derivedMap.clear()
    }
  }, [wallet, fetchData, activeAccountId])


  const handleSendMulti = useCallback(async (recipients: RecipientOutput[], selectedUtxos?: DatabaseUTXO[]): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    const derivedMap = new Map<string, string>() // address → WIF
    try {
      const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

      const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
      const identityWif = await getWifForOperation('identity', 'sendBSVMulti-deriveChildKey', wallet)
      for (const d of derivedAddrs) {
        if (d.senderPubkey && d.invoiceNumber) {
          try {
            const childKey = deriveChildPrivateKey(
              PrivateKey.fromWif(identityWif),
              PublicKey.fromString(d.senderPubkey),
              d.invoiceNumber
            )
            derivedMap.set(d.address, childKey.toWif())
          } catch (e) {
            walletLogger.warn('Failed to re-derive child key for derived address', {
              address: d.address,
              error: e instanceof Error ? e.message : String(e)
            })
          }
        } else if (d.privateKeyWif) {
          derivedMap.set(d.address, d.privateKeyWif)
        }
      }

      const walletWif = await getWifForOperation('wallet', 'sendBSVMulti', wallet)

      const extendedUtxos = spendableUtxos.map(u => {
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

      if (!selectedUtxos) {
        for (const derived of derivedAddrs) {
          const derivedWif = derivedMap.get(derived.address)
          if (derivedWif) {
            try {
              const derivedUtxos = await getUTXOs(derived.address)
              for (const u of derivedUtxos) {
                extendedUtxos.push({ ...u, wif: derivedWif, address: derived.address })
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

      const seen = new Set<string>()
      const deduplicatedUtxos = extendedUtxos.filter(u => {
        const key = `${u.txid}:${u.vout}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const totalSent = recipients.reduce((sum, r) => sum + r.satoshis, 0)
      const sendResult = await sendBSVMultiOutput(walletWif, recipients, deduplicatedUtxos, activeAccountId ?? undefined)
      if (!sendResult.ok) {
        return err(sendResult.error.message)
      }
      const { txid } = sendResult.value
      await fetchData()
      audit.transactionSent(txid, totalSent, activeAccountId ?? undefined)
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Multi-recipient send failed')
    } finally {
      derivedMap.clear()
    }
  }, [wallet, fetchData, activeAccountId])

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

      const ordWif = await getWifForOperation('ordinals', 'transferOrdinal', wallet)
      const fundingWif = await getWifForOperation('wallet', 'transferOrdinal', wallet)

      const txid = await transferOrdinal(
        ordWif,
        ordinalUtxo,
        toAddress,
        fundingWif,
        fundingUtxos
      )

      // Optimistically remove the transferred ordinal from UI state immediately
      // so the count drops right away without waiting for the next full sync.
      setOrdinals(getOrdinals().filter(o => !(o.txid === ordinal.txid && o.vout === ordinal.vout)))

      await fetchData()
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Transfer failed')
    }
  }, [wallet, fetchData, setOrdinals, getOrdinals])

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

      const ordWif = await getWifForOperation('ordinals', 'listOrdinal', wallet)
      const paymentWif = await getWifForOperation('wallet', 'listOrdinal', wallet)

      const txid = await listOrdinal(
        ordWif,
        ordinalUtxo,
        paymentWif,
        fundingUtxos,
        wallet.walletAddress,
        wallet.ordAddress,
        priceSats
      )

      await fetchData()
      return ok({ txid })
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
