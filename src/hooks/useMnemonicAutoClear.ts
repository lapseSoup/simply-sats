/**
 * Hook that auto-clears the mnemonic from memory after a security timeout.
 *
 * Extracted from App.tsx to reduce the monolith.
 * Uses the MNEMONIC_AUTO_CLEAR_MS constant from config/security.
 */

import { useEffect } from 'react'
import { logger } from '../services/logger'
import { SECURITY } from '../config'

/**
 * Automatically clears the mnemonic from memory after a timeout.
 * Prevents sensitive key material from lingering in React state.
 */
export function useMnemonicAutoClear(
  newMnemonic: string | null,
  setNewMnemonic: (mnemonic: string | null) => void
): void {
  useEffect(() => {
    if (!newMnemonic) return
    const timer = setTimeout(() => {
      setNewMnemonic(null)
      logger.info('Mnemonic auto-cleared from memory after timeout')
    }, SECURITY.MNEMONIC_AUTO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [newMnemonic, setNewMnemonic])
}
