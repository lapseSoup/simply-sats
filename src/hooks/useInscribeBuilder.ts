import { useCallback } from 'react'
import { buildInscriptionTx } from '../services/wallet/inscribe'

type BuildInscriptionParams = Parameters<typeof buildInscriptionTx>[0]

export function useInscribeBuilder() {
  const inscribe = useCallback(async (params: BuildInscriptionParams) => {
    return buildInscriptionTx(params)
  }, [])

  return {
    inscribe
  }
}
