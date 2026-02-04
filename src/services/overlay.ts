/**
 * Overlay Network Service for Simply Sats
 *
 * Implements SHIP (Storage Host Interconnect Protocol) and SLAP
 * (Service Lookup Availability Protocol) for BRC-100 compliance.
 *
 * SHIP: Enables storage and retrieval of transaction data across
 * a decentralized network of overlay nodes.
 *
 * SLAP: Enables discovery of services that handle specific topics
 * (like tokens, NFTs, smart contracts).
 */

import { P2PKH } from '@bsv/sdk'

// Known overlay network nodes (can be expanded)
const KNOWN_OVERLAY_NODES = [
  'https://overlay.babbage.systems',
  'https://overlay.gorillapool.io',
]

// Topic definitions for common protocols
export const TOPICS = {
  // Standard BRC topics
  DEFAULT: 'tm_default',
  TOKENS: 'tm_tokens',
  ORDINALS: 'tm_ordinals',
  LOCKS: 'tm_locks',

  // Wrootz-specific topics
  WROOTZ_LOCKS: 'tm_wrootz_locks',

  // 1Sat Ordinals
  ONE_SAT_ORDINALS: 'tm_1sat_ordinals',
} as const

// SHIP Node info
export interface ShipNode {
  url: string
  topics: string[]
  publicKey?: string
  healthy: boolean
  lastChecked: number
}

// SLAP Service info
export interface SlapService {
  topic: string
  serviceUrl: string
  description?: string
  publicKey?: string
}

// Transaction submission result
export interface SubmitResult {
  txid: string
  accepted: boolean
  node: string
  error?: string
}

// Output lookup result
export interface LookupResult {
  outputs: Array<{
    txid: string
    vout: number
    satoshis: number
    lockingScript: string
    topic: string
    beef?: string
  }>
  node: string
}

// Cached node status
const nodeCache: Map<string, ShipNode> = new Map()
const serviceLookupCache: Map<string, SlapService[]> = new Map()

/**
 * Check if an overlay node is healthy
 */
async function checkNodeHealth(nodeUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${nodeUrl}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get available topics from a SHIP node
 */
async function getNodeTopics(nodeUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${nodeUrl}/topics`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return []
    const data = await response.json()
    return data.topics || []
  } catch {
    return []
  }
}

/**
 * Initialize and discover overlay nodes
 */
export async function discoverOverlayNodes(): Promise<ShipNode[]> {
  const nodes: ShipNode[] = []

  for (const url of KNOWN_OVERLAY_NODES) {
    const cached = nodeCache.get(url)
    const now = Date.now()

    // Use cache if less than 5 minutes old
    if (cached && now - cached.lastChecked < 5 * 60 * 1000) {
      nodes.push(cached)
      continue
    }

    const healthy = await checkNodeHealth(url)
    const topics = healthy ? await getNodeTopics(url) : []

    const node: ShipNode = {
      url,
      topics,
      healthy,
      lastChecked: now
    }

    nodeCache.set(url, node)
    if (healthy) {
      nodes.push(node)
    }
  }

  return nodes
}

/**
 * Find nodes that support a specific topic
 */
export async function findNodesForTopic(topic: string): Promise<ShipNode[]> {
  const allNodes = await discoverOverlayNodes()
  return allNodes.filter(node =>
    node.topics.length === 0 || // Node accepts all topics
    node.topics.includes(topic)
  )
}

/**
 * SHIP: Submit a transaction to the overlay network
 *
 * This broadcasts the transaction to overlay nodes that handle
 * the specified topic, enabling topic-based routing.
 */
export async function submitToOverlay(
  rawTx: string,
  topic: string = TOPICS.DEFAULT
): Promise<SubmitResult[]> {
  const results: SubmitResult[] = []
  const nodes = await findNodesForTopic(topic)

  if (nodes.length === 0) {
    console.warn('No overlay nodes available for topic:', topic)
    return results
  }

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          rawTx,
          topics: [topic]
        }),
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const data = await response.json()
        results.push({
          txid: data.txid,
          accepted: true,
          node: node.url
        })
      } else {
        const errorText = await response.text()
        results.push({
          txid: '',
          accepted: false,
          node: node.url,
          error: errorText
        })
      }
    } catch (_error) {
      results.push({
        txid: '',
        accepted: false,
        node: node.url,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  return results
}

/**
 * SHIP: Lookup outputs by topic from overlay network
 *
 * This queries overlay nodes for outputs tagged with a specific topic.
 */
export async function lookupByTopic(
  topic: string,
  limit: number = 100,
  offset: number = 0
): Promise<LookupResult | null> {
  const nodes = await findNodesForTopic(topic)

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          topic,
          limit,
          offset
        }),
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const data = await response.json()
        return {
          outputs: data.outputs || [],
          node: node.url
        }
      }
    } catch {
      // Try next node
      continue
    }
  }

  return null
}

/**
 * SHIP: Lookup outputs by address from overlay network
 */
export async function lookupByAddress(
  address: string,
  topic?: string
): Promise<LookupResult | null> {
  const lockingScript = new P2PKH().lock(address).toHex()

  const nodes = topic
    ? await findNodesForTopic(topic)
    : await discoverOverlayNodes()

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          lockingScript,
          topic
        }),
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const data = await response.json()
        return {
          outputs: data.outputs || [],
          node: node.url
        }
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * SLAP: Lookup services for a specific topic
 *
 * Returns a list of services that handle a particular topic.
 */
export async function lookupServices(topic: string): Promise<SlapService[]> {
  // Check cache first
  const cached = serviceLookupCache.get(topic)
  if (cached) {
    return cached
  }

  const services: SlapService[] = []
  const nodes = await discoverOverlayNodes()

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/services`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ topic }),
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.services) {
          services.push(...data.services.map((s: any) => ({
            topic,
            serviceUrl: s.url || s.serviceUrl,
            description: s.description,
            publicKey: s.publicKey
          })))
        }
      }
    } catch {
      continue
    }
  }

  // Cache for 10 minutes
  serviceLookupCache.set(topic, services)
  setTimeout(() => serviceLookupCache.delete(topic), 10 * 60 * 1000)

  return services
}

