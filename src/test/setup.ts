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
  writable: true
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

// Mock crypto.subtle for tests
const mockCrypto = {
  getRandomValues: <T extends ArrayBufferView>(array: T): T => {
    if (array instanceof Uint8Array) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256)
      }
    }
    return array
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    deriveKey: vi.fn().mockResolvedValue({}),
    encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('{"mnemonic":"test"}'))
  }
}

Object.defineProperty(globalThis, 'crypto', {
  value: mockCrypto,
  writable: true
})

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
  interface Assertion<T = any> {
    toBeValidBSVAddress(): T
    toBeValidHex(): T
  }
  interface AsymmetricMatchersContaining {
    toBeValidBSVAddress(): any
    toBeValidHex(): any
  }
}
