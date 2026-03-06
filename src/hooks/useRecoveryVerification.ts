import { useCallback } from 'react'
import { verifyMnemonicMatchesWallet } from '../services/wallet'

export function useRecoveryVerification(expectedAddress: string) {
  const verifyRecoveryPhrase = useCallback(async (mnemonic: string) => {
    return verifyMnemonicMatchesWallet(mnemonic, expectedAddress)
  }, [expectedAddress])

  return {
    verifyRecoveryPhrase
  }
}
