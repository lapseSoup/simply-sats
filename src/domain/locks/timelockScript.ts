/**
 * Pure Timelock Script Functions
 *
 * This module provides pure functions for building, parsing, and inspecting
 * OP_PUSH_TX timelock scripts used by the Wrootz/bsv-lock protocol.
 * All functions are deterministic with no side effects.
 *
 * The locking script uses an sCrypt-compiled OP_PUSH_TX technique that
 * validates the transaction preimage on-chain, checking that nLockTime
 * is greater than or equal to the specified block height.
 *
 * Based on jdh7190's bsv-lock: https://github.com/jdh7190/bsv-lock
 *
 * @module domain/locks/timelockScript
 */

import { Script, PublicKey } from '@bsv/sdk'

// ============================================
// Script Constants
// ============================================

/**
 * sCrypt-compiled timelock script prefix.
 * Contains the precompiled verification logic that precedes the
 * public key hash and nLockTime parameters.
 */
export const LOCKUP_PREFIX = `97dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026 02ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382 1008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c 0 0`

/**
 * sCrypt-compiled timelock script suffix.
 * Contains the on-chain validation logic that follows the
 * public key hash and nLockTime parameters.
 */
export const LOCKUP_SUFFIX = `OP_NOP 0 OP_PICK 0065cd1d OP_LESSTHAN OP_VERIFY 0 OP_PICK OP_4 OP_ROLL OP_DROP OP_3 OP_ROLL OP_3 OP_ROLL OP_3 OP_ROLL OP_1 OP_PICK OP_3 OP_ROLL OP_DROP OP_2 OP_ROLL OP_2 OP_ROLL OP_DROP OP_DROP OP_NOP OP_5 OP_PICK 41 OP_NOP OP_1 OP_PICK OP_7 OP_PICK OP_7 OP_PICK 0ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800 6c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce0810 OP_9 OP_PICK OP_6 OP_PICK OP_NOP OP_6 OP_PICK OP_HASH256 0 OP_PICK OP_NOP 0 OP_PICK OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_7 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_NOP OP_3 OP_PICK OP_6 OP_PICK OP_4 OP_PICK OP_7 OP_PICK OP_MUL OP_ADD OP_MUL 414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00 OP_1 OP_PICK OP_1 OP_PICK OP_NOP OP_1 OP_PICK OP_1 OP_PICK OP_MOD 0 OP_PICK 0 OP_LESSTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_ADD OP_ELSE 0 OP_PICK OP_ENDIF OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_1 OP_PICK OP_1 OP_PICK OP_2 OP_DIV OP_GREATERTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_SUB OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_ENDIF OP_3 OP_PICK OP_SIZE OP_NIP OP_2 OP_PICK OP_SIZE OP_NIP OP_3 OP_PICK 20 OP_NUM2BIN OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 20 OP_2 OP_PICK OP_SUB OP_SPLIT OP_NIP OP_4 OP_3 OP_PICK OP_ADD OP_2 OP_PICK OP_ADD 30 OP_1 OP_PICK OP_CAT OP_2 OP_CAT OP_4 OP_PICK OP_CAT OP_8 OP_PICK OP_CAT OP_2 OP_CAT OP_3 OP_PICK OP_CAT OP_2 OP_PICK OP_CAT OP_7 OP_PICK OP_CAT 0 OP_PICK OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP 0 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP 0065cd1d OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK 28 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK 2c OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP ffffffff00 OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_PICK OP_GREATERTHANOREQUAL OP_VERIFY OP_6 OP_PICK OP_HASH160 OP_1 OP_PICK OP_EQUAL OP_VERIFY OP_7 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP`

/**
 * Hex signature of a timelock script.
 * The first 33 bytes (push opcode + 32-byte hash) from the compiled script.
 * Used to identify whether a script hex is a timelock script.
 */
export const TIMELOCK_SCRIPT_SIGNATURE = '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026'

// ============================================
// Byte Conversion Utilities
// ============================================

/**
 * Convert a non-negative integer to little-endian hex string.
 *
 * Used for encoding nLockTime values into script format.
 *
 * @param n - Non-negative integer to convert
 * @returns Little-endian hex string (e.g., 500000 -> "20a107")
 *
 * @example
 * ```typescript
 * int2Hex(0)       // "00"
 * int2Hex(255)     // "ff"
 * int2Hex(500000)  // "20a107"
 * ```
 */
export function int2Hex(n: number): string {
  if (n === 0) return '00'
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  // Reverse bytes for little-endian
  const bytes = hex.match(/.{2}/g) || []
  return bytes.reverse().join('')
}

/**
 * Convert a little-endian hex string to a non-negative integer.
 *
 * Used for decoding nLockTime values from script format.
 *
 * @param hex - Little-endian hex string
 * @returns Decoded integer
 *
 * @example
 * ```typescript
 * hex2Int("00")      // 0
 * hex2Int("ff")      // 255
 * hex2Int("20a107")  // 500000
 * ```
 */
export function hex2Int(hex: string): number {
  const bytes = hex.match(/.{2}/g) || []
  const reversed = bytes.reverse().join('')
  return parseInt(reversed, 16)
}

// ============================================
// Script Building
// ============================================

/**
 * Result of parsing a timelock script.
 */
