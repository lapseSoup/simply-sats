/**
 * WalletStateContext — Read-only wallet state.
 *
 * This context holds all state properties that were previously part of the
 * monolithic WalletContext. The actual Provider wrapping lives in
 * WalletContext.tsx; this file only defines the interface, React context
 * object, and the consumer hook.
 */

import { createContext, useContext } from 'react'
import type { WalletKeys, LockedUTXO, Ordinal, UTXO } from '../services/wallet'
import type { NetworkInfo } from './NetworkContext'
import type { TxHistoryItem, BasketBalances, OrdinalContentEntry } from './SyncContext'
import type { Contact } from '../infrastructure/database'
import type { Account } from '../services/accounts'
import type { TokenBalance } from '../services/tokens'

export interface WalletStateContextType {
  // Wallet state
  wallet: WalletKeys | null
  balance: number
  ordBalance: number
  usdPrice: number
  utxos: UTXO[]
  ordinals: Ordinal[]
  /** Snapshot of ordinal content cache. Updates when cacheVersion bumps (once per batch). */
  contentCacheSnapshot: Map<string, OrdinalContentEntry>
  locks: LockedUTXO[]
  txHistory: TxHistoryItem[]
  basketBalances: BasketBalances
  contacts: Contact[]

  // Multi-account state (read-only)
  accounts: Account[]
  activeAccount: Account | null
  activeAccountId: number | null

  // Token state (read-only)
  tokenBalances: TokenBalance[]
  tokensSyncing: boolean

  // Lock state (read-only)
  isLocked: boolean
  autoLockMinutes: number

  // Network state
  networkInfo: NetworkInfo | null
  syncing: boolean
  syncError: string | null
  loading: boolean

  // Settings (read-only)
  feeRateKB: number

  // Session
  sessionPassword: string | null
}

export const WalletStateContext = createContext<WalletStateContextType | null>(null)

export function useWalletState(): WalletStateContextType {
  const context = useContext(WalletStateContext)
  if (!context) {
    throw new Error('useWalletState must be used within a WalletProvider')
  }
  return context
}
