/**
 * Structured Error Handling for Simply Sats
 *
 * Provides consistent error types, codes, and handling across the application.
 * Aligned with BRC-100 JSON-RPC error standards where applicable.
 */

// Standard JSON-RPC error codes
export const ErrorCodes = {
  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Application-specific errors (-32000 to -32099)
  GENERIC_ERROR: -32000,
  WALLET_NOT_LOADED: -32001,
  WALLET_LOCKED: -32002,
  USER_REJECTED: -32003,
  INSUFFICIENT_FUNDS: -32004,
  INVALID_ADDRESS: -32005,
  INVALID_AMOUNT: -32006,
  BROADCAST_FAILED: -32007,
  NETWORK_ERROR: -32008,
  DATABASE_ERROR: -32009,
  ENCRYPTION_ERROR: -32010,
  DECRYPTION_ERROR: -32011,
  INVALID_MNEMONIC: -32012,
  LOCK_NOT_FOUND: -32013,
  LOCK_NOT_SPENDABLE: -32014,
  UTXO_NOT_FOUND: -32015,
  SIGNATURE_ERROR: -32016,
  TIMEOUT_ERROR: -32017,
  BROADCAST_SUCCEEDED_DB_FAILED: -32018,
  INVALID_STATE: -32019
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * Application error with structured code and context
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly context?: Record<string, unknown>
  public readonly timestamp: number

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.GENERIC_ERROR,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.context = context
    this.timestamp = Date.now()

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError)
    }
  }

  /**
   * Convert to BRC-100 compatible error format
   */
  toJSON(): { code: number; message: string; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.context && { data: this.context })
    }
  }

  /**
   * Create error from unknown caught value
   */
  static fromUnknown(error: unknown, defaultCode: ErrorCode = ErrorCodes.GENERIC_ERROR): AppError {
    if (error instanceof AppError) {
      return error
    }

    if (error instanceof Error) {
      return new AppError(error.message, defaultCode, { originalError: error.name })
    }

    if (typeof error === 'string') {
      return new AppError(error, defaultCode)
    }

    return new AppError('An unknown error occurred', defaultCode)
  }
}

// Specific error classes for common scenarios

export class WalletError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.GENERIC_ERROR, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'WalletError'
  }
}

export class WalletNotLoadedError extends WalletError {
  constructor() {
    super('No wallet loaded', ErrorCodes.WALLET_NOT_LOADED)
    this.name = 'WalletNotLoadedError'
  }
}

export class WalletLockedError extends WalletError {
  constructor() {
    super('Wallet is locked', ErrorCodes.WALLET_LOCKED)
    this.name = 'WalletLockedError'
  }
}

export class InsufficientFundsError extends WalletError {
  constructor(required: number, available: number) {
    super(
      `Insufficient funds: need ${required} sats, have ${available} sats`,
      ErrorCodes.INSUFFICIENT_FUNDS,
      { required, available }
    )
    this.name = 'InsufficientFundsError'
  }
}

export class InvalidAddressError extends WalletError {
  constructor(address: string) {
    super(`Invalid BSV address: ${address}`, ErrorCodes.INVALID_ADDRESS, { address })
    this.name = 'InvalidAddressError'
  }
}

export class InvalidAmountError extends WalletError {
  constructor(amount: number, reason?: string) {
    super(
      reason || `Invalid amount: ${amount}`,
      ErrorCodes.INVALID_AMOUNT,
      { amount }
    )
    this.name = 'InvalidAmountError'
  }
}

export class InvalidMnemonicError extends WalletError {
  constructor(wordCount?: number) {
    super(
      'Invalid mnemonic phrase. Please check your 12 words.',
      ErrorCodes.INVALID_MNEMONIC,
      wordCount !== undefined ? { wordCount } : undefined
    )
    this.name = 'InvalidMnemonicError'
  }
}

export class NetworkError extends AppError {
  constructor(message: string, endpoint?: string) {
    super(message, ErrorCodes.NETWORK_ERROR, endpoint ? { endpoint } : undefined)
    this.name = 'NetworkError'
  }
}

export class BroadcastError extends AppError {
  constructor(message: string, txid?: string) {
    super(message, ErrorCodes.BROADCAST_FAILED, txid ? { txid } : undefined)
    this.name = 'BroadcastError'
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, operation?: string) {
    super(message, ErrorCodes.DATABASE_ERROR, operation ? { operation } : undefined)
    this.name = 'DatabaseError'
  }
}

export class EncryptionError extends AppError {
  constructor(message: string = 'Encryption failed') {
    super(message, ErrorCodes.ENCRYPTION_ERROR)
    this.name = 'EncryptionError'
  }
}

export class DecryptionError extends AppError {
  constructor(message: string = 'Decryption failed - invalid password or corrupted data') {
    super(message, ErrorCodes.DECRYPTION_ERROR)
    this.name = 'DecryptionError'
  }
}

export class LockError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.GENERIC_ERROR, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'LockError'
  }
}

export class LockNotFoundError extends LockError {
  constructor(outpoint: string) {
    super(`Lock not found: ${outpoint}`, ErrorCodes.LOCK_NOT_FOUND, { outpoint })
    this.name = 'LockNotFoundError'
  }
}

export class LockNotSpendableError extends LockError {
  constructor(blocksRemaining: number) {
    super(
      `Lock not yet spendable. ${blocksRemaining} blocks remaining`,
      ErrorCodes.LOCK_NOT_SPENDABLE,
      { blocksRemaining }
    )
    this.name = 'LockNotSpendableError'
  }
}

export class UserRejectedError extends AppError {
  constructor(action: string = 'request') {
    super(`User rejected ${action}`, ErrorCodes.USER_REJECTED, { action })
    this.name = 'UserRejectedError'
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Operation timed out: ${operation}`,
      ErrorCodes.TIMEOUT_ERROR,
      { operation, timeoutMs }
    )
    this.name = 'TimeoutError'
  }
}

/**
 * Type guard to check if a value is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Get user-friendly error message
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message
  }

  if (error instanceof Error) {
    // Map common error messages to user-friendly versions
    if (error.message.includes('network')) {
      return 'Network connection failed. Please check your internet connection.'
    }
    if (error.message.includes('timeout')) {
      return 'The operation timed out. Please try again.'
    }
    return error.message
  }

  return 'An unexpected error occurred'
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<
  TArgs extends unknown[],
  TReturn,
  T extends (...args: TArgs) => Promise<TReturn>
>(
  fn: T,
  defaultErrorCode: ErrorCode = ErrorCodes.GENERIC_ERROR
): T {
  return (async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args)
    } catch (error) {
      throw AppError.fromUnknown(error, defaultErrorCode)
    }
  }) as T
}


/**
 * Database-specific error for Result<T, DbError> return types.
 * Distinguishes between query failures, not-found, and connection issues.
 * Used in repository functions that return Result<T | null, DbError>.
 */
export class DbError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'QUERY_FAILED' | 'CONSTRAINT' | 'CONNECTION',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'DbError'
  }
}
