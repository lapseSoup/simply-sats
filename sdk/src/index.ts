/**
 * Simply Sats SDK
 *
 * Node.js client for interacting with Simply Sats wallet via BRC-100 HTTP-JSON protocol.
 * Designed for AI agents and automated systems that need programmatic BSV wallet access.
 *
 * Simply Sats runs on port 3322 by default.
 */

export interface SimplySatsConfig {
  /** Base URL for Simply Sats HTTP server (default: http://127.0.0.1:3322) */
  baseUrl?: string
  /** Request timeout in ms (default: 120000) */
  timeout?: number
  /** Origin identifier for your app (for trusted origin auto-approval) */
  origin?: string
  /** Session token for authentication (obtained from Simply Sats wallet) */
  sessionToken?: string
  /** API version prefix (default: 'v1'). Set to '' for legacy unversioned routes. */
  apiVersion?: string
}

export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  unlockBlock: number
  publicKeyHex: string
  createdAt: number
}

export interface LockResult {
  txid: string
  unlockBlock: number
  lockedUtxo: LockedUTXO
}

export interface UnlockResult {
  txid: string
  amount: number
}

export interface LockedOutput {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  tags: string[]
  spendable: boolean
  blocksRemaining: number
}

export interface ListLocksResult {
  locks: LockedOutput[]
  currentHeight: number
}

export interface Output {
  outpoint: string
  satoshis: number
  lockingScript: string
  tags: string[]
  spendable: boolean
  customInstructions?: string
}

export interface ListOutputsResult {
  outputs: Output[]
  totalOutputs: number
}

export interface SignatureResult {
  signature: string
  publicKey: string
}

export interface ActionResult {
  txid: string
  rawTx?: string
}

export interface BRC100Error {
  isError: true
  code: number
  message: string
}

/**
 * Simply Sats SDK Client
 *
 * Provides programmatic access to Simply Sats wallet functionality via BRC-100 protocol.
 *
 * @example
 * ```typescript
 * import { SimplySats } from '@simply-sats/sdk'
 *
 * const wallet = new SimplySats({ origin: 'my-ai-bot' })
 *
 * // Check connection
 * const version = await wallet.getVersion()
 *
 * // Lock BSV for 144 blocks (~1 day)
 * const lock = await wallet.lockBSV({
 *   satoshis: 10000,
 *   blocks: 144,
 *   metadata: { app: 'my-app' }
 * })
 *
 * // List all locks
 * const locks = await wallet.listLocks()
 * ```
 */
export class SimplySats {
  private baseUrl: string
  private timeout: number
  private origin: string
  private sessionToken: string | null
  private apiVersion: string

  constructor(config: SimplySatsConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:3322'
    this.timeout = config.timeout || 120000
    this.origin = config.origin || 'sdk'
    this.sessionToken = config.sessionToken || null
    this.apiVersion = config.apiVersion ?? 'v1'
  }

  /**
   * Set the session token for authenticated requests
   * @param token - Session token obtained from Simply Sats wallet
   */
  setSessionToken(token: string): void {
    this.sessionToken = token
  }

  /**
   * Clear the session token
   */
  clearSessionToken(): void {
    this.sessionToken = null
  }

  /**
   * Get a CSRF nonce for state-changing operations
   * Required for: getPublicKey, createSignature, createAction, lockBSV, unlockBSV
   */
  async getNonce(): Promise<string> {
    const result = await this.request<{ nonce: string }>('getNonce')
    return result.nonce
  }

