// Setup Web Crypto API FIRST - before any other imports
// This must be at the very top to ensure globalThis.crypto is set
// before any modules that depend on it are loaded
import { webcrypto } from 'node:crypto'
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true
})

import { expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  }),
  get length() {
    return Object.keys(this.store).length
  },
  key: vi.fn((index: number) => Object.keys(localStorageMock.store)[index] || null)
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true
})

// Reset localStorage before each test
beforeEach(() => {
  localStorageMock.store = {}
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
  localStorageMock.removeItem.mockClear()
  localStorageMock.clear.mockClear()
})

// Mock fetch
globalThis.fetch = vi.fn()

// Custom matchers
expect.extend({
  toBeValidBSVAddress(received: string) {
    const pass = typeof received === 'string' &&
      received.length >= 25 &&
      received.length <= 34 &&
      (received.startsWith('1') || received.startsWith('3') || received.startsWith('bc1'))

    return {
      message: () => pass
        ? `expected ${received} not to be a valid BSV address`
        : `expected ${received} to be a valid BSV address`,
      pass
    }
  },
  toBeValidHex(received: string) {
    const pass = typeof received === 'string' && /^[0-9a-fA-F]*$/.test(received)

    return {
      message: () => pass
        ? `expected ${received} not to be valid hex`
        : `expected ${received} to be valid hex`,
      pass
    }
  }
})

// Extend Vitest's expect types
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toBeValidBSVAddress(): void
    toBeValidHex(): void
  }
  interface AsymmetricMatchersContaining {
    toBeValidBSVAddress(): void
    toBeValidHex(): void
  }
}
