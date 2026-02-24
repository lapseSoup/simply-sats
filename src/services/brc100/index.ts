/**
 * BRC-100 Service Module
 *
 * Re-exports all BRC-100 functionality for backward compatibility.
 * The module has been split into focused files:
 * - types.ts: Type definitions
 * - RequestManager.ts: Pending request management
 * - state.ts: Wallet keys state
 * - signing.ts: Signature operations
 * - cryptography.ts: Encrypt/decrypt
 * - script.ts: Script building utilities
 * - utils.ts: Helper functions
 * - outputs.ts: Output resolution & discovery
 * - locks.ts: Lock management
 * - listener.ts: HTTP server event listener
 * - certificates.ts: Certificate operations
 * - actions.ts: Request handling, approval/rejection, tx building
 */

// Re-export types
export type {
  BRC100RequestType,
  BRC100Request,
  BRC100Response,
  SignatureRequest,
  CreateActionRequest,
  ListOutputsParams,
  LockBSVParams,
  UnlockBSVParams,
  GetPublicKeyParams,
  EncryptDecryptParams,
  GetTaggedKeysParams,
  LockedOutput,
  DiscoveredOutput,
  ListedOutput
} from './types'

export {
  BRC100_REQUEST_TYPES,
  isValidBRC100RequestType,
  getParams
} from './types'

// Re-export RequestManager
export { RequestManager, getRequestManager, resetRequestManager } from './RequestManager'

// Re-export state management
export { setWalletKeys, getWalletKeys, hasWalletKeys, assertKeysMatchAccount } from './state'

// Re-export signing operations
export { signMessage, signData, verifySignature, verifyDataSignature } from './signing'

// Re-export cryptography operations
export { encryptECIES, decryptECIES } from './cryptography'

// Re-export script utilities
export {
  encodeScriptNum,
  pushData,
  createCLTVLockingScript,
  createWrootzOpReturn,
  convertToLockingScript
} from './script'

// Re-export utility functions
export {
  getBlockHeight,
  generateRequestId,
  formatIdentityKey,
  getIdentityKeyForApp,
  isInscriptionTransaction
} from './utils'

// Re-export output resolution & discovery
export {
  resolvePublicKey,
  resolveListOutputs,
  discoverByIdentityKey,
  discoverByAttributes,
  formatLockedOutput
} from './outputs'

// Re-export lock management
export {
  getLocks,
  saveLockToDatabase,
  removeLockFromDatabase,
  createLockTransaction
} from './locks'

// Re-export HTTP server listener
export { setupHttpServerListener } from './listener'

// Re-export certificate operations
export {
  acquireCertificate,
  listCertificates,
  proveCertificate
} from './certificates'

// Re-export actions
export {
  handleBRC100Request,
  approveRequest,
  rejectRequest
} from './actions'

// Re-export handler execution
export { executeApprovedRequest } from './handlers'
