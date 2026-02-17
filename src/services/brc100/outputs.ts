/**
 * BRC-100 Output Resolution & Discovery
 *
 * Functions for resolving output lists from the database
 * and discovering outputs by identity key or attributes.
 */

import type { WalletKeys } from '../wallet'
import {
  getSpendableUTXOs,
  getUTXOsByBasket,
  getLocks as getLocksFromDB
} from '../database'
import type { Lock, UTXO } from '../database/types'
import { BASKETS, getCurrentBlockHeight } from '../sync'
import { lookupByTopic, TOPICS } from '../overlay'
import { brc100Logger } from '../logger'
import type { DiscoveredOutput, ListedOutput, LockedOutput } from './types'

/** Map a DB lock record to the canonical LockedOutput shape */
export function formatLockedOutput(lock: Lock & { utxo: UTXO }, currentHeight: number): LockedOutput {
  return {
    outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
    txid: lock.utxo.txid,
    vout: lock.utxo.vout,
    satoshis: lock.utxo.satoshis,
    unlockBlock: lock.unlockBlock,
    tags: [
      `unlock_${lock.unlockBlock}`,
      ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])
    ],
    spendable: currentHeight >= lock.unlockBlock,
    blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
  }
}

/** Resolve the correct public key based on request params */
export function resolvePublicKey(keys: WalletKeys, params: { identityKey?: boolean; forOrdinals?: boolean }): string {
  if (params.identityKey) return keys.identityPubKey
  if (params.forOrdinals) return keys.ordPubKey
  return keys.walletPubKey
}

/** Resolve listOutputs response from database */
export async function resolveListOutputs(params: {
  basket?: string
  includeSpent?: boolean
  includeTags?: string[]
  limit?: number
  offset?: number
}): Promise<{ outputs: ListedOutput[]; totalOutputs: number }> {
  const basket = params.basket
  const includeSpent = params.includeSpent || false
  const includeTags = params.includeTags || []
  const limit = params.limit || 100
  const offset = params.offset || 0

  const currentHeight = await getCurrentBlockHeight()

  if (basket === 'wrootz_locks' || basket === 'locks') {
    const locks = await getLocksFromDB(currentHeight)
    const outputs = locks.map(lock => {
      const formatted = formatLockedOutput(lock, currentHeight)
      return {
        ...formatted,
        lockingScript: lock.utxo.lockingScript,
        customInstructions: JSON.stringify({
          unlockBlock: lock.unlockBlock,
          blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
        })
      }
    })
    return { outputs, totalOutputs: outputs.length }
  }

  // Map basket names
  let dbBasket: string = basket || BASKETS.DEFAULT
  if (basket === 'ordinals') dbBasket = BASKETS.ORDINALS
  else if (basket === 'identity') dbBasket = BASKETS.IDENTITY
  else if (!basket || basket === 'default') dbBasket = BASKETS.DEFAULT

  const utxos = await getUTXOsByBasket(dbBasket, !includeSpent)

  let filteredUtxos = utxos
  if (includeTags.length > 0) {
    filteredUtxos = utxos.filter(u =>
      u.tags && includeTags.some((tag: string) => u.tags?.includes(tag))
    )
  }

  const paginatedUtxos = filteredUtxos.slice(offset, offset + limit)

  const outputs = paginatedUtxos.map(u => ({
    outpoint: `${u.txid}.${u.vout}`,
    satoshis: u.satoshis,
    lockingScript: u.lockingScript,
    tags: u.tags || [],
    spendable: u.spendable
  }))

  return { outputs, totalOutputs: filteredUtxos.length }
}

// BRC-100 discoverByIdentityKey - find outputs belonging to an identity
export async function discoverByIdentityKey(args: {
  identityKey: string
  limit?: number
  offset?: number
}): Promise<{
  outputs: DiscoveredOutput[]
  totalOutputs: number
}> {
  // First check local database
  try {
    const utxos = await getUTXOsByBasket(BASKETS.IDENTITY, true)
    const localOutputs = utxos.map(u => ({
      outpoint: `${u.txid}.${u.vout}`,
      satoshis: u.satoshis,
      lockingScript: u.lockingScript,
      tags: u.tags || []
    }))

    // Also try overlay network for discovery
    try {
      const overlayResult = await lookupByTopic(TOPICS.DEFAULT, args.limit || 100, args.offset || 0)
      if (overlayResult && overlayResult.outputs.length > 0) {
        // Merge with local, avoiding duplicates
        const existingOutpoints = new Set(localOutputs.map(o => o.outpoint))
        for (const output of overlayResult.outputs) {
          const outpoint = `${output.txid}.${output.vout}`
          if (!existingOutpoints.has(outpoint)) {
            localOutputs.push({
              outpoint,
              satoshis: output.satoshis,
              lockingScript: output.lockingScript,
              tags: []
            })
          }
        }
      }
    } catch (overlayError) {
      brc100Logger.warn('Overlay lookup failed', undefined, overlayError instanceof Error ? overlayError : undefined)
    }

    return {
      outputs: localOutputs,
      totalOutputs: localOutputs.length
    }
  } catch {
    return { outputs: [], totalOutputs: 0 }
  }
}

// BRC-100 discoverByAttributes - find outputs by tags/attributes
export async function discoverByAttributes(args: {
  attributes: Record<string, string>
  limit?: number
  offset?: number
}): Promise<{
  outputs: DiscoveredOutput[]
  totalOutputs: number
}> {
  // Search across all baskets for matching tags
  try {
    const allUtxos = await getSpendableUTXOs()
    const matchingUtxos = allUtxos.filter(u => {
      if (!u.tags) return false
      // Check if any attribute matches a tag
      return Object.values(args.attributes).some(value =>
        u.tags!.includes(value)
      )
    })

    const limit = args.limit || 100
    const offset = args.offset || 0

    return {
      outputs: matchingUtxos.slice(offset, offset + limit).map(u => ({
        outpoint: `${u.txid}.${u.vout}`,
        satoshis: u.satoshis,
        lockingScript: u.lockingScript,
        tags: u.tags || []
      })),
      totalOutputs: matchingUtxos.length
    }
  } catch {
    return { outputs: [], totalOutputs: 0 }
  }
}
