/**
 * Lock operations — barrel re-export
 *
 * A-19: This file was the original monolith (839 LOC). It has been split into:
 *   - lockCreation.ts  — lock creation, OP_PUSH_TX construction, Wrootz OP_RETURN
 *   - lockUnlocking.ts — unlock, generateUnlockTxHex, getCurrentBlockHeight
 *   - lockQueries.ts   — detectLockedUtxos, isUtxoUnspent, isLockMarkedUnlocked
 *
 * This barrel re-exports everything for backward compatibility.
 */

// Lock creation
export {
  lockBSV,
  parseTimelockScript,
  hex2Int,
  getTimelockScriptSize
} from './lockCreation'
export type { ParsedTimelockScript } from './lockCreation'

// Lock unlocking
export {
  unlockBSV,
  getCurrentBlockHeight,
  generateUnlockTxHex
} from './lockUnlocking'

// Lock queries
export { detectLockedUtxos } from './lockQueries'
