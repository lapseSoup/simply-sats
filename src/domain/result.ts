/**
 * Result Type for Functional Error Handling
 *
 * Provides a standardized Result type for handling success/failure cases
 * without throwing exceptions. This pattern makes error handling explicit
 * and composable.
 *
 * @module domain/result
 *
 * @example
 * ```typescript
 * // Return success
 * return ok(data)
 *
 * // Return failure
 * return err(new AppError('NOT_FOUND', 'Item not found'))
 *
 * // Handle result
 * const result = await someOperation()
 * if (isOk(result)) {
 *   console.log(result.value)
 * } else {
 *   console.error(result.error.message)
 * }
 *
 * // Chain operations
 * const result = await pipe(
 *   fetchUser(id),
 *   flatMap(user => fetchOrders(user.id)),
 *   map(orders => orders.filter(o => o.status === 'active'))
 * )
 * ```
 */

// ============================================
// Result Type Definition
// ============================================

/**
 * Success result containing a value
 */
export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

/**
 * Failure result containing an error
 */
export interface Err<E> {
  readonly ok: false
  readonly error: E
}

/**
 * Result type that can be either Ok or Err
 */
export type Result<T, E = AppError> = Ok<T> | Err<E>

// ============================================
// Error Types
// ============================================

/**
 * Standard error codes used across the application
 */
export type ErrorCode =
  // General
  | 'UNKNOWN'
  | 'INTERNAL'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'

  // Wallet
  | 'WALLET_NOT_LOADED'
  | 'WALLET_LOCKED'
  | 'INVALID_PASSWORD'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_ADDRESS'
  | 'INVALID_AMOUNT'

  // Transaction
  | 'TX_FAILED'
  | 'TX_REJECTED'
  | 'BROADCAST_FAILED'
  | 'INVALID_TX'

  // Network
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'API_ERROR'

  // Security
  | 'RATE_LIMITED'
  | 'CSRF_INVALID'
  | 'SESSION_EXPIRED'

  // Database
  | 'DB_ERROR'
  | 'MIGRATION_FAILED'

/**
 * Standardized application error
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>
  override readonly cause?: Error

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
    this.cause = cause
  }

  /** Create a JSON-serializable representation */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      cause: this.cause?.message
    }
  }
}

// ============================================
// Constructors
// ============================================

/**
 * Create a success result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/**
 * Create a failure result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/**
 * Create an AppError failure result
 */
export function appErr(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): Err<AppError> {
  return err(new AppError(code, message, details))
}

// ============================================
// Type Guards
// ============================================

/**
 * Check if result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true
}

/**
 * Check if result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false
}

// ============================================
// Unwrap Functions
// ============================================

/**
 * Extract value from Ok result, throw if Err
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value
  }
  throw result.error
}

/**
 * Extract value from Ok result, return default if Err
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue
}

/**
 * Extract value from Ok result, compute default if Err
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  return isOk(result) ? result.value : fn(result.error)
}

/**
 * Extract error from Err result, throw if Ok
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (isErr(result)) {
    return result.error
  }
  throw new Error('Called unwrapErr on Ok value')
}

// ============================================
// Transformation Functions
// ============================================

/**
 * Transform the value if Ok, pass through if Err
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result
}

/**
 * Transform the error if Err, pass through if Ok
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return isErr(result) ? err(fn(result.error)) : result
}

/**
 * Chain operations that return Result (flatMap/andThen)
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return isOk(result) ? fn(result.value) : result
}

/**
 * Alias for flatMap
 */
export const andThen = flatMap

// ============================================
// Async Helpers
// ============================================

/**
 * Wrap a promise in a Result
 */
export async function fromPromise<T>(
  promise: Promise<T>,
  errorMapper?: (error: unknown) => AppError
): Promise<Result<T, AppError>> {
  try {
    const value = await promise
    return ok(value)
  } catch (e) {
    if (errorMapper) {
      return err(errorMapper(e))
    }
    if (e instanceof AppError) {
      return err(e)
    }
    return err(new AppError(
      'UNKNOWN',
      e instanceof Error ? e.message : 'Unknown error',
      undefined,
      e instanceof Error ? e : undefined
    ))
  }
}

/**
 * Wrap a sync function that might throw in a Result
 */
export function fromTry<T>(
  fn: () => T,
  errorMapper?: (error: unknown) => AppError
): Result<T, AppError> {
  try {
    return ok(fn())
  } catch (e) {
    if (errorMapper) {
      return err(errorMapper(e))
    }
    if (e instanceof AppError) {
      return err(e)
    }
    return err(new AppError(
      'UNKNOWN',
      e instanceof Error ? e.message : 'Unknown error',
      undefined,
      e instanceof Error ? e : undefined
    ))
  }
}

/**
 * Transform async Result value
 */
export async function mapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>
): Promise<Result<U, E>> {
  if (isOk(result)) {
    const value = await fn(result.value)
    return ok(value)
  }
  return result
}

/**
 * Chain async operations that return Result
 */
export async function flatMapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>
): Promise<Result<U, E>> {
  return isOk(result) ? fn(result.value) : result
}

// ============================================
// Collection Helpers
// ============================================

/**
 * Collect Results into a single Result with array of values
 * Returns Err with first error if any Result is Err
 */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = []

  for (const result of results) {
    if (isErr(result)) {
      return result
    }
    values.push(result.value)
  }

  return ok(values)
}

/**
 * Partition Results into Ok values and Err errors
 */
export function partition<T, E>(results: Result<T, E>[]): { values: T[]; errors: E[] } {
  const values: T[] = []
  const errors: E[] = []

  for (const result of results) {
    if (isOk(result)) {
      values.push(result.value)
    } else {
      errors.push(result.error)
    }
  }

  return { values, errors }
}

// ============================================
// Conversion Helpers
// ============================================

/**
 * Convert legacy { success, error } format to Result
 */
export function fromLegacy<T>(
  legacy: { success: boolean; error?: string } & Partial<T>
): Result<Omit<typeof legacy, 'success' | 'error'>, AppError> {
  if (legacy.success) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { success, error, ...rest } = legacy
    return ok(rest)
  }
  return err(new AppError('UNKNOWN', legacy.error || 'Operation failed'))
}

/**
 * Convert Result to legacy { success, error } format
 */
export function toLegacy<T>(
  result: Result<T, AppError>
): { success: boolean; error?: string; value?: T } {
  if (isOk(result)) {
    if (typeof result.value === 'object' && result.value !== null) {
      return { success: true, ...result.value }
    }
    return { success: true, value: result.value }
  }
  return { success: false, error: result.error.message }
}
