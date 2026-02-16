/**
 * Hook for wallet send/transfer operations: send BSV, transfer ordinal, list ordinal, send token.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useCallback } from 'react'
import type { WalletKeys, UTXO, Ordinal, ExtendedUTXO } from '../services/wallet'
import type { UTXO as DatabaseUTXO } from '../services/database'
import {
  getUTXOs,
  sendBSVMultiKey,
  transferOrdinal
} from '../services/wallet'
import { listOrdinal } from '../services/wallet/marketplace'
import {
  getDerivedAddresses
} from '../services/database'
import {
  getSpendableUtxosFromDatabase
} from '../services/sync'
import { audit } from '../services/auditLog'

interface UseWalletSendOptions {
  wallet: WalletKeys | null
  activeAccountId: number | null
  fetchData: () => Promise<void>
  refreshTokens: () => Promise<void>
  sendTokenAction: (
    wallet: WalletKeys,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ) => Promise<{ success: boolean; txid?: string; error?: string }>
}

interface UseWalletSendReturn {
  handleSend: (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleListOrdinal: (ordinal: Ordinal, priceSats: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>
}

export function useWalletSend({
  wallet,
  activeAccountId,
  fetchData,
  refreshTokens,
  sendTokenAction
}: UseWalletSendOptions): UseWalletSendReturn {
  const handleSend = useCallback(async (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

      const extendedUtxos: ExtendedUTXO[] = spendableUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript || '',
        wif: wallet.walletWif,
        address: wallet.walletAddress
      }))

      // Include derived address UTXOs only when NOT in coin control mode
      if (!selectedUtxos) {
        const derivedAddrs = await getDerivedAddresses(activeAccountId || undefined)
        for (const derived of derivedAddrs) {
          if (derived.privateKeyWif) {
            try {
              const derivedUtxos = await getUTXOs(derived.address)
              for (const u of derivedUtxos) {
                extendedUtxos.push({
                  ...u,
                  wif: derived.privateKeyWif,
                  address: derived.address
                })
              }
            } catch (_e) {
              // Skip if can't get UTXOs for this address
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

      const txid = await sendBSVMultiKey(wallet.walletWif, address, amountSats, deduplicatedUtxos, activeAccountId ?? undefined)
      await fetchData()
      audit.transactionSent(txid, amountSats, activeAccountId ?? undefined)
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  }, [wallet, fetchData, activeAccountId])

  const handleTransferOrdinal = useCallback(async (
    ordinal: Ordinal,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for transfer fee' }
      }

      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: ''
      }

      const txid = await transferOrdinal(
        wallet.ordWif,
        ordinalUtxo,
        toAddress,
        wallet.walletWif,
        fundingUtxos
      )

      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' }
    }
  }, [wallet, fetchData])

  const handleListOrdinal = useCallback(async (
    ordinal: Ordinal,
    priceSats: number
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for listing fee' }
      }

      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: ''
      }

      const txid = await listOrdinal(
        wallet.ordWif,
        ordinalUtxo,
        wallet.walletWif,
        fundingUtxos,
        wallet.walletAddress,
        wallet.ordAddress,
        priceSats
      )

      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Listing failed' }
    }
  }, [wallet, fetchData])

  const handleSendToken = useCallback(async (
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    const result = await sendTokenAction(wallet, ticker, protocol, amount, toAddress)

    if (result.success) {
      await fetchData()
      await refreshTokens()
    }

    return result
  }, [wallet, fetchData, refreshTokens, sendTokenAction])

  return {
    handleSend,
    handleTransferOrdinal,
    handleListOrdinal,
    handleSendToken
  }
}