  /**
   * Make an HTTP request to Simply Sats
   */
  private async request<T>(method: string, params: Record<string, unknown> = {}, nonce?: string): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Origin': this.origin
      }

      // Add session token if available
      if (this.sessionToken) {
        headers['X-Simply-Sats-Token'] = this.sessionToken
      }

      // Add CSRF nonce for state-changing operations
      if (nonce) {
        headers['X-Simply-Sats-Nonce'] = nonce
      }

      const urlPrefix = this.apiVersion ? `${this.baseUrl}/${this.apiVersion}` : this.baseUrl
      const response = await fetch(`${urlPrefix}/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
        signal: controller.signal
      })

      const data = await response.json()

      // Handle session token rotation
      const newToken = response.headers.get('X-Simply-Sats-New-Token')
      if (newToken) {
        this.sessionToken = newToken
      }

      // Verify response signature if present (non-breaking — only warns on mismatch)
      const signature = response.headers.get('X-Simply-Sats-Signature')
      if (signature && this.sessionToken && typeof globalThis.crypto?.subtle !== 'undefined') {
        try {
          const key = await globalThis.crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(this.sessionToken),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
          )
          const bodyBytes = new TextEncoder().encode(JSON.stringify(data))
          const sigBytes = new Uint8Array(signature.match(/.{2}/g)!.map(b => parseInt(b, 16)))
          const valid = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes)
          if (!valid) {
            console.warn('[SimplySats SDK] Response signature verification failed')
          }
        } catch {
          // Signature verification is optional — don't break on failures
        }
      }

      // Check for BRC-100 error format
      if (data.isError) {
        throw new SimplySatsError(data.message, data.code)
      }

      return data as T
    } catch (error) {
      if (error instanceof SimplySatsError) throw error
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new SimplySatsError('Request timeout', -32000)
        }
        throw new SimplySatsError(error.message, -32000)
      }
      throw new SimplySatsError('Unknown error', -32000)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ==================== Basic Info ====================

  /**
   * Get Simply Sats version
   */
  async getVersion(): Promise<string> {
    const result = await this.request<{ version: string }>('getVersion')
    return result.version
  }

  /**
   * Get the network (mainnet/testnet)
   */
  async getNetwork(): Promise<string> {
    const result = await this.request<{ network: string }>('getNetwork')
    return result.network
  }

  /**
   * Check if wallet is authenticated (has loaded keys)
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await this.request<{ authenticated: boolean }>('isAuthenticated')
    return result.authenticated
  }

  /**
   * Wait for wallet to be authenticated
   */
  async waitForAuthentication(): Promise<boolean> {
    const result = await this.request<{ authenticated: boolean }>('waitForAuthentication')
    return result.authenticated
  }

  /**
   * Get current block height
   */
  async getHeight(): Promise<number> {
    const result = await this.request<{ height: number }>('getHeight')
    return result.height
  }

  // ==================== Key Operations ====================

  /**
   * Get public key from the wallet
   * Note: This operation requires a CSRF nonce
   */
  async getPublicKey(options: { identityKey?: boolean; nonce?: string } = {}): Promise<string> {
    const nonce = options.nonce || await this.getNonce()
    const result = await this.request<{ publicKey: string }>('getPublicKey', {
      identityKey: options.identityKey || false
    }, nonce)
    return result.publicKey
  }

  /**
   * Create a signature for a message
   * Note: This is a state-changing operation that requires a CSRF nonce
   */
  async createSignature(options: {
    data: string | Uint8Array
    hashToDirectlySign?: string
    nonce?: string
  }): Promise<SignatureResult> {
    const params: Record<string, unknown> = {}

    if (options.hashToDirectlySign) {
      params.hashToDirectlySign = options.hashToDirectlySign
    } else if (typeof options.data === 'string') {
      params.data = Array.from(new TextEncoder().encode(options.data))
    } else {
      params.data = Array.from(options.data)
    }

    // Get nonce if not provided
    const nonce = options.nonce || await this.getNonce()
    return this.request<SignatureResult>('createSignature', params, nonce)
  }

  // ==================== Transaction Operations ====================

  /**
   * Create a transaction action
   * Note: This is a state-changing operation that requires a CSRF nonce
   */
  async createAction(options: {
    description?: string
    outputs?: Array<{
      lockingScript: string
      satoshis: number
      basket?: string
      tags?: string[]
    }>
    inputs?: Array<{
      outpoint: string
      unlockingScript?: string
      inputDescription?: string
    }>
    lockTime?: number
    nonce?: string
  }): Promise<ActionResult> {
    // Get nonce if not provided
    const nonce = options.nonce || await this.getNonce()
    const { nonce: _, ...params } = options
    return this.request<ActionResult>('createAction', params, nonce)
  }

  /**
   * List outputs (UTXOs) from the wallet
   */
  async listOutputs(options: {
    basket?: string
    tags?: string[]
    limit?: number
    offset?: number
  } = {}): Promise<ListOutputsResult> {
    return this.request<ListOutputsResult>('listOutputs', options)
  }

  // ==================== Timelock Operations ====================

  /**
   * Lock BSV using OP_PUSH_TX timelock
   *
   * Creates a time-locked output that can only be spent after the specified number of blocks.
   * Note: This is a state-changing operation that requires a CSRF nonce
   *
   * @param options.satoshis - Amount to lock in satoshis
   * @param options.blocks - Number of blocks to lock for (144 blocks ~ 1 day)
   * @param options.metadata - Optional metadata (ordinalOrigin, app name, etc.)
   * @param options.nonce - Optional CSRF nonce (auto-fetched if not provided)
   *
   * @example
   * ```typescript
   * const lock = await wallet.lockBSV({
   *   satoshis: 50000,
   *   blocks: 144 * 7,  // ~1 week
   *   metadata: {
   *     app: 'wrootz',
   *     ordinalOrigin: 'abc123_0'
   *   }
   * })
   * console.log(`Locked at ${lock.txid}, unlocks at block ${lock.unlockBlock}`)
   * ```
   */
  async lockBSV(options: {
    satoshis: number
    blocks: number
    metadata?: {
      ordinalOrigin?: string
      app?: string
      [key: string]: unknown
    }
    nonce?: string
  }): Promise<LockResult> {
    // Get nonce if not provided
    const nonce = options.nonce || await this.getNonce()
    const { nonce: _, ...params } = options
    return this.request<LockResult>('lockBSV', params, nonce)
  }

  /**
   * Unlock a time-locked output
   *
   * Spends a previously locked output back to the wallet. Only works if
   * the current block height has passed the unlock block.
   * Note: This is a state-changing operation that requires a CSRF nonce
   *
   * @param outpoint - The outpoint to unlock (format: "txid.vout")
   * @param nonce - Optional CSRF nonce (auto-fetched if not provided)
   *
   * @example
   * ```typescript
   * const result = await wallet.unlockBSV('abc123...def.0')
   * console.log(`Unlocked ${result.amount} sats in tx ${result.txid}`)
   * ```
   */
  async unlockBSV(outpoint: string, nonce?: string): Promise<UnlockResult> {
    // Get nonce if not provided
    const actualNonce = nonce || await this.getNonce()
    return this.request<UnlockResult>('unlockBSV', { outpoint }, actualNonce)
  }

  /**
   * List all locked outputs
   *
   * Returns all active locks with their unlock status.
   *
   * @example
   * ```typescript
   * const { locks, currentHeight } = await wallet.listLocks()
   * for (const lock of locks) {
   *   if (lock.spendable) {
   *     console.log(`Lock ${lock.outpoint} is ready to unlock!`)
   *   } else {
   *     console.log(`Lock ${lock.outpoint} unlocks in ${lock.blocksRemaining} blocks`)
   *   }
   * }
   * ```
   */
  async listLocks(): Promise<ListLocksResult> {
    return this.request<ListLocksResult>('listLocks')
  }

  // ==================== Extended Wallet Methods ====================

  /**
   * Get current USD exchange rate for BSV.
   *
   * Note: Requires Simply Sats server with getExchangeRate endpoint support.
   */
  async getExchangeRate(): Promise<{ rate: number; currency: string }> {
    return this.request<{ rate: number; currency: string }>('getExchangeRate')
  }

  /**
   * Get token balance for a specific ticker.
   *
   * @param ticker - Token ticker symbol (e.g. "PEPE")
   *
   * Note: Requires Simply Sats server with getTokenBalance endpoint support.
   */
  async getTokenBalance(ticker: string): Promise<{ ticker: string; balance: string; decimals: number }> {
    return this.request<{ ticker: string; balance: string; decimals: number }>('getTokenBalance', { ticker })
  }

  /**
   * Encrypt data using the wallet identity key.
   *
   * @param options.data - Plaintext string to encrypt
   * @param options.pubKey - Optional recipient public key (defaults to own identity key)
   * @param options.nonce - Optional CSRF nonce (auto-fetched if not provided)
   *
   * Note: Requires Simply Sats server with encrypt endpoint support.
   */
  async encrypt(options: { data: string; pubKey?: string; nonce?: string }): Promise<{ encryptedData: string }> {
    const nonce = options.nonce ?? (await this.getNonce())
    return this.request<{ encryptedData: string }>('encrypt', { ...options, nonce })
  }

  /**
   * Decrypt data using the wallet identity key.
   *
   * @param options.encryptedData - Encrypted string to decrypt
   * @param options.pubKey - Optional sender public key (defaults to own identity key)
   * @param options.nonce - Optional CSRF nonce (auto-fetched if not provided)
   *
   * Note: Requires Simply Sats server with decrypt endpoint support.
   */
  async decrypt(options: { encryptedData: string; pubKey?: string; nonce?: string }): Promise<{ data: string }> {
    const nonce = options.nonce ?? (await this.getNonce())
    return this.request<{ data: string }>('decrypt', { ...options, nonce })
  }

  // ==================== Convenience Methods ====================

  /**
   * Check if Simply Sats is running and accessible
   */
  async ping(): Promise<boolean> {
    try {
      await this.getVersion()
      return true
    } catch {
      return false
    }
  }

  /**
   * Get wallet balance by summing spendable outputs
   */
  async getBalance(basket?: string): Promise<number> {
    const { outputs } = await this.listOutputs({ basket })
    return outputs
      .filter(o => o.spendable)
      .reduce((sum, o) => sum + o.satoshis, 0)
  }

  /**
   * Get total locked balance
   */
  async getLockedBalance(): Promise<number> {
    const { locks } = await this.listLocks()
    return locks.reduce((sum, l) => sum + l.satoshis, 0)
  }

  /**
   * Get spendable locked balance (locks that have matured)
   */
  async getSpendableLockedBalance(): Promise<number> {
    const { locks } = await this.listLocks()
    return locks
      .filter(l => l.spendable)
      .reduce((sum, l) => sum + l.satoshis, 0)
  }
}

/**
 * Error thrown by Simply Sats SDK
 */
export class SimplySatsError extends Error {
  code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'SimplySatsError'
    this.code = code
  }
}

// Default export for convenience
export default SimplySats