export interface ParsedTimelockScript {
  /** Block height at which the locked funds become spendable */
  unlockBlock: number
  /** Hash160 of the public key that can spend after unlock */
  publicKeyHash: string
}

/**
 * Create the OP_PUSH_TX timelock locking script.
 *
 * This script validates the transaction preimage on-chain and checks
 * that nLockTime >= the specified block height.
 *
 * @param publicKeyHash - Hash160 of the public key (40-char hex string)
 * @param blockHeight - Block height at which the funds can be unlocked
 * @returns Compiled Script object
 *
 * @example
 * ```typescript
 * const script = createTimelockScript('a1b2c3...', 850000)
 * const scriptHex = script.toHex()
 * ```
 */
export function createTimelockScript(publicKeyHash: string, blockHeight: number): Script {
  const nLockTimeHex = int2Hex(blockHeight)
  const scriptASM = `${LOCKUP_PREFIX} ${publicKeyHash} ${nLockTimeHex} ${LOCKUP_SUFFIX}`
  return Script.fromASM(scriptASM)
}

/**
 * Get the exact byte size of a timelock script for a given public key and block height.
 *
 * This allows accurate fee calculation before creating the transaction,
 * avoiding the need to build the full script just to measure it.
 *
 * @param publicKeyHex - Compressed public key hex (66-char string)
 * @param blockHeight - Target block height for the lock
 * @returns Script size in bytes
 *
 * @example
 * ```typescript
 * const size = getTimelockScriptSize(wallet.walletPubKey, 850000)
 * const fee = calculateLockFee(1, size)
 * ```
 */
export function getTimelockScriptSize(publicKeyHex: string, blockHeight: number): number {
  const publicKey = PublicKey.fromString(publicKeyHex)
  const publicKeyHashBytes = publicKey.toHash() as number[]
  const publicKeyHashHex = publicKeyHashBytes.map(b => b.toString(16).padStart(2, '0')).join('')
  const script = createTimelockScript(publicKeyHashHex, blockHeight)
  return script.toBinary().length
}

// ============================================
// Script Parsing
// ============================================

/**
 * Parse a timelock script hex to extract the unlock block height and public key hash.
 *
 * Performs structural validation of the script format to ensure it matches
 * the expected sCrypt-compiled timelock pattern.
 *
 * @param scriptHex - Hex-encoded locking script
 * @returns Parsed script data, or null if the script is not a recognized timelock
 *
 * @example
 * ```typescript
 * const parsed = parseTimelockScript(utxo.lockingScript)
 * if (parsed) {
 *   console.log(`Unlocks at block ${parsed.unlockBlock}`)
 *   console.log(`Owner PKH: ${parsed.publicKeyHash}`)
 * }
 * ```
 */
export function parseTimelockScript(scriptHex: string): ParsedTimelockScript | null {
  // Check if script starts with our timelock signature
  if (!scriptHex.startsWith(TIMELOCK_SCRIPT_SIGNATURE)) {
    return null
  }

  try {
    const prefixHexLen = 204

    // After prefix comes: 0x14 (1 byte) + pkh (20 bytes) = 42 hex chars
    const pkhStart = prefixHexLen
    const pkhPushByte = scriptHex.substring(pkhStart, pkhStart + 2)

    if (pkhPushByte !== '14') {
      return null
    }

    const publicKeyHash = scriptHex.substring(pkhStart + 2, pkhStart + 2 + 40)

    // After pkh comes the nLockTime push
    const nLockTimeStart = pkhStart + 42
    const nLockTimePushByte = scriptHex.substring(nLockTimeStart, nLockTimeStart + 2)
    const pushLen = parseInt(nLockTimePushByte, 16)

    if (pushLen > 4) {
      return null
    }

    const nLockTimeHex = scriptHex.substring(nLockTimeStart + 2, nLockTimeStart + 2 + pushLen * 2)

    // Convert little-endian hex to number
    const bytes = nLockTimeHex.match(/.{2}/g) || []
    const unlockBlock = parseInt(bytes.reverse().join(''), 16)

    return { unlockBlock, publicKeyHash }
  } catch {
    return null
  }
}

/**
 * Check if a script hex represents a timelock script.
 *
 * Quick check using only the script signature prefix,
 * without fully parsing the script contents.
 *
 * @param scriptHex - Hex-encoded script to check
 * @returns True if the script starts with the timelock signature
 */
export function isTimelockScript(scriptHex: string): boolean {
  return scriptHex.startsWith(TIMELOCK_SCRIPT_SIGNATURE)
}

/**
 * Compute the public key hash (Hash160) hex from a compressed public key hex.
 *
 * Useful for comparing a wallet's public key against a parsed timelock
 * script's publicKeyHash to determine ownership.
 *
 * @param publicKeyHex - Compressed public key hex (66-char string)
 * @returns Hash160 of the public key as a 40-char hex string
 *
 * @example
 * ```typescript
 * const pkh = publicKeyToHash(wallet.walletPubKey)
 * const parsed = parseTimelockScript(scriptHex)
 * const isOurs = parsed?.publicKeyHash === pkh
 * ```
 */
export function publicKeyToHash(publicKeyHex: string): string {
  const publicKey = PublicKey.fromString(publicKeyHex)
  const hashBytes = publicKey.toHash() as number[]
  return hashBytes.map(b => b.toString(16).padStart(2, '0')).join('')
}
