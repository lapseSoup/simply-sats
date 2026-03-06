import { useCallback } from 'react'
import type { UTXO } from '../domain/types'
import { consolidateUtxos } from '../services/wallet'

export function useUtxoConsolidation() {
  const consolidate = useCallback(async (
    utxos: UTXO[],
    accountId?: number
  ) => {
    return consolidateUtxos(utxos, accountId)
  }, [])

  return {
    consolidate,
  }
}
