import { describe, it, expect } from 'vitest'
import {
  AppError,
  ErrorCodes,
  WalletError,
  WalletNotLoadedError,
  InsufficientFundsError,
  InvalidAddressError,
  InvalidMnemonicError,
  NetworkError,
  BroadcastError,
  DatabaseError,
  DecryptionError,
  LockNotFoundError,
  LockNotSpendableError,
  UserRejectedError,
  TimeoutError,
  isAppError,
  getUserMessage
} from './errors'

describe('Error Handling', () => {
  describe('AppError', () => {
    it('should create error with message and code', () => {
      const error = new AppError('Test error', ErrorCodes.GENERIC_ERROR)

      expect(error.message).toBe('Test error')
      expect(error.code).toBe(ErrorCodes.GENERIC_ERROR)
      expect(error.name).toBe('AppError')
      expect(error.timestamp).toBeDefined()
    })

    it('should include context when provided', () => {
      const context = { userId: '123', action: 'test' }
      const error = new AppError('Test', ErrorCodes.GENERIC_ERROR, context)

      expect(error.context).toEqual(context)
    })

    it('should convert to JSON for BRC-100 compatibility', () => {
      const error = new AppError('Test error', ErrorCodes.INVALID_PARAMS, { param: 'value' })
      const json = error.toJSON()

      expect(json.code).toBe(ErrorCodes.INVALID_PARAMS)
      expect(json.message).toBe('Test error')
      expect(json.data).toEqual({ param: 'value' })
    })

    it('should create from unknown error', () => {
      const originalError = new Error('Original message')
      const appError = AppError.fromUnknown(originalError)

      expect(appError.message).toBe('Original message')
      expect(appError).toBeInstanceOf(AppError)
    })

    it('should create from string', () => {
      const appError = AppError.fromUnknown('String error')

      expect(appError.message).toBe('String error')
    })

    it('should return same instance for AppError input', () => {
      const original = new AppError('Original', ErrorCodes.INTERNAL_ERROR)
      const result = AppError.fromUnknown(original)

      expect(result).toBe(original)
    })
  })

  describe('Specific Error Types', () => {
    describe('WalletNotLoadedError', () => {
      it('should have correct code and message', () => {
        const error = new WalletNotLoadedError()

        expect(error.code).toBe(ErrorCodes.WALLET_NOT_LOADED)
        expect(error.message).toBe('No wallet loaded')
        expect(error.name).toBe('WalletNotLoadedError')
      })
    })

    describe('InsufficientFundsError', () => {
      it('should include required and available amounts', () => {
        const error = new InsufficientFundsError(10000, 5000)

        expect(error.code).toBe(ErrorCodes.INSUFFICIENT_FUNDS)
        expect(error.message).toContain('10000')
        expect(error.message).toContain('5000')
        expect(error.context).toEqual({ required: 10000, available: 5000 })
      })
    })

    describe('InvalidAddressError', () => {
      it('should include the invalid address', () => {
        const error = new InvalidAddressError('invalid123')

        expect(error.code).toBe(ErrorCodes.INVALID_ADDRESS)
        expect(error.context?.address).toBe('invalid123')
      })
    })

    describe('InvalidMnemonicError', () => {
      it('should have correct message', () => {
        const error = new InvalidMnemonicError(8)

        expect(error.code).toBe(ErrorCodes.INVALID_MNEMONIC)
        expect(error.message).toContain('12 words')
        expect(error.context?.wordCount).toBe(8)
      })
    })

    describe('NetworkError', () => {
      it('should include endpoint when provided', () => {
        const error = new NetworkError('Connection failed', 'https://api.example.com')

        expect(error.code).toBe(ErrorCodes.NETWORK_ERROR)
        expect(error.context?.endpoint).toBe('https://api.example.com')
      })
    })

    describe('BroadcastError', () => {
      it('should have correct code', () => {
        const error = new BroadcastError('Broadcast failed')

        expect(error.code).toBe(ErrorCodes.BROADCAST_FAILED)
      })
    })

    describe('DatabaseError', () => {
      it('should include operation when provided', () => {
        const error = new DatabaseError('Query failed', 'INSERT')

        expect(error.code).toBe(ErrorCodes.DATABASE_ERROR)
        expect(error.context?.operation).toBe('INSERT')
      })
    })

    describe('DecryptionError', () => {
      it('should have default message', () => {
        const error = new DecryptionError()

        expect(error.code).toBe(ErrorCodes.DECRYPTION_ERROR)
        expect(error.message).toContain('Decryption failed')
      })
    })

    describe('LockNotFoundError', () => {
      it('should include outpoint', () => {
        const error = new LockNotFoundError('abc123.0')

        expect(error.code).toBe(ErrorCodes.LOCK_NOT_FOUND)
        expect(error.context?.outpoint).toBe('abc123.0')
      })
    })

    describe('LockNotSpendableError', () => {
      it('should include blocks remaining', () => {
        const error = new LockNotSpendableError(100)

        expect(error.code).toBe(ErrorCodes.LOCK_NOT_SPENDABLE)
        expect(error.message).toContain('100 blocks')
        expect(error.context?.blocksRemaining).toBe(100)
      })
    })

    describe('UserRejectedError', () => {
      it('should include action', () => {
        const error = new UserRejectedError('transaction')

        expect(error.code).toBe(ErrorCodes.USER_REJECTED)
        expect(error.message).toContain('transaction')
      })
    })

    describe('TimeoutError', () => {
      it('should include operation and timeout', () => {
        const error = new TimeoutError('broadcast', 30000)

        expect(error.code).toBe(ErrorCodes.TIMEOUT_ERROR)
        expect(error.context).toEqual({ operation: 'broadcast', timeoutMs: 30000 })
      })
    })
  })

  describe('isAppError', () => {
    it('should return true for AppError', () => {
      expect(isAppError(new AppError('test'))).toBe(true)
    })

    it('should return true for AppError subclasses', () => {
      expect(isAppError(new WalletError('test'))).toBe(true)
      expect(isAppError(new NetworkError('test'))).toBe(true)
    })

    it('should return false for regular Error', () => {
      expect(isAppError(new Error('test'))).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(isAppError('string')).toBe(false)
      expect(isAppError(null)).toBe(false)
      expect(isAppError(undefined)).toBe(false)
    })
  })

  describe('getUserMessage', () => {
    it('should return AppError message directly', () => {
      const error = new AppError('Custom message')
      expect(getUserMessage(error)).toBe('Custom message')
    })

    it('should return Error message', () => {
      const error = new Error('Error message')
      expect(getUserMessage(error)).toBe('Error message')
    })

    it('should return friendly message for network errors', () => {
      const error = new Error('network connection failed')
      expect(getUserMessage(error)).toContain('Network')
    })

    it('should return generic message for unknown types', () => {
      expect(getUserMessage('string error')).toBe('An unexpected error occurred')
      expect(getUserMessage(null)).toBe('An unexpected error occurred')
    })
  })

  describe('Error Codes', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(ErrorCodes.PARSE_ERROR).toBe(-32700)
      expect(ErrorCodes.INVALID_REQUEST).toBe(-32600)
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601)
      expect(ErrorCodes.INVALID_PARAMS).toBe(-32602)
      expect(ErrorCodes.INTERNAL_ERROR).toBe(-32603)
    })

    it('should have application-specific codes in -32000 to -32099 range', () => {
      const appCodes = [
        ErrorCodes.GENERIC_ERROR,
        ErrorCodes.WALLET_NOT_LOADED,
        ErrorCodes.INSUFFICIENT_FUNDS,
        ErrorCodes.NETWORK_ERROR,
        ErrorCodes.DATABASE_ERROR
      ]

      appCodes.forEach(code => {
        expect(code).toBeGreaterThanOrEqual(-32099)
        expect(code).toBeLessThanOrEqual(-32000)
      })
    })
  })
})
