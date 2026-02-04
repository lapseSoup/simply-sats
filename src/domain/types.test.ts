import { describe, it, expect } from 'vitest'
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  mapResult,
  flatMapResult,
  type Result
} from './types'

describe('Result type', () => {
  describe('ok()', () => {
    it('should create a successful result', () => {
      const result = ok(42)
      expect(result.ok).toBe(true)
      expect(isOk(result) && result.value).toBe(42)
    })

    it('should work with different types', () => {
      const numResult = ok(123)
      const strResult = ok('hello')
      const objResult = ok({ key: 'value' })

      expect(isOk(numResult) && numResult.value).toBe(123)
      expect(isOk(strResult) && strResult.value).toBe('hello')
      if (isOk(objResult)) {
        expect(objResult.value).toEqual({ key: 'value' })
      }
    })
  })

  describe('err()', () => {
    it('should create a failed result', () => {
      const result = err('Something went wrong')
      expect(result.ok).toBe(false)
      expect(isErr(result) && result.error).toBe('Something went wrong')
    })

    it('should work with Error objects', () => {
      const error = new Error('Test error')
      const result = err(error)
      expect(result.ok).toBe(false)
      expect(isErr(result) && result.error).toBe(error)
    })
  })

  describe('isOk()', () => {
    it('should return true for successful results', () => {
      const result = ok(42)
      expect(isOk(result)).toBe(true)
    })

    it('should return false for failed results', () => {
      const result = err('error')
      expect(isOk(result)).toBe(false)
    })

    it('should narrow the type correctly', () => {
      const result: Result<number, string> = ok(42)
      if (isOk(result)) {
        // TypeScript should know result.value is number
        const value: number = result.value
        expect(value).toBe(42)
      }
    })
  })

  describe('isErr()', () => {
    it('should return true for failed results', () => {
      const result = err('error')
      expect(isErr(result)).toBe(true)
    })

    it('should return false for successful results', () => {
      const result = ok(42)
      expect(isErr(result)).toBe(false)
    })

    it('should narrow the type correctly', () => {
      const result: Result<number, string> = err('error')
      if (isErr(result)) {
        // TypeScript should know result.error is string
        const error: string = result.error
        expect(error).toBe('error')
      }
    })
  })

  describe('unwrap()', () => {
    it('should return value for successful results', () => {
      const result = ok(42)
      expect(unwrap(result)).toBe(42)
    })

    it('should throw for failed results with Error', () => {
      const error = new Error('Test error')
      const result = err(error)
      expect(() => unwrap(result)).toThrow('Test error')
    })

    it('should throw for failed results with string', () => {
      const result = err('String error')
      expect(() => unwrap(result)).toThrow('String error')
    })
  })

  describe('unwrapOr()', () => {
    it('should return value for successful results', () => {
      const result = ok(42)
      expect(unwrapOr(result, 0)).toBe(42)
    })

    it('should return default for failed results', () => {
      const result = err('error')
      expect(unwrapOr(result, 0)).toBe(0)
    })
  })

  describe('mapResult()', () => {
    it('should transform successful results', () => {
      const result = ok(21)
      const mapped = mapResult(result, x => x * 2)
      expect(isOk(mapped)).toBe(true)
      if (isOk(mapped)) {
        expect(mapped.value).toBe(42)
      }
    })

    it('should pass through failed results', () => {
      const result: Result<number, string> = err('error')
      const mapped = mapResult(result, x => x * 2)
      expect(isErr(mapped)).toBe(true)
      if (isErr(mapped)) {
        expect(mapped.error).toBe('error')
      }
    })
  })

  describe('flatMapResult()', () => {
    const safeDivide = (a: number, b: number): Result<number, string> => {
      if (b === 0) return err('Division by zero')
      return ok(a / b)
    }

    it('should chain successful results', () => {
      const result = ok(10)
      const chained = flatMapResult(result, x => safeDivide(x, 2))
      expect(isOk(chained)).toBe(true)
      if (isOk(chained)) {
        expect(chained.value).toBe(5)
      }
    })

    it('should short-circuit on first error', () => {
      const result = ok(10)
      const chained = flatMapResult(result, x => safeDivide(x, 0))
      expect(isErr(chained)).toBe(true)
      if (isErr(chained)) {
        expect(chained.error).toBe('Division by zero')
      }
    })

    it('should not call fn if result is already error', () => {
      let called = false
      const result: Result<number, string> = err('initial error')
      flatMapResult(result, x => {
        called = true
        return ok(x * 2)
      })
      expect(called).toBe(false)
    })
  })

  describe('real-world usage patterns', () => {
    interface User {
      id: number
      name: string
    }

    const findUser = (id: number): Result<User, string> => {
      if (id <= 0) return err('Invalid user ID')
      if (id > 100) return err('User not found')
      return ok({ id, name: `User ${id}` })
    }

    const getUserName = (id: number): Result<string, string> => {
      return mapResult(findUser(id), user => user.name)
    }

    it('should work with domain operations', () => {
      const result = getUserName(42)
      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.value).toBe('User 42')
      }
    })

    it('should propagate errors', () => {
      const result = getUserName(-1)
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error).toBe('Invalid user ID')
      }
    })
  })
})
