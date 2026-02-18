/**
 * Transaction Labels Hook
 *
 * Provides transaction label CRUD operations with optimistic updates,
 * routing through the database service layer.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  getTransactionLabels,
  updateTransactionLabels,
  getTopLabels,
  getTransactionsByLabel
} from '../infrastructure/database'
import { uiLogger } from '../services/logger'

interface UseTransactionLabelsOptions {
  txid: string
  accountId?: number
  suggestedCount?: number
}

interface UseTransactionLabelsResult {
  labels: string[]
  suggestedLabels: string[]
  loading: boolean
  addLabel: (label: string) => Promise<boolean>
  removeLabel: (label: string) => Promise<boolean>
}

/**
 * Hook for managing transaction labels with optimistic updates.
 */
export function useTransactionLabels(options: UseTransactionLabelsOptions): UseTransactionLabelsResult {
  const { txid, accountId, suggestedCount = 3 } = options
  const [labels, setLabels] = useState<string[]>([])
  const [suggestedLabels, setSuggestedLabels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const accId = accountId ?? 1
        const [labelsResult, topLabelsResult] = await Promise.all([
          getTransactionLabels(txid, accId),
          getTopLabels(suggestedCount, accId)
        ])
        setLabels(labelsResult.ok ? labelsResult.value : [])
        if (!labelsResult.ok) {
          uiLogger.warn('Failed to load transaction labels', { txid, error: labelsResult.error.message })
        }
        setSuggestedLabels(topLabelsResult.ok ? topLabelsResult.value : [])
        if (!topLabelsResult.ok) {
          uiLogger.warn('Failed to load top labels', { txid, error: topLabelsResult.error.message })
        }
      } catch (e) {
        uiLogger.warn('Failed to load transaction labels', { txid, error: String(e) })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [txid, accountId, suggestedCount])

  const addLabel = useCallback(async (label: string): Promise<boolean> => {
    const trimmed = label.trim().toLowerCase()
    if (!trimmed || labels.includes(trimmed)) return false

    const newLabels = [...labels, trimmed]
    setLabels(newLabels) // Optimistic update

    try {
      const result = await updateTransactionLabels(txid, newLabels, accountId)
      if (!result.ok) {
        uiLogger.error('Failed to add label', result.error)
        setLabels(labels) // Revert on error
        return false
      }
      return true
    } catch (e) {
      uiLogger.error('Failed to add label', e)
      setLabels(labels) // Revert on error
      return false
    }
  }, [txid, accountId, labels])

  const removeLabel = useCallback(async (label: string): Promise<boolean> => {
    const newLabels = labels.filter(l => l !== label)
    setLabels(newLabels) // Optimistic update

    try {
      const result = await updateTransactionLabels(txid, newLabels, accountId)
      if (!result.ok) {
        uiLogger.error('Failed to remove label', result.error)
        setLabels(labels) // Revert on error
        return false
      }
      return true
    } catch (e) {
      uiLogger.error('Failed to remove label', e)
      setLabels(labels) // Revert on error
      return false
    }
  }, [txid, accountId, labels])

  return { labels, suggestedLabels, loading, addLabel, removeLabel }
}

interface UseLabeledTransactionsOptions {
  labelNames: string[]
  accountId?: number
  /** Re-fetch when this value changes */
  refreshKey?: unknown
}

interface UseLabeledTransactionsResult {
  /** Map of label name → Set of txids */
  txidsByLabel: Map<string, Set<string>>
  loading: boolean
}

/**
 * Hook for fetching transactions by multiple labels in parallel.
 * Used by ActivityTab to classify transactions as lock/unlock/etc.
 */
export function useLabeledTransactions(options: UseLabeledTransactionsOptions): UseLabeledTransactionsResult {
  const { labelNames, accountId, refreshKey } = options
  const [txidsByLabel, setTxidsByLabel] = useState<Map<string, Set<string>>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const results = await Promise.all(
          labelNames.map(async (label) => {
            const txsResult = await getTransactionsByLabel(label, accountId)
            const txs = txsResult.ok ? txsResult.value : []
            if (!txsResult.ok) {
              uiLogger.warn('Failed to fetch transactions by label', { label, error: txsResult.error.message })
            }
            return [label, new Set(txs.map(tx => tx.txid))] as const
          })
        )
        setTxidsByLabel(new Map(results))
      } catch (e) {
        uiLogger.warn('Failed to fetch labeled transactions', { error: String(e) })
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, refreshKey, ...labelNames])

  return { txidsByLabel, loading }
}
