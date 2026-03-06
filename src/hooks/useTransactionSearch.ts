import { useCallback } from 'react'
import type { TransactionRecord, TxHistoryItem } from '../domain/types'
import {
  getAllLabels,
  searchTransactions as searchStoredTransactions,
  searchTransactionsByLabels,
} from '../infrastructure/database'

function toSearchResult(tx: TransactionRecord): TxHistoryItem {
  return {
    tx_hash: tx.txid,
    amount: tx.amount,
    height: tx.blockHeight ?? 0,
    description: tx.description,
    createdAt: tx.createdAt,
  }
}

export function useTransactionSearch(accountId?: number | null) {
  const loadLabels = useCallback(async (): Promise<string[]> => {
    const result = await getAllLabels(accountId ?? undefined)
    return result.ok ? result.value : []
  }, [accountId])

  const searchTransactions = useCallback(async (
    freeText: string,
    labels: string[]
  ): Promise<TxHistoryItem[]> => {
    const result = labels.length > 0
      ? await searchTransactionsByLabels(
        labels,
        freeText.trim() || undefined,
        accountId ?? undefined
      )
      : await searchStoredTransactions(freeText.trim(), accountId ?? undefined)

    return result.ok ? result.value.map(toSearchResult) : []
  }, [accountId])

  return {
    loadLabels,
    searchTransactions,
  }
}
