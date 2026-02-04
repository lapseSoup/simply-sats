/**
 * Tests for Configuration Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  API_ENDPOINTS,
  TIMEOUTS,
  RETRY_CONFIG,
  RATE_LIMITS,
  DATABASE_CONFIG,
  BRC100_SERVER_CONFIG,
  ENCRYPTION_CONFIG,
  getWocApiUrl,
  getGpApiUrl,
  getArcApiUrl,
  getMessageBoxUrl,
  getOverlayNodes,
  getNetwork,
  setNetwork
} from './config'

describe('config', () => {
  // Store original localStorage value
  let originalNetwork: string | null

  beforeEach(() => {
    originalNetwork = localStorage.getItem('simply_sats_network')
  })

  afterEach(() => {
    // Restore original value
    if (originalNetwork) {
      localStorage.setItem('simply_sats_network', originalNetwork)
    } else {
      localStorage.removeItem('simply_sats_network')
    }
  })

  describe('API_ENDPOINTS', () => {
    it('should have WhatsOnChain endpoints for both networks', () => {
      expect(API_ENDPOINTS.whatsonchain.mainnet).toContain('whatsonchain.com')
      expect(API_ENDPOINTS.whatsonchain.testnet).toContain('whatsonchain.com')
    })

    it('should have GorillaPool endpoints for both networks', () => {
      expect(API_ENDPOINTS.gorillapool.mainnet).toContain('gorillapool.io')
      expect(API_ENDPOINTS.gorillapool.testnet).toContain('gorillapool.io')
    })

    it('should have ARC endpoints for both networks', () => {
      expect(API_ENDPOINTS.arc.mainnet).toContain('taal.com')
      expect(API_ENDPOINTS.arc.testnet).toContain('taal.com')
    })

    it('should have overlay node arrays for both networks', () => {
      expect(Array.isArray(API_ENDPOINTS.overlay.mainnet)).toBe(true)
      expect(API_ENDPOINTS.overlay.mainnet.length).toBeGreaterThan(0)
      expect(Array.isArray(API_ENDPOINTS.overlay.testnet)).toBe(true)
    })
  })

  describe('getWocApiUrl', () => {
    it('should return mainnet URL by default', () => {
      localStorage.removeItem('simply_sats_network')
      const url = getWocApiUrl()
      expect(url).toBe(API_ENDPOINTS.whatsonchain.mainnet)
    })

    it('should return testnet URL when testnet is set', () => {
      setNetwork('testnet')
      const url = getWocApiUrl()
      expect(url).toBe(API_ENDPOINTS.whatsonchain.testnet)
    })
  })

  describe('getGpApiUrl', () => {
    it('should return mainnet URL by default', () => {
      localStorage.removeItem('simply_sats_network')
      const url = getGpApiUrl()
      expect(url).toBe(API_ENDPOINTS.gorillapool.mainnet)
    })
  })

  describe('getArcApiUrl', () => {
    it('should return mainnet URL by default', () => {
      localStorage.removeItem('simply_sats_network')
      const url = getArcApiUrl()
      expect(url).toBe(API_ENDPOINTS.arc.mainnet)
    })
  })

  describe('getMessageBoxUrl', () => {
    it('should return messagebox URL', () => {
      const url = getMessageBoxUrl()
      expect(url).toContain('messagebox')
    })
  })

  describe('getOverlayNodes', () => {
    it('should return array of overlay nodes', () => {
      const nodes = getOverlayNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })
  })

  describe('network switching', () => {
    it('should switch between mainnet and testnet', () => {
      setNetwork('mainnet')
      expect(getNetwork()).toBe('mainnet')

      setNetwork('testnet')
      expect(getNetwork()).toBe('testnet')
    })

    it('should persist network selection', () => {
      setNetwork('testnet')
      expect(localStorage.getItem('simply_sats_network')).toBe('testnet')
    })
  })

  describe('TIMEOUTS', () => {
    it('should have reasonable timeout values', () => {
      expect(TIMEOUTS.default).toBeGreaterThan(0)
      expect(TIMEOUTS.sync).toBeGreaterThan(TIMEOUTS.default)
      expect(TIMEOUTS.healthCheck).toBeLessThan(TIMEOUTS.default)
      expect(TIMEOUTS.broadcast).toBeGreaterThan(TIMEOUTS.default)
    })
  })

  describe('RETRY_CONFIG', () => {
    it('should have valid retry configuration', () => {
      expect(RETRY_CONFIG.maxRetries).toBeGreaterThan(0)
      expect(RETRY_CONFIG.initialDelay).toBeGreaterThan(0)
      expect(RETRY_CONFIG.maxDelay).toBeGreaterThan(RETRY_CONFIG.initialDelay)
      expect(RETRY_CONFIG.backoffMultiplier).toBeGreaterThan(1)
      expect(Array.isArray(RETRY_CONFIG.retryableStatuses)).toBe(true)
    })

    it('should include 429 (rate limit) in retryable statuses', () => {
      expect(RETRY_CONFIG.retryableStatuses).toContain(429)
    })

    it('should include 5xx server errors in retryable statuses', () => {
      expect(RETRY_CONFIG.retryableStatuses).toContain(500)
      expect(RETRY_CONFIG.retryableStatuses).toContain(502)
      expect(RETRY_CONFIG.retryableStatuses).toContain(503)
    })
  })

  describe('RATE_LIMITS', () => {
    it('should have valid rate limit configuration', () => {
      expect(RATE_LIMITS.addressSyncDelay).toBeGreaterThan(0)
      expect(RATE_LIMITS.maxConcurrentRequests).toBeGreaterThan(0)
    })
  })

  describe('DATABASE_CONFIG', () => {
    it('should have valid database configuration', () => {
      expect(DATABASE_CONFIG.filename).toBe('simplysats.db')
      expect(DATABASE_CONFIG.connectionString).toContain('sqlite:')
    })
  })

  describe('BRC100_SERVER_CONFIG', () => {
    it('should have valid BRC-100 server configuration', () => {
      expect(BRC100_SERVER_CONFIG.port).toBe(3322)
      expect(BRC100_SERVER_CONFIG.requestTimeout).toBeGreaterThan(0)
    })
  })

  describe('ENCRYPTION_CONFIG', () => {
    it('should have secure encryption parameters', () => {
      // OWASP recommends at least 100,000 PBKDF2 iterations
      expect(ENCRYPTION_CONFIG.pbkdf2Iterations).toBeGreaterThanOrEqual(100000)
      // Salt should be at least 16 bytes (128 bits)
      expect(ENCRYPTION_CONFIG.saltLength).toBeGreaterThanOrEqual(16)
      // IV should be 12 bytes for AES-GCM
      expect(ENCRYPTION_CONFIG.ivLength).toBe(12)
      // Key should be 256 bits for AES-256
      expect(ENCRYPTION_CONFIG.keyLength).toBe(256)
    })
  })
})
