import { useCallback, useRef, useState } from 'react'
import type { Account } from '../domain/accounts'
import { getBalanceFromDB } from '../infrastructure/database'

/**
 * Lazy account-balance loader for account switcher previews.
 * Kept outside the component so the UI layer stays free of direct DB imports.
 */
export function useAccountBalances() {
  const [accountBalances, setAccountBalances] = useState<Record<number, number>>({})
  const fetchingRef = useRef(false)

  const fetchAccountBalances = useCallback(async (accounts: Account[]) => {
    if (accounts.length === 0 || fetchingRef.current) return

    fetchingRef.current = true
    try {
      const balances: Record<number, number> = {}
      for (const account of accounts) {
        if (account.id == null) continue
        try {
          const defaultResult = await getBalanceFromDB('default', account.id)
          const derivedResult = await getBalanceFromDB('derived', account.id)
          const defaultBal = defaultResult.ok ? defaultResult.value : 0
          const derivedBal = derivedResult.ok ? derivedResult.value : 0
          balances[account.id] = defaultBal + derivedBal
        } catch {
          balances[account.id] = 0
        }
      }
      setAccountBalances(balances)
    } finally {
      fetchingRef.current = false
    }
  }, [])

  return { accountBalances, fetchAccountBalances }
}
