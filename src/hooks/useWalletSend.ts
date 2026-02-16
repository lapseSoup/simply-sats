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
import { ok, err, type WalletResult } from '../domain/types'

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
  handleSend: (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]) => Promise<WalletResult>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<WalletResult>
  handleListOrdinal: (ordinal: Ordinal, priceSats: number) => Promise<WalletResult>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<WalletResult>
}

export function useWalletSend({
  wallet,
  activeAccountId,
  fetchData,
  refreshTokens,
  sendTokenAction
}: UseWalletSendOptions): UseWalletSendReturn {
  const handleSend = useCallback(async (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]): Promise<WalletResult> => {
    if (!wallet) return err('No wallet loaded')

    try {
      const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

      // Build a map of derived address → WIF for correct per-UTXO signing
      const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
      const derivedMap = new Map<string, string>() // address → WIF
      for (const d of derivedAddrs) {
        if (d.privateKeyWif) {
          derivedMap.set(d.address, d.privateKeyWif)
        }
      }

      const extendedUtxos: ExtendedUTXO[] = spendableUtxos.map(u => {
        // Look up the correct WIF: derived address WIF, or fall back to wallet WIF
        const utxoAddress = u.address || wallet.walletAddress
        const wif = derivedMap.get(utxoAddress) || wallet.walletWif
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
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Send failed')
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
      return ok({ txid })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Transfer failed')
    }
  }, [wallet, fetchData])

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

    if (result.success && result.txid) {
      await fetchData()
      await refreshTokens()
      return ok({ txid: result.txid })
    }

    return err(result.error || 'Token transfer failed')
  }, [wallet, fetchData, refreshTokens, sendTokenAction])

  return {
    handleSend,
    handleTransferOrdinal,
    handleListOrdinal,
    handleSendToken
  }
}
