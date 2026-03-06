import { useCallback } from 'react'
import type { TransactionRecord } from '../domain/types'
import { getTransactionByTxid } from '../infrastructure/database'
import { getWocClient } from '../infrastructure/api/wocClient'
import { resolveInscriptionOrigin } from '../services/wallet/ordinalContent'
import { btcToSatoshis } from '../utils/satoshiConversion'

export function useTransactionDetails(accountId?: number | null) {
  const loadTransactionRecord = useCallback(async (txid: string): Promise<TransactionRecord | null> => {
    if (accountId == null) return null

    const result = await getTransactionByTxid(txid, accountId)
    return result.ok ? result.value : null
  }, [accountId])

  const computeFeeFromBlockchain = useCallback(async (txid: string): Promise<number | null> => {
    try {
      const wocClient = getWocClient()
      const tx = await wocClient.getTransactionDetails(txid)
      if (!tx) return null

      const totalOut = tx.vout.reduce((sum, output) => sum + btcToSatoshis(output.value), 0)

      let totalIn = 0
      for (const vin of tx.vin) {
        if (vin.coinbase) return null
        if (vin.txid && vin.vout !== undefined) {
          const prevTx = await wocClient.getTransactionDetails(vin.txid)
          if (prevTx?.vout?.[vin.vout]) {
            totalIn += btcToSatoshis(prevTx.vout[vin.vout]!.value)
          }
        }
      }

      const fee = totalIn - totalOut
      return fee > 0 ? fee : null
    } catch {
      return null
    }
  }, [])

  const resolveOrdinalOrigin = useCallback(async (outpoint: string): Promise<string | null> => {
    return resolveInscriptionOrigin(outpoint)
  }, [])

  return {
    loadTransactionRecord,
    computeFeeFromBlockchain,
    resolveOrdinalOrigin,
  }
}
