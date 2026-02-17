// @vitest-environment node

/**
 * Tests for Overlay Network Service (overlay.ts)
 *
 * Covers: discoverOverlayNodes, findNodesForTopic, submitToOverlay,
 *         lookupByTopic, lookupByAddress, lookupServices, registerService,
 *         getBeef, broadcastWithOverlay, subscribeToTopic, getOverlayStatus,
 *         clearOverlayCache
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockBroadcastTransaction, mockGetTxProofSafe } = vi.hoisted(() => ({
  mockBroadcastTransaction: vi.fn(),
  mockGetTxProofSafe: vi.fn(),
}))

vi.mock('../infrastructure/api/broadcastService', () => ({
  broadcastTransaction: (...args: unknown[]) => mockBroadcastTransaction(...args),
}))

vi.mock('../infrastructure/api/wocClient', () => ({
  getWocClient: () => ({
    getTxProofSafe: mockGetTxProofSafe,
  }),
}))

vi.mock('./logger', () => ({
  overlayLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock P2PKH from @bsv/sdk
vi.mock('@bsv/sdk', () => ({
  P2PKH: class {
    lock(address: string) {
      return { toHex: () => `script_${address}` }
    }
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  discoverOverlayNodes,
  findNodesForTopic,
  submitToOverlay,
  lookupByTopic,
  lookupByAddress,
  lookupServices,
  registerService,
  getBeef,
  broadcastWithOverlay,
  subscribeToTopic,
  getOverlayStatus,
  clearOverlayCache,
  TOPICS,
} from './overlay'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace global fetch with a mock for each test */
let mockFetch: ReturnType<typeof vi.fn>

