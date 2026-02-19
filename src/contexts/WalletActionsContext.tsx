/**
 * WalletActionsContext — Write operations / action functions.
 *
 * This context holds all action callbacks that were previously part of the
 * monolithic WalletContext. The actual Provider wrapping lives in
 * WalletContext.tsx; this file only defines the interface, React context
 * object, and the consumer hook.
 */

import { createContext, useContext } from 'react'
import type { WalletKeys, LockedUTXO, Ordinal } from '../services/wallet'
import type { UTXO as DatabaseUTXO } from '../infrastructure/database'
import type { WalletResult } from '../domain/types'
import type { RecipientOutput } from '../domain/transaction/builder'

export interface WalletActionsContextType {
  setWallet: (wallet: WalletKeys | null) => void
  setSessionPassword: (password: string | null) => void

  // Account actions
  switchAccount: (accountId: number) => Promise<boolean>
  createNewAccount: (name: string) => Promise<boolean>
  importAccount: (name: string, mnemonic: string) => Promise<boolean>
  deleteAccount: (accountId: number) => Promise<boolean>
  renameAccount: (accountId: number, name: string) => Promise<boolean>
  refreshAccounts: () => Promise<void>

  // Token actions
  refreshTokens: () => Promise<void>

  // Lock actions
  lockWallet: () => void
  unlockWallet: (password: string) => Promise<boolean>
  setAutoLockMinutes: (minutes: number) => void

  // Settings
  setFeeRate: (rate: number) => void
  refreshContacts: () => Promise<void>

  // Wallet lifecycle
  performSync: (isRestore?: boolean, forceReset?: boolean) => Promise<void>
  /** Load all data from local DB only (no API calls). Used for instant account switching. */
  fetchDataFromDB: () => Promise<void>
  fetchData: () => Promise<void>
  handleCreateWallet: (password: string | null, wordCount?: 12 | 24) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string | null) => Promise<boolean>
  handleImportJSON: (json: string, password: string | null) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>

  // Wallet operations
  handleSend: (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]) => Promise<WalletResult>
  handleSendMulti: (recipients: RecipientOutput[], selectedUtxos?: DatabaseUTXO[]) => Promise<WalletResult>
  handleLock: (amountSats: number, blocks: number) => Promise<WalletResult>
  handleUnlock: (lock: LockedUTXO) => Promise<WalletResult>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<WalletResult>
  handleListOrdinal: (ordinal: Ordinal, priceSats: number) => Promise<WalletResult>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<WalletResult>

  // Account discovery (deferred after restore sync)
  consumePendingDiscovery: () => { mnemonic: string; password: string | null; excludeAccountId?: number } | null
  peekPendingDiscovery: () => { mnemonic: string; password: string | null; excludeAccountId?: number } | null
  clearPendingDiscovery: () => void
}

export const WalletActionsContext = createContext<WalletActionsContextType | null>(null)

export function useWalletActions(): WalletActionsContextType {
  const context = useContext(WalletActionsContext)
  if (!context) {
    throw new Error('useWalletActions must be used within a WalletProvider')
  }
  return context
}
