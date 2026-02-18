/**
 * Address validation hook for modal components (Q-2)
 *
 * Centralizes BSV address validation logic that was duplicated across
 * SendModal and OrdinalTransferModal.
 */

import { useState, useCallback } from 'react'
import { isValidBSVAddress } from '../domain/wallet/validation'

export interface UseAddressValidationReturn {
  addressError: string
  validateAddress: (address: string) => boolean
  clearAddressError: () => void
}

/**
 * Hook for BSV address validation with error state management.
 *
 * @returns addressError - Current error message (empty string if valid)
 * @returns validateAddress - Validates an address, sets error state, returns true if valid
 * @returns clearAddressError - Clears the error state
 */
export function useAddressValidation(): UseAddressValidationReturn {
  const [addressError, setAddressError] = useState('')

  const validateAddress = useCallback((address: string): boolean => {
    if (!address) {
      setAddressError('')
      return false
    }
    if (!isValidBSVAddress(address)) {
      setAddressError('Invalid BSV address')
      return false
    }
    setAddressError('')
    return true
  }, [])

  const clearAddressError = useCallback(() => {
    setAddressError('')
  }, [])

  return { addressError, validateAddress, clearAddressError }
}
