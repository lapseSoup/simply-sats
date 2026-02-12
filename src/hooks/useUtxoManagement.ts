/**
 * UTXO Management Hook
 *
 * Provides UTXO loading, filtering, and freeze toggle operations
 * for components, routing through the database service layer.
 */

import { useState, useCallback, useEffect } from 'react'
import { getAllUTXOs, toggleUtxoFrozen } from '../services/database'
import type { UTXO } from '../services/database'
import { uiLogger } from '../services/logger'

interface UseUtxoManagementOptions {
  accountId?: number
  /** Only load on mount (default: true) */
  autoLoad?: boolean
  /** Filter function applied after loading */
  filter?: (utxo: UTXO) => boolean
}

interface UseUtxoManagementResult {
  utxos: UTXO[]
  loading: boolean
  reload: () => Promise<void>
  toggleFreeze: (txid: string, vout: number, currentlySpendable: boolean) => Promise<void>
}

/**
 * Hook for UTXO listing and management.
 * Routes database access through the service layer instead of direct imports in components.
 */
export function useUtxoManagement(options: UseUtxoManagementOptions = {}): UseUtxoManagementResult {
  const { accountId, autoLoad = true, filter } = options
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const all = await getAllUTXOs(accountId)
      const filtered = filter ? all.filter(filter) : all
      setUtxos(filtered)
    } catch (e) {
      uiLogger.error('Failed to load UTXOs', e)
    } finally {
      setLoading(false)
    }
  }, [accountId, filter])

  const toggleFreeze = useCallback(async (txid: string, vout: number, currentlySpendable: boolean) => {
    try {
      await toggleUtxoFrozen(txid, vout, currentlySpendable, accountId)
      await reload()
    } catch (e) {
      uiLogger.error('Failed to toggle UTXO freeze', e)
    }
  }, [accountId, reload])

  useEffect(() => {
    if (autoLoad) {
      reload()
    }
  }, [autoLoad, reload])

  return { utxos, loading, reload, toggleFreeze }
}
