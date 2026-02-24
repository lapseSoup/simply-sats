/**
 * BRC-100 Script Utilities
 *
 * Script building functions for BRC-100 operations.
 */

import { LockingScript } from '@bsv/sdk'

/**
 * Encode a number for use in Bitcoin script
 */
export function encodeScriptNum(num: number): string {
  // S-50: Bounds check for safe integer operations
  if (!Number.isSafeInteger(num)) {
    throw new Error(`encodeScriptNum: ${num} is not a safe integer`)
  }
  if (num < 0 || num > 0x7FFFFFFF) {
    throw new Error(`encodeScriptNum: ${num} out of valid range (0 to 2147483647)`)
  }

  if (num === 0) return '00'
  if (num >= 1 && num <= 16) return (0x50 + num).toString(16)

  const bytes: number[] = []
  let n = Math.abs(num)
  while (n > 0) {
    bytes.push(n & 0xff)
    n >>= 8
  }

  // Add sign bit if needed
  if (bytes[bytes.length - 1]! & 0x80) {
    bytes.push(num < 0 ? 0x80 : 0x00)
  } else if (num < 0) {
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! | 0x80
  }

  const len = bytes.length
  const lenHex = len.toString(16).padStart(2, '0')
  const dataHex = bytes.map(b => b.toString(16).padStart(2, '0')).join('')

  return lenHex + dataHex
}

/**
 * Create push data opcode for hex data
 */
export function pushData(hexData: string): string {
  const len = hexData.length / 2
  if (len < 0x4c) {
    return len.toString(16).padStart(2, '0') + hexData
  } else if (len <= 0xff) {
    return '4c' + len.toString(16).padStart(2, '0') + hexData
  } else if (len <= 0xffff) {
    return '4d' + len.toString(16).padStart(4, '0').match(/.{2}/g)!.reverse().join('') + hexData
  } else {
    return '4e' + len.toString(16).padStart(8, '0').match(/.{2}/g)!.reverse().join('') + hexData
  }
}

/**
 * Create a CLTV time-locked locking script
 */
export function createCLTVLockingScript(pubKeyHex: string, lockTime: number): string {
  const lockTimeHex = encodeScriptNum(lockTime)
  // lockTimeHex + OP_CHECKLOCKTIMEVERIFY + OP_DROP + pubkey_push + OP_CHECKSIG
  return lockTimeHex + 'b175' + pushData(pubKeyHex) + 'ac'
}

/**
 * Create OP_RETURN script for Wrootz protocol data
 */
export function createWrootzOpReturn(action: string, data: string): string {
  let script = '6a00' // OP_RETURN OP_FALSE
  script += pushData(Buffer.from('wrootz').toString('hex'))
  script += pushData(Buffer.from(action).toString('hex'))
  script += pushData(Buffer.from(data).toString('hex'))
  return script
}

/**
 * Convert a hex string to a proper LockingScript object
 * Handles all BSV SDK requirements including toHex() and toUint8Array()
 */
export function convertToLockingScript(scriptHex: string): LockingScript {
  const scriptBytes = new Uint8Array(
    scriptHex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  )
  // Convert Uint8Array to number[] for BSV SDK
  const bytesArray: number[] = Array.from(scriptBytes)
  return LockingScript.fromBinary(bytesArray)
}

/**
 * Create a minimal LockingScript-compatible object from hex
 * Used for Transaction output construction where we only need toHex()
 */
export function createScriptFromHex(scriptHex: string): LockingScript {
  return convertToLockingScript(scriptHex)
}
