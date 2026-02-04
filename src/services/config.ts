/**
 * Configuration Service for Simply Sats
 *
 * Centralizes all configurable values including API endpoints, timeouts,
 * and retry settings. This enables easy switching between environments
 * and provides a single source of truth for configuration.
 */

// Network type for environment switching
export type NetworkType = 'mainnet' | 'testnet'

// Get current network from localStorage or default to mainnet
function getCurrentNetwork(): NetworkType {
  const stored = localStorage.getItem('simply_sats_network')
  if (stored === 'testnet') return 'testnet'
  return 'mainnet'
}

/**
 * API Endpoints Configuration
 */
export const API_ENDPOINTS = {
  // WhatsOnChain - Primary blockchain data provider
  whatsonchain: {
    mainnet: 'https://api.whatsonchain.com/v1/bsv/main',
    testnet: 'https://api.whatsonchain.com/v1/bsv/test'
  },

  // GorillaPool - Token and ordinals data
  gorillapool: {
    mainnet: 'https://ordinals.gorillapool.io/api',
    testnet: 'https://testnet.ordinals.gorillapool.io/api'
  },

  // ARC - Transaction broadcasting
  arc: {
    mainnet: 'https://arc.taal.com/v1',
    testnet: 'https://arc-test.taal.com/v1'
  },

  // MessageBox - Payment notifications (BRC-29)
  messagebox: {
    mainnet: 'https://messagebox.babbage.systems',
    testnet: 'https://messagebox.babbage.systems' // Same for both
  },

  // Overlay Network nodes
  overlay: {
    mainnet: [
      'https://overlay.gorillapool.io',
      'https://overlay.taal.com'
    ],
    testnet: [
      'https://overlay-testnet.gorillapool.io'
    ]
  }
} as const

/**
 * Get API endpoint for current network
 */
export function getApiEndpoint(service: keyof typeof API_ENDPOINTS): string | string[] {
  const network = getCurrentNetwork()
  const endpoints = API_ENDPOINTS[service]
  return endpoints[network]
}

/**
 * Get WhatsOnChain API base URL
 */
export function getWocApiUrl(): string {
  return getApiEndpoint('whatsonchain') as string
}

/**
 * Get GorillaPool API base URL
 */
export function getGpApiUrl(): string {
  return getApiEndpoint('gorillapool') as string
}

/**
 * Get ARC API base URL
 */
export function getArcApiUrl(): string {
  return getApiEndpoint('arc') as string
}

/**
 * Get MessageBox API base URL
 */
export function getMessageBoxUrl(): string {
  return getApiEndpoint('messagebox') as string
}

/**
 * Get overlay network nodes
 */
export function getOverlayNodes(): string[] {
  return getApiEndpoint('overlay') as string[]
}

/**
 * Request Timeout Configuration (in milliseconds)
 */
export const TIMEOUTS = {
  // Default timeout for most API calls
  default: 30000, // 30 seconds

  // Longer timeout for blockchain sync operations
  sync: 60000, // 60 seconds

  // Short timeout for quick health checks
  healthCheck: 5000, // 5 seconds

  // Timeout for transaction broadcasting
  broadcast: 45000, // 45 seconds

  // Timeout for price/exchange rate fetches
  price: 10000, // 10 seconds

  // Timeout for overlay network operations
  overlay: 15000 // 15 seconds
} as const

/**
 * Retry Configuration
 */
export const RETRY_CONFIG = {
  // Maximum number of retry attempts
  maxRetries: 3,

  // Initial delay between retries (milliseconds)
  initialDelay: 1000,

  // Maximum delay between retries (milliseconds)
  maxDelay: 10000,

  // Multiplier for exponential backoff
  backoffMultiplier: 2,

  // HTTP status codes that should trigger a retry
  retryableStatuses: [408, 429, 500, 502, 503, 504],

  // Whether to retry on network errors
  retryOnNetworkError: true
} as const

/**
 * Rate Limiting Configuration
 */
export const RATE_LIMITS = {
  // Delay between sequential address sync requests (ms)
  addressSyncDelay: 1000,

  // Maximum concurrent API requests
  maxConcurrentRequests: 3,

  // Delay between token balance fetches (ms)
  tokenFetchDelay: 500
} as const

/**
 * Database Configuration
 */
export const DATABASE_CONFIG = {
  // Database filename
  filename: 'simplysats.db',

  // Connection string
  connectionString: 'sqlite:simplysats.db'
} as const

/**
 * BRC-100 HTTP Server Configuration
 */
export const BRC100_SERVER_CONFIG = {
  // Port for the HTTP server
  port: 3322,

  // Request timeout
  requestTimeout: 120000 // 2 minutes
} as const

/**
 * Encryption Configuration
 */
export const ENCRYPTION_CONFIG = {
  // PBKDF2 iterations (OWASP recommended minimum)
  pbkdf2Iterations: 100000,

  // Salt length in bytes
  saltLength: 16,

  // IV length in bytes for AES-GCM
  ivLength: 12,

  // Key length for AES
  keyLength: 256
} as const

/**
 * Set the current network
 */
export function setNetwork(network: NetworkType): void {
  localStorage.setItem('simply_sats_network', network)
}

/**
 * Get the current network
 */
export function getNetwork(): NetworkType {
  return getCurrentNetwork()
}
