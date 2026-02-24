/**
 * BRC-100 Script Utilities Tests
 *
 * Tests for script building functions.
 */

import { describe, it, expect } from 'vitest'
import {
  encodeScriptNum,
  pushData,
  createCLTVLockingScript,
  createWrootzOpReturn,
  convertToLockingScript,
  createScriptFromHex
} from './script'

describe('encodeScriptNum', () => {
  it('should encode zero', () => {
    expect(encodeScriptNum(0)).toBe('00')
  })

  it('should encode small positive numbers (1-16) as OP_N', () => {
    // OP_1 through OP_16 are 0x51 through 0x60
    expect(encodeScriptNum(1)).toBe('51')
    expect(encodeScriptNum(5)).toBe('55')
    expect(encodeScriptNum(10)).toBe('5a')
    expect(encodeScriptNum(16)).toBe('60')
  })

  it('should encode numbers > 16 as push data', () => {
    // 17 = 0x11, single byte
    expect(encodeScriptNum(17)).toBe('0111')
    // 127 = 0x7f, single byte
    expect(encodeScriptNum(127)).toBe('017f')
    // 128 needs extra byte for sign
    expect(encodeScriptNum(128)).toBe('028000')
    // 255 = 0xff, needs sign byte
    expect(encodeScriptNum(255)).toBe('02ff00')
    // 256 = 0x0100, two bytes
    expect(encodeScriptNum(256)).toBe('020001')
  })

  it('should encode block heights correctly', () => {
    // Block height 800000 (typical mainnet)
    // 800000 = 0x0C3500 in little-endian = 00 35 0c
    const result = encodeScriptNum(800000)
    expect(result).toBe('0300350c')

    // Block height 850000
    // 850000 = 0x0CF850 in little-endian = 50 f8 0c
    const result2 = encodeScriptNum(850000)
    expect(result2).toBe('0350f80c')
  })

  it('should reject negative numbers', () => {
    // S-50: Negative numbers are out of valid range for CLTV lock times
    expect(() => encodeScriptNum(-1)).toThrow('out of valid range')
  })
})

describe('pushData', () => {
  it('should push small data (< 76 bytes) with single-byte length', () => {
    // 4 bytes of data
    const data = '01020304'
    expect(pushData(data)).toBe('0401020304')
  })

  it('should push empty data', () => {
    expect(pushData('')).toBe('00')
  })

  it('should push 33-byte public key', () => {
    // Typical compressed public key (33 bytes)
    const pubKey = '02' + '1234567890abcdef'.repeat(4)
    const result = pushData(pubKey)
    expect(result.startsWith('21')).toBe(true) // 0x21 = 33
    expect(result.slice(2)).toBe(pubKey)
  })

  it('should handle medium data (76-255 bytes) with OP_PUSHDATA1', () => {
    // Create 100 bytes of data (200 hex chars)
    const data = 'ab'.repeat(100)
    const result = pushData(data)
    // OP_PUSHDATA1 = 0x4c, length = 0x64 (100)
    expect(result.startsWith('4c64')).toBe(true)
    expect(result.slice(4)).toBe(data)
  })

  it('should handle large data (256-65535 bytes) with OP_PUSHDATA2', () => {
    // Create 300 bytes of data (600 hex chars)
    const data = 'cd'.repeat(300)
    const result = pushData(data)
    // OP_PUSHDATA2 = 0x4d, length = 0x012c (300) in little-endian = 2c 01
    expect(result.startsWith('4d2c01')).toBe(true)
    expect(result.slice(6)).toBe(data)
  })
})

describe('createCLTVLockingScript', () => {
  it('should create a valid CLTV script', () => {
    const pubKeyHex = '02' + '0123456789abcdef'.repeat(4)
    const lockTime = 850000

    const script = createCLTVLockingScript(pubKeyHex, lockTime)

    // Should contain:
    // - locktime encoding
    // - OP_CHECKLOCKTIMEVERIFY (0xb1)
    // - OP_DROP (0x75)
    // - pushed pubkey
    // - OP_CHECKSIG (0xac)
    expect(script).toContain('b175')
    expect(script).toContain('ac')
    expect(script).toContain(pubKeyHex)
  })

  it('should create different scripts for different lock times', () => {
    const pubKeyHex = '02' + '0123456789abcdef'.repeat(4)

    const script1 = createCLTVLockingScript(pubKeyHex, 800000)
    const script2 = createCLTVLockingScript(pubKeyHex, 850000)

    expect(script1).not.toBe(script2)
  })
})

describe('createWrootzOpReturn', () => {
  it('should create OP_RETURN script with Wrootz protocol', () => {
    const script = createWrootzOpReturn('lock', 'abc123_0')

    // Should start with OP_RETURN OP_FALSE (6a00)
    expect(script.startsWith('6a00')).toBe(true)

    // Should contain 'wrootz' in hex
    const wrootzHex = Buffer.from('wrootz').toString('hex')
    expect(script).toContain(wrootzHex)

    // Should contain action 'lock' in hex
    const lockHex = Buffer.from('lock').toString('hex')
    expect(script).toContain(lockHex)

    // Should contain data
    const dataHex = Buffer.from('abc123_0').toString('hex')
    expect(script).toContain(dataHex)
  })

  it('should handle different actions', () => {
    const lockScript = createWrootzOpReturn('lock', 'data')
    const unlockScript = createWrootzOpReturn('unlock', 'data')

    expect(lockScript).not.toBe(unlockScript)
    expect(lockScript).toContain(Buffer.from('lock').toString('hex'))
    expect(unlockScript).toContain(Buffer.from('unlock').toString('hex'))
  })
})

describe('convertToLockingScript', () => {
  it('should convert hex string to LockingScript', () => {
    // Simple P2PKH script (OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG)
    const scriptHex = '76a914' + '00'.repeat(20) + '88ac'

    const lockingScript = convertToLockingScript(scriptHex)

    expect(lockingScript).toBeDefined()
    expect(typeof lockingScript.toHex).toBe('function')
    expect(lockingScript.toHex()).toBe(scriptHex)
  })

  it('should handle OP_RETURN scripts', () => {
    const scriptHex = '6a' + '0568656c6c6f' // OP_RETURN + push 'hello'

    const lockingScript = convertToLockingScript(scriptHex)

    expect(lockingScript.toHex()).toBe(scriptHex)
  })
})

describe('createScriptFromHex', () => {
  it('should create LockingScript from hex (alias for convertToLockingScript)', () => {
    const scriptHex = '76a914' + 'ab'.repeat(20) + '88ac'

    const script1 = createScriptFromHex(scriptHex)
    const script2 = convertToLockingScript(scriptHex)

    expect(script1.toHex()).toBe(script2.toHex())
  })
})