/**
 * SLAP: Register a service for a topic
 *
 * Registers this wallet's service endpoint with overlay nodes.
 */
export async function registerService(
  topic: string,
  serviceUrl: string,
  publicKey: string,
  description?: string
): Promise<boolean> {
  const nodes = await discoverOverlayNodes()
  let registered = false

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          topic,
          serviceUrl,
          publicKey,
          description
        }),
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        registered = true
      }
    } catch {
      continue
    }
  }

  return registered
}

/**
 * Get BEEF (Background Evaluation Extended Format) for a transaction
 *
 * BEEF includes the transaction and its merkle proof for SPV verification.
 */
export async function getBeef(txid: string): Promise<string | null> {
  const nodes = await discoverOverlayNodes()

  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url}/beef/${txid}`, {
        method: 'GET',
        headers: { 'Accept': 'application/octet-stream' },
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const buffer = await response.arrayBuffer()
        return Buffer.from(buffer).toString('hex')
      }
    } catch {
      continue
    }
  }

  // Fallback to WhatsOnChain for merkle proof
  try {
    const response = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/proof`
    )
    if (response.ok) {
      const proof = await response.json()
      // Note: This is TSC format, not full BEEF
      return JSON.stringify(proof)
    }
  } catch {
    // Ignore
  }

  return null
}

/**
 * Broadcast transaction via overlay network AND WhatsOnChain
 *
 * This ensures maximum reliability by broadcasting to both
 * the overlay network and the traditional miners.
 */
export async function broadcastWithOverlay(
  rawTx: string,
  topic: string = TOPICS.DEFAULT
): Promise<{
  txid: string
  overlayResults: SubmitResult[]
  wocResult: { success: boolean; error?: string }
}> {
  let txid = ''

  // Submit to overlay network
  const overlayResults = await submitToOverlay(rawTx, topic)
  const successfulOverlay = overlayResults.find(r => r.accepted)
  if (successfulOverlay) {
    txid = successfulOverlay.txid
  }

  // Also broadcast to WhatsOnChain for miners
  let wocResult: { success: boolean; error?: string } = { success: false }
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawTx })
    })

    if (response.ok) {
      const result = await response.text()
      txid = txid || result.replace(/"/g, '')
      wocResult = { success: true }
    } else {
      const errorText = await response.text()
      wocResult = { success: false, error: errorText }
    }
  } catch (error) {
    wocResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }

  return { txid, overlayResults, wocResult }
}

/**
 * Subscribe to topic updates (if supported by node)
 *
 * Note: Full WebSocket implementation would be needed for real-time updates.
 * This is a placeholder for the interface.
 */
export function subscribeToTopic(
  topic: string,
  callback: (output: any) => void
): () => void {
  // Placeholder - full implementation would use WebSocket
  console.log(`Subscribed to topic: ${topic}`)

  // Poll for updates every 30 seconds as fallback
  const interval = setInterval(async () => {
    const result = await lookupByTopic(topic, 10, 0)
    if (result && result.outputs.length > 0) {
      result.outputs.forEach(output => callback(output))
    }
  }, 30000)

  // Return unsubscribe function
  return () => {
    clearInterval(interval)
    console.log(`Unsubscribed from topic: ${topic}`)
  }
}

/**
 * Get overlay network status
 */
export async function getOverlayStatus(): Promise<{
  healthy: boolean
  nodeCount: number
  nodes: ShipNode[]
}> {
  const nodes = await discoverOverlayNodes()
  const healthyNodes = nodes.filter(n => n.healthy)

  return {
    healthy: healthyNodes.length > 0,
    nodeCount: healthyNodes.length,
    nodes: healthyNodes
  }
}

/**
 * Clear all caches
 */
export function clearOverlayCache(): void {
  nodeCache.clear()
  serviceLookupCache.clear()
}