function makeFetchResponse(ok: boolean, body: unknown, options?: { arrayBuffer?: ArrayBuffer }) {
  return {
    ok,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => options?.arrayBuffer ?? new ArrayBuffer(0),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Overlay Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearOverlayCache()

    // Install global fetch mock
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // =========================================================================
  // TOPICS constant
  // =========================================================================

  describe('TOPICS', () => {
    it('should export expected topic keys', () => {
      expect(TOPICS.DEFAULT).toBe('tm_default')
      expect(TOPICS.TOKENS).toBe('tm_tokens')
      expect(TOPICS.ORDINALS).toBe('tm_ordinals')
      expect(TOPICS.LOCKS).toBe('tm_locks')
      expect(TOPICS.WROOTZ_LOCKS).toBe('tm_wrootz_locks')
      expect(TOPICS.ONE_SAT_ORDINALS).toBe('tm_1sat_ordinals')
    })
  })

  // =========================================================================
  // discoverOverlayNodes
  // =========================================================================

  describe('discoverOverlayNodes', () => {
    it('should return healthy nodes', async () => {
      // health check succeeds for both known nodes
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) {
          return makeFetchResponse(true, { status: 'ok' })
        }
        if (url.endsWith('/topics')) {
          return makeFetchResponse(true, { topics: ['tm_default', 'tm_tokens'] })
        }
        return makeFetchResponse(false, 'not found')
      })

      const nodes = await discoverOverlayNodes()

      expect(nodes.length).toBe(2)
      expect(nodes[0]!.healthy).toBe(true)
      expect(nodes[0]!.topics).toContain('tm_default')
    })

    it('should exclude unhealthy nodes', async () => {
      let callCount = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) {
          callCount++
          // First node healthy, second unhealthy (both retries)
          if (callCount <= 1) return makeFetchResponse(true, {})
          return makeFetchResponse(false, 'down')
        }
        if (url.endsWith('/topics')) {
          return makeFetchResponse(true, { topics: [] })
        }
        return makeFetchResponse(false, '')
      })

      const nodes = await discoverOverlayNodes()

      // Only one healthy node
      expect(nodes.length).toBe(1)
    })

    it('should use cache for recently checked nodes', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: ['tm_default'] })
        return makeFetchResponse(false, '')
      })

      // First call populates cache
      await discoverOverlayNodes()
      const firstCallCount = mockFetch.mock.calls.length

      // Second call should use cache
      const nodes = await discoverOverlayNodes()
      expect(nodes.length).toBe(2)
      // No additional fetch calls
      expect(mockFetch.mock.calls.length).toBe(firstCallCount)
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'))

      const nodes = await discoverOverlayNodes()

      // No nodes healthy
      expect(nodes.length).toBe(0)
    })
  })

  // =========================================================================
  // findNodesForTopic
  // =========================================================================

  describe('findNodesForTopic', () => {
    it('should return nodes that support the requested topic', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: ['tm_tokens'] })
        return makeFetchResponse(false, '')
      })

      const nodes = await findNodesForTopic('tm_tokens')

      expect(nodes.length).toBe(2)
      nodes.forEach(n => expect(n.topics).toContain('tm_tokens'))
    })

    it('should include nodes with empty topics list (accepts all)', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        return makeFetchResponse(false, '')
      })

      const nodes = await findNodesForTopic('tm_anything')

      // Empty topics means node accepts all
      expect(nodes.length).toBe(2)
    })

    it('should filter out nodes that do not support the topic', async () => {
      let nodeIndex = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) {
          nodeIndex++
          if (nodeIndex === 1) return makeFetchResponse(true, { topics: ['tm_tokens'] })
          return makeFetchResponse(true, { topics: ['tm_locks'] })
        }
        return makeFetchResponse(false, '')
      })

      const nodes = await findNodesForTopic('tm_tokens')

      expect(nodes.length).toBe(1)
    })
  })

  // =========================================================================
  // submitToOverlay
  // =========================================================================

  describe('submitToOverlay', () => {
    beforeEach(() => {
      // Setup healthy nodes
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) {
          return makeFetchResponse(true, { txid: 'abc123' })
        }
        return makeFetchResponse(false, '')
      })
    })

    it('should submit to all overlay nodes and return results', async () => {
      const results = await submitToOverlay('rawTxHex', TOPICS.DEFAULT)

      expect(results.length).toBe(2)
      results.forEach(r => {
        expect(r.accepted).toBe(true)
        expect(r.txid).toBe('abc123')
      })
    })

    it('should return empty results when no nodes available', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'))
      clearOverlayCache()

      const results = await submitToOverlay('rawTxHex')

      expect(results).toEqual([])
    })

    it('should handle partial failures', async () => {
      let submitCount = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) {
          submitCount++
          if (submitCount === 1) return makeFetchResponse(true, { txid: 'tx123' })
          return makeFetchResponse(false, 'rejected by node')
        }
        return makeFetchResponse(false, '')
      })

      const results = await submitToOverlay('rawTxHex')

      expect(results.length).toBe(2)
      expect(results[0]!.accepted).toBe(true)
      expect(results[1]!.accepted).toBe(false)
      expect(results[1]!.error).toBe('rejected by node')
    })

    it('should handle submit network errors', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) throw new Error('Connection reset')
        return makeFetchResponse(false, '')
      })

      const results = await submitToOverlay('rawTxHex')

      expect(results.length).toBe(2)
      results.forEach(r => {
        expect(r.accepted).toBe(false)
        expect(r.error).toBe('Connection reset')
      })
    })
  })

  // =========================================================================
  // lookupByTopic
  // =========================================================================

  describe('lookupByTopic', () => {
    it('should return outputs from overlay', async () => {
      const mockOutputs = [
        { txid: 'tx1', vout: 0, satoshis: 1000, lockingScript: 'abc', topic: 'tm_default' },
      ]
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) return makeFetchResponse(true, { outputs: mockOutputs })
        return makeFetchResponse(false, '')
      })

      const result = await lookupByTopic('tm_default')

      expect(result).not.toBeNull()
      expect(result!.outputs).toHaveLength(1)
      expect(result!.outputs[0]!.txid).toBe('tx1')
    })

    it('should return null when all nodes fail', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) throw new Error('Timeout')
        return makeFetchResponse(false, '')
      })

      const result = await lookupByTopic('tm_default')

      expect(result).toBeNull()
    })

    it('should try next node on failure', async () => {
      let lookupCount = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) {
          lookupCount++
          if (lookupCount === 1) throw new Error('First node down')
          return makeFetchResponse(true, { outputs: [{ txid: 'tx2', vout: 0 }] })
        }
        return makeFetchResponse(false, '')
      })

      const result = await lookupByTopic('tm_default')

      expect(result).not.toBeNull()
      expect(result!.outputs[0]!.txid).toBe('tx2')
    })

    it('should pass limit and offset parameters', async () => {
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) {
          const body = JSON.parse(options?.body as string)
          expect(body.limit).toBe(50)
          expect(body.offset).toBe(10)
          return makeFetchResponse(true, { outputs: [] })
        }
        return makeFetchResponse(false, '')
      })

      await lookupByTopic('tm_default', 50, 10)
    })
  })

  // =========================================================================
  // lookupByAddress
  // =========================================================================

  describe('lookupByAddress', () => {
    it('should convert address to locking script and lookup', async () => {
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) {
          const body = JSON.parse(options?.body as string)
          expect(body.lockingScript).toBe('script_1TestAddr')
          return makeFetchResponse(true, { outputs: [{ txid: 'tx1', vout: 0 }] })
        }
        return makeFetchResponse(false, '')
      })

      const result = await lookupByAddress('1TestAddr')

      expect(result).not.toBeNull()
      expect(result!.outputs).toHaveLength(1)
    })

    it('should return null when all nodes fail', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/lookup')) return makeFetchResponse(false, 'error')
        return makeFetchResponse(false, '')
      })

      const result = await lookupByAddress('1TestAddr')

      expect(result).toBeNull()
    })

    it('should filter by topic when provided', async () => {
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: ['tm_tokens'] })
        if (url.endsWith('/lookup')) {
          const body = JSON.parse(options?.body as string)
          expect(body.topic).toBe('tm_tokens')
          return makeFetchResponse(true, { outputs: [] })
        }
        return makeFetchResponse(false, '')
      })

      await lookupByAddress('1TestAddr', 'tm_tokens')
    })
  })

  // =========================================================================
  // lookupServices
  // =========================================================================

  describe('lookupServices', () => {
    it('should return services from overlay nodes', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/services')) {
          return makeFetchResponse(true, {
            services: [
              { url: 'https://service1.example.com', description: 'Token service' },
            ],
          })
        }
        return makeFetchResponse(false, '')
      })

      const services = await lookupServices('tm_tokens')

      expect(services.length).toBeGreaterThan(0)
      expect(services[0]!.serviceUrl).toBe('https://service1.example.com')
      expect(services[0]!.topic).toBe('tm_tokens')
    })

    it('should use cached results on second call', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/services')) {
          return makeFetchResponse(true, {
            services: [{ serviceUrl: 'https://s1.example.com' }],
          })
        }
        return makeFetchResponse(false, '')
      })

      const first = await lookupServices('tm_tokens')
      const fetchCountAfterFirst = mockFetch.mock.calls.length

      const second = await lookupServices('tm_tokens')

      // Same results, no additional fetch calls
      expect(second).toEqual(first)
      expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirst)
    })

    it('should handle empty services response', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/services')) return makeFetchResponse(true, {})
        return makeFetchResponse(false, '')
      })

      const services = await lookupServices('tm_unknown')

      expect(services).toEqual([])
    })
  })

  // =========================================================================
  // registerService
  // =========================================================================

  describe('registerService', () => {
    it('should register service with overlay nodes', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/register')) return makeFetchResponse(true, { success: true })
        return makeFetchResponse(false, '')
      })

      const result = await registerService('tm_tokens', 'https://my-service.example.com', 'pubkey123')

      expect(result).toBe(true)
    })

    it('should return false when no nodes accept registration', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/register')) return makeFetchResponse(false, 'rejected')
        return makeFetchResponse(false, '')
      })

      const result = await registerService('tm_tokens', 'https://my-service.example.com', 'pubkey123')

      expect(result).toBe(false)
    })
  })

  // =========================================================================
  // getBeef
  // =========================================================================

  describe('getBeef', () => {
    it('should return hex beef from overlay node', async () => {
      const buffer = new Uint8Array([0xbe, 0xef]).buffer
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.includes('/beef/')) return makeFetchResponse(true, null, { arrayBuffer: buffer })
        return makeFetchResponse(false, '')
      })

      const result = await getBeef('txid123')

      expect(result).toBe('beef')
    })

    it('should fallback to WhatsOnChain when overlay fails', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.includes('/beef/')) return makeFetchResponse(false, 'not found')
        return makeFetchResponse(false, '')
      })
      mockGetTxProofSafe.mockResolvedValue({ ok: true, value: { proof: 'data' } })

      const result = await getBeef('txid123')

      expect(result).toBe(JSON.stringify({ proof: 'data' }))
    })

    it('should return null when all sources fail', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.includes('/beef/')) return makeFetchResponse(false, 'not found')
        return makeFetchResponse(false, '')
      })
      mockGetTxProofSafe.mockResolvedValue({ ok: false, error: { message: 'not found' } })

      const result = await getBeef('txid123')

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // broadcastWithOverlay
  // =========================================================================

  describe('broadcastWithOverlay', () => {
    it('should broadcast to both overlay and miners (both succeed)', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) return makeFetchResponse(true, { txid: 'overlay-txid' })
        return makeFetchResponse(false, '')
      })
      mockBroadcastTransaction.mockResolvedValue('miner-txid')

      const result = await broadcastWithOverlay('rawTxHex')

      expect(result.txid).toBe('overlay-txid')
      expect(result.overlayResults.length).toBe(2)
      expect(result.overlayResults[0]!.accepted).toBe(true)
      expect(result.minerBroadcast.ok).toBe(true)
    })

    it('should use miner txid when overlay fails', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) return makeFetchResponse(false, 'rejected')
        return makeFetchResponse(false, '')
      })
      mockBroadcastTransaction.mockResolvedValue('miner-txid')

      const result = await broadcastWithOverlay('rawTxHex')

      expect(result.txid).toBe('miner-txid')
      expect(result.minerBroadcast.ok).toBe(true)
    })

    it('should handle miner broadcast failure', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        if (url.endsWith('/submit')) return makeFetchResponse(true, { txid: 'overlay-txid' })
        return makeFetchResponse(false, '')
      })
      mockBroadcastTransaction.mockRejectedValue(new Error('Miner down'))

      const result = await broadcastWithOverlay('rawTxHex')

      expect(result.txid).toBe('overlay-txid')
      expect(result.minerBroadcast.ok).toBe(false)
      if (!result.minerBroadcast.ok) {
        expect(result.minerBroadcast.error).toBe('Miner down')
      }
    })

    it('should handle both overlay and miner failure', async () => {
      mockFetch.mockRejectedValue(new Error('All down'))
      clearOverlayCache()
      mockBroadcastTransaction.mockRejectedValue(new Error('Miner down'))

      const result = await broadcastWithOverlay('rawTxHex')

      expect(result.txid).toBe('')
      expect(result.overlayResults).toEqual([])
      expect(result.minerBroadcast.ok).toBe(false)
    })
  })

  // =========================================================================
  // subscribeToTopic
  // =========================================================================

  describe('subscribeToTopic', () => {
    it('should return an unsubscribe function', () => {
      const callback = vi.fn()
      const unsub = subscribeToTopic('tm_default', callback)

      expect(typeof unsub).toBe('function')

      // Call unsubscribe to clean up
      unsub()
    })

    it('should call unsubscribe without errors', () => {
      const callback = vi.fn()
      const unsub = subscribeToTopic('tm_default', callback)

      expect(() => unsub()).not.toThrow()
    })
  })

  // =========================================================================
  // getOverlayStatus
  // =========================================================================

  describe('getOverlayStatus', () => {
    it('should report healthy when nodes are up', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        return makeFetchResponse(false, '')
      })

      const status = await getOverlayStatus()

      expect(status.healthy).toBe(true)
      expect(status.nodeCount).toBe(2)
      expect(status.nodes.length).toBe(2)
    })

    it('should report unhealthy when all nodes are down', async () => {
      mockFetch.mockRejectedValue(new Error('All down'))
      clearOverlayCache()

      const status = await getOverlayStatus()

      expect(status.healthy).toBe(false)
      expect(status.nodeCount).toBe(0)
      expect(status.nodes).toEqual([])
    })
  })

  // =========================================================================
  // clearOverlayCache
  // =========================================================================

  describe('clearOverlayCache', () => {
    it('should force fresh discovery after clearing', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/health')) return makeFetchResponse(true, {})
        if (url.endsWith('/topics')) return makeFetchResponse(true, { topics: [] })
        return makeFetchResponse(false, '')
      })

      // Populate cache
      await discoverOverlayNodes()
      const callsAfterFirst = mockFetch.mock.calls.length

      // Clear and rediscover
      clearOverlayCache()
      await discoverOverlayNodes()

      // Should have made new fetch calls
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    })
  })
})
