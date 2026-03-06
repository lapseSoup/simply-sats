import { useCallback } from 'react'
import {
  getAddressBook,
  getRecentAddresses,
  saveAddress,
  type AddressBookEntry
} from '../infrastructure/database'

export function useAddressBook(accountId?: number | null) {
  const loadAddresses = useCallback(async (recentLimit = 5): Promise<{
    recent: AddressBookEntry[]
    saved: AddressBookEntry[]
  }> => {
    if (!accountId) {
      return { recent: [], saved: [] }
    }

    const [recentResult, savedResult] = await Promise.all([
      getRecentAddresses(accountId, recentLimit),
      getAddressBook(accountId),
    ])

    return {
      recent: recentResult.ok ? recentResult.value : [],
      saved: savedResult.ok ? savedResult.value : []
    }
  }, [accountId])

  const saveRecentAddress = useCallback(async (address: string, label = '') => {
    if (!accountId) return null
    return saveAddress(address, label, accountId)
  }, [accountId])

  return {
    loadAddresses,
    saveRecentAddress
  }
}
