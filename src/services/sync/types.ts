/**
 * Sync module shared types
 *
 * Extracted from barrel index to avoid circular imports
 * (addressSync and orchestration both need these types but are re-exported by index).
 */

// Address info for syncing
export interface AddressInfo {
  address: string
  basket: string
  wif?: string // Optional - for signing
  accountId?: number // Account ID for scoping data
}

// Sync result
export interface SyncResult {
  address: string
  basket: string
  newUtxos: number
  spentUtxos: number
  totalBalance: number
}
