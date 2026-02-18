/**
 * BRC-100 Service — Thin Orchestration Layer
 *
 * All logic has been extracted into focused submodules under ./brc100/.
 * This file re-exports everything for backward compatibility, and provides
 * the requestManager instance setup, pendingRequests legacy shim, and
 * the getNetworkStatus() convenience function.
 *
 * Submodules:
 *  - types.ts:         Type definitions & validation
 *  - RequestManager.ts: Pending request queue
 *  - state.ts:         Wallet keys state
 *  - signing.ts:       Signature operations
 *  - cryptography.ts:  Encrypt/decrypt (ECIES)
 *  - script.ts:        Script building utilities
 *  - utils.ts:         Helper functions
 *  - outputs.ts:       Output resolution & discovery
 *  - locks.ts:         Lock management
 *  - listener.ts:      HTTP server event listener
 *  - certificates.ts:  Certificate operations
 *  - actions.ts:       Request handling, approval/rejection, tx building
 */

import { getCurrentBlockHeight } from './sync'
import { getOverlayStatus } from './overlay'
import { getRequestManager } from './brc100/RequestManager'
import type { BRC100Request } from './brc100/types'

// ─── Re-exports from submodules ──────────────────────────────────────────────

// Types
export {
  BRC100_REQUEST_TYPES,
  isValidBRC100RequestType,
  getParams
} from './brc100/types'
export type {
  BRC100Request,
  BRC100Response,
  BRC100RequestType,
  SignatureRequest,
  CreateActionRequest,
  ListOutputsParams,
  LockBSVParams,
  UnlockBSVParams,
  GetPublicKeyParams,
  EncryptDecryptParams,
  GetTaggedKeysParams,
  LockedOutput,
  DiscoveredOutput
} from './brc100/types'

// State management
export { setWalletKeys, getWalletKeys, assertKeysMatchAccount } from './brc100/state'

// Signing
export { signMessage, signData, verifySignature, verifyDataSignature } from './brc100/signing'

// Script utilities
export { createCLTVLockingScript } from './brc100/script'

// Utility functions
export {
  getBlockHeight,
  generateRequestId,
  formatIdentityKey,
  getIdentityKeyForApp
} from './brc100/utils'

// Outputs & discovery
export { resolvePublicKey, resolveListOutputs, discoverByIdentityKey, discoverByAttributes } from './brc100/outputs'

// Lock management
export { getLocks, saveLockToDatabase, removeLockFromDatabase, createLockTransaction } from './brc100/locks'

// HTTP server listener
export { setupHttpServerListener } from './brc100/listener'

// Certificates
export { acquireCertificate, listCertificates, proveCertificate } from './brc100/certificates'

// Actions — request handling, approval, rejection
export { handleBRC100Request, approveRequest, rejectRequest } from './brc100/actions'

// Overlay re-exports
export {
  getOverlayStatus,
  lookupByTopic,
  lookupByAddress,
  TOPICS
} from './overlay'

// ─── Request Manager helpers ─────────────────────────────────────────────────

export function setRequestHandler(callback: (request: BRC100Request) => void) {
  getRequestManager().setRequestHandler(callback)
}

export function getPendingRequests(): BRC100Request[] {
  return getRequestManager().getAll()
}

// ─── Network status ──────────────────────────────────────────────────────────

export async function getNetworkStatus(): Promise<{
  network: string
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}> {
  const [height, overlayStatus] = await Promise.all([
    getCurrentBlockHeight(),
    getOverlayStatus()
  ])

  return {
    network: 'mainnet',
    blockHeight: height,
    overlayHealthy: overlayStatus.healthy,
    overlayNodeCount: overlayStatus.nodeCount
  }
}
