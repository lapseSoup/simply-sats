/**
 * Application Configuration
 *
 * Centralized configuration for all application constants and settings.
 * This replaces magic numbers scattered throughout the codebase.
 *
 * @module config
 */

// ============================================
// Security Configuration
// ============================================

export const SECURITY = {
  /** Minimum password length (NIST SP 800-63B recommends 8+, we use 14 for extra security) */
  MIN_PASSWORD_LENGTH: 14,

  /** Recommended password length for strong passwords */
  RECOMMENDED_PASSWORD_LENGTH: 16,

  /** PBKDF2 iterations for key derivation (OWASP 2024 recommendation: 100,000+) */
  PBKDF2_ITERATIONS: 100000,

  /** Auto-lock timeout in minutes (default) */
  DEFAULT_AUTO_LOCK_MINUTES: 10,

  /** Maximum auto-lock timeout in minutes */
  MAX_AUTO_LOCK_MINUTES: 60,

  /** Rate limiting: max unlock attempts before lockout */
  MAX_UNLOCK_ATTEMPTS: 5,

  /** Rate limiting: base lockout duration in milliseconds */
  BASE_LOCKOUT_MS: 1000,

  /** Rate limiting: maximum lockout duration in milliseconds */
  MAX_LOCKOUT_MS: 300000, // 5 minutes

  /** CSRF nonce expiry in seconds */
  NONCE_EXPIRY_SECS: 300, // 5 minutes

  /** Maximum number of used nonces to track (memory management) */
  MAX_USED_NONCES: 1000,
} as const

// ============================================
// Network Configuration
// ============================================

export const NETWORK = {
  /** Network type */
  TYPE: 'mainnet' as const,

  /** HTTP server port for BRC-100 */
  BRC100_PORT: 3322,

  /** Rate limit for HTTP requests per minute */
  HTTP_RATE_LIMIT_PER_MINUTE: 60,

  /** HTTP request timeout in milliseconds */
  HTTP_TIMEOUT_MS: 30000,

  /** Maximum retries for failed HTTP requests */
  HTTP_MAX_RETRIES: 3,

  /** USD price refresh interval in milliseconds */
  USD_PRICE_REFRESH_INTERVAL_MS: 60000, // 1 minute

  /** Block height refresh interval in milliseconds */
  BLOCK_HEIGHT_REFRESH_INTERVAL_MS: 60000, // 1 minute
} as const

// ============================================
// Transaction Configuration
// ============================================

export const TRANSACTION = {
  /** Default fee rate in satoshis per kilobyte */
  DEFAULT_FEE_RATE_PER_KB: 50,

  /** Minimum fee rate in satoshis per kilobyte */
  MIN_FEE_RATE_PER_KB: 1,

  /** Maximum fee rate in satoshis per kilobyte (safety limit) */
  MAX_FEE_RATE_PER_KB: 10000,

  /** Dust threshold in satoshis */
  DUST_THRESHOLD: 546,

  /** High-value transaction threshold in satoshis (for extra confirmation) */
  HIGH_VALUE_THRESHOLD: 100000,

  /** Medium-value transaction threshold in satoshis */
  MEDIUM_VALUE_THRESHOLD: 10000,

  /** Average transaction input size in bytes */
  AVG_INPUT_SIZE_BYTES: 148,

  /** Average transaction output size in bytes */
  AVG_OUTPUT_SIZE_BYTES: 34,

  /** Base transaction size in bytes (version + locktime) */
  BASE_TX_SIZE_BYTES: 10,
} as const

// ============================================
// Wallet Configuration
// ============================================

export const WALLET = {
  /** Number of recent transactions to display */
  RECENT_TX_LIMIT: 30,

  /** BIP44 derivation gap limit */
  BIP44_GAP_LIMIT: 20,

  /** Maximum contacts to store */
  MAX_CONTACTS: 1000,

  /** Maximum derived addresses */
  MAX_DERIVED_ADDRESSES: 100,

  /** UTXO count threshold for suggesting consolidation */
  CONSOLIDATION_THRESHOLD: 50,
} as const

// ============================================
// UI Configuration
// ============================================

export const UI = {
  /** Toast display duration in milliseconds */
  TOAST_DURATION_MS: 3000,

  /** Animation duration in milliseconds */
  ANIMATION_DURATION_MS: 200,

  /** Debounce delay for search inputs in milliseconds */
  SEARCH_DEBOUNCE_MS: 300,

  /** Maximum log entries to store in memory */
  MAX_LOG_ENTRIES: 1000,
} as const

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEYS = {
  PREFIX: 'simply_sats_',

  // Sensitive (encrypted in secure storage)
  TRUSTED_ORIGINS: 'trusted_origins',
  CONNECTED_APPS: 'connected_apps',
  RATE_LIMIT: 'rate_limit',

  // Non-sensitive (plain localStorage)
  CACHED_BALANCE: 'cached_balance',
  CACHED_ORD_BALANCE: 'cached_ord_balance',
  AUTO_LOCK_MINUTES: 'auto_lock_minutes',
  DISPLAY_UNIT: 'display_unit',
  FEE_RATE: 'fee_rate',
} as const

// ============================================
// API Endpoints
// ============================================

export const API = {
  WHATSONCHAIN: {
    BASE_URL: 'https://api.whatsonchain.com/v1/bsv/main',
    CHAIN_INFO: '/chain/info',
    ADDRESS_BALANCE: '/address/{address}/balance',
    ADDRESS_UTXOS: '/address/{address}/unspent',
    ADDRESS_HISTORY: '/address/{address}/history',
    TX_RAW: '/tx/{txid}/hex',
  },

  GORILLAPOOL: {
    BASE_URL: 'https://ordinals.gorillapool.io/api',
    FEE_RATE: '/fee',
    BROADCAST: '/tx',
    TOKEN_BALANCE: '/bsv20/{address}/balance',
  },
} as const

// ============================================
// Feature Flags
// ============================================

export const FEATURES = {
  /** Enable BRC-100 HTTP server */
  BRC100_SERVER: true,

  /** Enable token support (BSV-20/21) */
  TOKENS: true,

  /** Enable ordinals support */
  ORDINALS: true,

  /** Enable time-locked UTXOs */
  LOCKS: false,

  /** Enable multi-account support */
  MULTI_ACCOUNT: true,

  /** Enable audit logging */
  AUDIT_LOG: true,

  /** Enable backup verification flow */
  BACKUP_VERIFICATION: true,

  /** Enable auto UTXO consolidation prompting */
  AUTO_CONSOLIDATION: true,
} as const

// Type exports for use in other modules
export type SecurityConfig = typeof SECURITY
export type NetworkConfig = typeof NETWORK
export type TransactionConfig = typeof TRANSACTION
export type WalletConfig = typeof WALLET
export type UIConfig = typeof UI
export type StorageKeys = typeof STORAGE_KEYS
export type ApiConfig = typeof API
export type FeatureFlags = typeof FEATURES
