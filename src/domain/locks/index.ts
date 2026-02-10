/**
 * Locks Domain - Timelock script building, parsing, and inspection
 */

export {
  // Constants
  LOCKUP_PREFIX,
  LOCKUP_SUFFIX,
  TIMELOCK_SCRIPT_SIGNATURE,

  // Byte conversion utilities
  int2Hex,
  hex2Int,

  // Script building
  createTimelockScript,
  getTimelockScriptSize,

  // Script parsing
  parseTimelockScript,
  isTimelockScript,

  // Key utilities
  publicKeyToHash
} from './timelockScript'

export type { ParsedTimelockScript } from './timelockScript'
