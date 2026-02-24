/**
 * Token Service barrel re-export
 *
 * Re-exports all token functionality so existing imports like
 * `from '../services/tokens'` continue to work unchanged.
 */

// --- Types ---

// Token metadata type
export interface Token {
  id?: number
  ticker: string
  protocol: 'bsv20' | 'bsv21'
  contractTxid?: string
  name?: string
  decimals: number
  totalSupply?: string
  iconUrl?: string
  verified: boolean
  createdAt: number
}

// Token balance type
export interface TokenBalance {
  token: Token
  confirmed: bigint
  pending: bigint
  listed: bigint
  total: bigint
}

// --- Fetching ---
export {
  setTokenNetwork,
  fetchTokenBalances,
  fetchTokenDetails,
  fetchBsv21Details,
  fetchTokenUtxos,
  getTokenUtxosForSend
} from './fetching'

export type { TokenUTXO } from './fetching'

// --- State ---
export {
  ensureTokensTables,
  upsertToken,
  getTokenByTicker,
  getTokenById,
  getAllTokens,
  updateTokenBalance,
  getTokenBalancesFromDb,
  recordTokenTransfer,
  getTokenTransfers,
  formatTokenAmount,
  parseTokenAmount,
  toggleFavoriteToken,
  getFavoriteTokens,
  syncTokenBalances
} from './state'

// --- Transfers ---
export {
  transferToken,
  sendToken
} from './transfers'
