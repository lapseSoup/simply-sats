/**
 * Pure TypeScript P2PKH Transaction Builder
 *
 * Builds and signs BSV P2PKH transactions without any Rust/Tauri dependency.
 * Uses @noble/secp256k1 for ECDSA signing.
 *
 * Transaction format follows Bitcoin SV specification with SIGHASH_FORKID.
 *
 * @module platform/crypto/transaction
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 as sha256Hash } from '@noble/hashes/sha2.js'
import { base58check } from '@scure/base'
import {
  wifToPrivateKey,
  privateKeyToPublicKey,
  privateKeyToAddress,
  doubleSha256,
  bytesToHex,
  hexToBytes,
} from './keys'

const b58check = base58check(sha256Hash)
import { calculateTxFee } from '../../domain/transaction/fees'
import type {
  BuildP2PKHTxParams,
  BuildMultiKeyP2PKHTxParams,
  BuildConsolidationTxParams,
  BuildMultiOutputP2PKHTxParams,
  BuiltTransaction,
  BuiltConsolidationTransaction,
  BuiltMultiOutputTransaction,
} from '../types'

// ============================================
// Constants
// ============================================

/** SIGHASH_ALL | SIGHASH_FORKID (BSV) */
const SIGHASH_ALL_FORKID = 0x41

/** Transaction version */
const TX_VERSION = 1

/** Default sequence number */
const SEQUENCE = 0xffffffff

/** Locktime */
const LOCKTIME = 0

// ============================================
// Serialization Helpers
// ============================================

function writeUint32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, value, true)
  return buf
}

function writeUint64LE(value: number): Uint8Array {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  // Split into two 32-bit writes to avoid BigInt
  view.setUint32(0, value & 0xffffffff, true)
  view.setUint32(4, Math.floor(value / 0x100000000), true)
  return buf
}

function writeVarInt(value: number): Uint8Array {
  if (value < 0xfd) {
    return new Uint8Array([value])
  } else if (value <= 0xffff) {
    const buf = new Uint8Array(3)
    buf[0] = 0xfd
    new DataView(buf.buffer).setUint16(1, value, true)
    return buf
  } else if (value <= 0xffffffff) {
    const buf = new Uint8Array(5)
    buf[0] = 0xfe
    new DataView(buf.buffer).setUint32(1, value, true)
    return buf
  }
  throw new Error('VarInt too large')
}

/** Reverse byte order (for txid display) */
function reverseBytes(bytes: Uint8Array): Uint8Array {
  const reversed = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    reversed[i] = bytes[bytes.length - 1 - i]!
  }
  return reversed
}

/** Concatenate multiple Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ============================================
// P2PKH Script Construction
// ============================================

/**
 * Create a P2PKH locking script from a public key hash.
 * OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
 */
function p2pkhLockingScript(pubKeyHash: Uint8Array): Uint8Array {
  return concat(
    new Uint8Array([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    pubKeyHash,
    new Uint8Array([0x88, 0xac])         // OP_EQUALVERIFY OP_CHECKSIG
  )
}

/**
 * Create a P2PKH locking script from an address.
 */
function addressToLockingScript(address: string): Uint8Array {
  const decoded = b58check.decode(address)
  // decoded = [version(1)] [hash160(20)]
  const pubKeyHash = decoded.slice(1, 21)
  return p2pkhLockingScript(pubKeyHash)
}

/**
 * Create a P2PKH unlocking script (scriptSig).
 * [sig_length] [DER_signature] [hashtype] [pubkey_length] [compressed_pubkey]
 */
function p2pkhUnlockingScript(signature: Uint8Array, pubKey: Uint8Array): Uint8Array {
  const sigWithHashType = concat(signature, new Uint8Array([SIGHASH_ALL_FORKID]))
  return concat(
    writeVarInt(sigWithHashType.length),
    sigWithHashType,
    writeVarInt(pubKey.length),
    pubKey
  )
}

// ============================================
// BIP-143 Sighash (BSV with FORKID)
// ============================================

interface SighashInput {
  txid: string       // hex, internal byte order
  vout: number
  script: Uint8Array // locking script of the UTXO being spent
  satoshis: number
}

/**
 * Compute BIP-143 sighash for BSV (SIGHASH_ALL | SIGHASH_FORKID).
 *
 * BSV uses BIP-143 segwit-style sighash even though it doesn't have segwit.
 * This provides O(1) signature verification per input.
 */
function computeSighash(
  inputs: SighashInput[],
  outputs: Uint8Array, // pre-serialized outputs
  inputIndex: number,
  hashType: number
): Uint8Array {
  // 1. hashPrevouts = hash256(prevout1 || prevout2 || ...)
  const prevouts = concat(
    ...inputs.map(inp => concat(
      reverseBytes(hexToBytes(inp.txid)), // txid is stored reversed
      writeUint32LE(inp.vout)
    ))
  )
  const hashPrevouts = doubleSha256(prevouts)

  // 2. hashSequence = hash256(sequence1 || sequence2 || ...)
  const sequences = concat(
    ...inputs.map(() => writeUint32LE(SEQUENCE))
  )
  const hashSequence = doubleSha256(sequences)

  // 3. hashOutputs = hash256(output1 || output2 || ...)
  const hashOutputs = doubleSha256(outputs)

  // 4. Assemble preimage
  const input = inputs[inputIndex]!
  const scriptCode = concat(writeVarInt(input.script.length), input.script)

  const preimage = concat(
    writeUint32LE(TX_VERSION),            // nVersion
    hashPrevouts,                          // hashPrevouts
    hashSequence,                          // hashSequence
    reverseBytes(hexToBytes(input.txid)),  // outpoint txid
    writeUint32LE(input.vout),             // outpoint index
    scriptCode,                            // scriptCode
    writeUint64LE(input.satoshis),         // value
    writeUint32LE(SEQUENCE),               // nSequence
    hashOutputs,                           // hashOutputs
    writeUint32LE(LOCKTIME),               // nLocktime
    writeUint32LE(hashType >>> 0),         // sighash type
  )

  return doubleSha256(preimage)
}

// ============================================
// ECDSA Signing (DER format)
// ============================================

/**
 * Encode a 64-byte compact signature (r||s) as DER format.
 *
 * DER: 0x30 [total-len] 0x02 [r-len] [r-bytes] 0x02 [s-len] [s-bytes]
 * Integers are signed, so prepend 0x00 if high bit is set.
 */
function compactToDER(compact: Uint8Array): Uint8Array {
  const r = compact.slice(0, 32)
  const s = compact.slice(32, 64)

  // Strip leading zeros but ensure positive (prepend 0x00 if high bit set)
  function encodeInteger(bytes: Uint8Array): Uint8Array {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    const trimmed = bytes.slice(start)
    if (trimmed[0]! >= 0x80) {
      const padded = new Uint8Array(trimmed.length + 1)
      padded[0] = 0x00
      padded.set(trimmed, 1)
      return padded
    }
    return trimmed
  }

  const rEnc = encodeInteger(r)
  const sEnc = encodeInteger(s)
  const totalLen = 2 + rEnc.length + 2 + sEnc.length
  const der = new Uint8Array(2 + totalLen)
  let offset = 0
  der[offset++] = 0x30 // SEQUENCE tag
  der[offset++] = totalLen
  der[offset++] = 0x02 // INTEGER tag
  der[offset++] = rEnc.length
  der.set(rEnc, offset); offset += rEnc.length
  der[offset++] = 0x02 // INTEGER tag
  der[offset++] = sEnc.length
  der.set(sEnc, offset)
  return der
}

/**
 * Sign a sighash with a private key, returning DER-encoded signature.
 */
function signHash(privKey: Uint8Array, hash: Uint8Array): Uint8Array {
  const compact = secp256k1.sign(hash, privKey, { lowS: true })
  return compactToDER(compact)
}

// ============================================
// Transaction Serialization
// ============================================

interface TxInput {
  txid: string
  vout: number
  scriptSig: Uint8Array
  sequence: number
}

interface TxOutput {
  satoshis: number
  script: Uint8Array
}

function serializeTransaction(inputs: TxInput[], outputs: TxOutput[]): Uint8Array {
  const parts: Uint8Array[] = [
    writeUint32LE(TX_VERSION),
    writeVarInt(inputs.length),
  ]

  for (const input of inputs) {
    parts.push(
      reverseBytes(hexToBytes(input.txid)),
      writeUint32LE(input.vout),
      writeVarInt(input.scriptSig.length),
      input.scriptSig,
      writeUint32LE(input.sequence)
    )
  }

  parts.push(writeVarInt(outputs.length))

  for (const output of outputs) {
    parts.push(
      writeUint64LE(output.satoshis),
      writeVarInt(output.script.length),
      output.script
    )
  }

  parts.push(writeUint32LE(LOCKTIME))

  return concat(...parts)
}

function serializeOutputs(outputs: TxOutput[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const output of outputs) {
    parts.push(
      writeUint64LE(output.satoshis),
      writeVarInt(output.script.length),
      output.script
    )
  }
  return concat(...parts)
}

/**
 * Compute the transaction ID from the raw serialized transaction.
 * txid = reversed double-SHA256 of the raw transaction bytes.
 */
function computeTxid(rawTx: Uint8Array): string {
  const hash = doubleSha256(rawTx)
  return bytesToHex(reverseBytes(hash))
}

// ============================================
// Public API: Transaction Builders
// ============================================

/**
 * Build and sign a single-key P2PKH transaction.
 */
export function buildP2PKHTx(
  wif: string,
  params: BuildP2PKHTxParams
): BuiltTransaction {
  const { toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params
  const privKey = wifToPrivateKey(wif)
  const pubKey = privateKeyToPublicKey(privKey)
  const changeAddress = privateKeyToAddress(privKey)

  // Calculate change
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(selectedUtxos.length, numOutputs, feeRate)
  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds: need ${satoshis + fee} sats, have ${totalInput}`)
  }

  // Build outputs
  const txOutputs: TxOutput[] = [
    { satoshis, script: addressToLockingScript(toAddress) }
  ]
  if (willHaveChange && change > 0) {
    txOutputs.push({ satoshis: change, script: addressToLockingScript(changeAddress) })
  }

  const outputsBytes = serializeOutputs(txOutputs)

  // Build sighash inputs
  const sighashInputs: SighashInput[] = selectedUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    script: hexToBytes(u.script),
    satoshis: u.satoshis,
  }))

  // Sign each input
  const txInputs: TxInput[] = sighashInputs.map((inp, i) => {
    const sighash = computeSighash(sighashInputs, outputsBytes, i, SIGHASH_ALL_FORKID)
    const sig = signHash(privKey, sighash)
    return {
      txid: inp.txid,
      vout: inp.vout,
      scriptSig: p2pkhUnlockingScript(sig, pubKey),
      sequence: SEQUENCE,
    }
  })

  const rawTx = serializeTransaction(txInputs, txOutputs)
  const rawTxHex = bytesToHex(rawTx)
  const txid = computeTxid(rawTx)

  return {
    tx: null,
    rawTx: rawTxHex,
    txid,
    fee,
    change: willHaveChange ? change : 0,
    changeAddress,
    numOutputs,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout })),
  }
}

/**
 * Build and sign a multi-key P2PKH transaction.
 * Each input can have a different signing key.
 */
export function buildMultiKeyP2PKHTx(
  changeWif: string,
  params: BuildMultiKeyP2PKHTxParams
): BuiltTransaction {
  const { toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params
  const changePrivKey = wifToPrivateKey(changeWif)
  const changeAddress = privateKeyToAddress(changePrivKey)

  // Calculate change
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(selectedUtxos.length, numOutputs, feeRate)
  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds: need ${satoshis + fee} sats, have ${totalInput}`)
  }

  // Build outputs
  const txOutputs: TxOutput[] = [
    { satoshis, script: addressToLockingScript(toAddress) }
  ]
  if (willHaveChange && change > 0) {
    txOutputs.push({ satoshis: change, script: addressToLockingScript(changeAddress) })
  }

  const outputsBytes = serializeOutputs(txOutputs)

  // Build sighash inputs
  const sighashInputs: SighashInput[] = selectedUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    script: hexToBytes(u.script),
    satoshis: u.satoshis,
  }))

  // Sign each input with its own key
  const txInputs: TxInput[] = sighashInputs.map((inp, i) => {
    const utxo = selectedUtxos[i]!
    const inputPrivKey = wifToPrivateKey(utxo.wif)
    const inputPubKey = privateKeyToPublicKey(inputPrivKey)
    const sighash = computeSighash(sighashInputs, outputsBytes, i, SIGHASH_ALL_FORKID)
    const sig = signHash(inputPrivKey, sighash)
    return {
      txid: inp.txid,
      vout: inp.vout,
      scriptSig: p2pkhUnlockingScript(sig, inputPubKey),
      sequence: SEQUENCE,
    }
  })

  const rawTx = serializeTransaction(txInputs, txOutputs)

  return {
    tx: null,
    rawTx: bytesToHex(rawTx),
    txid: computeTxid(rawTx),
    fee,
    change: willHaveChange ? change : 0,
    changeAddress,
    numOutputs,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout })),
  }
}

/**
 * Build and sign a consolidation transaction.
 * Combines multiple UTXOs into a single output.
 */
export function buildConsolidationTx(
  wif: string,
  params: BuildConsolidationTxParams
): BuiltConsolidationTransaction {
  const { utxos, feeRate } = params

  if (utxos.length < 2) {
    throw new Error('Need at least 2 UTXOs to consolidate')
  }

  const privKey = wifToPrivateKey(wif)
  const pubKey = privateKeyToPublicKey(privKey)
  const address = privateKeyToAddress(privKey)

  const totalInput = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  const fee = calculateTxFee(utxos.length, 1, feeRate)
  const outputSats = totalInput - fee

  if (outputSats <= 0) {
    throw new Error(`Consolidation output would be zero or negative after ${fee} sat fee`)
  }

  const txOutputs: TxOutput[] = [
    { satoshis: outputSats, script: addressToLockingScript(address) }
  ]

  const outputsBytes = serializeOutputs(txOutputs)

  const sighashInputs: SighashInput[] = utxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    script: hexToBytes(u.script),
    satoshis: u.satoshis,
  }))

  const txInputs: TxInput[] = sighashInputs.map((inp, i) => {
    const sighash = computeSighash(sighashInputs, outputsBytes, i, SIGHASH_ALL_FORKID)
    const sig = signHash(privKey, sighash)
    return {
      txid: inp.txid,
      vout: inp.vout,
      scriptSig: p2pkhUnlockingScript(sig, pubKey),
      sequence: SEQUENCE,
    }
  })

  const rawTx = serializeTransaction(txInputs, txOutputs)

  return {
    tx: null,
    rawTx: bytesToHex(rawTx),
    txid: computeTxid(rawTx),
    fee,
    outputSats,
    address,
    spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: u.vout })),
  }
}

/**
 * Build and sign a multi-output P2PKH transaction.
 */
export function buildMultiOutputP2PKHTx(
  wif: string,
  params: BuildMultiOutputP2PKHTxParams
): BuiltMultiOutputTransaction {
  const { outputs, selectedUtxos, totalInput, feeRate } = params

  if (outputs.length === 0) {
    throw new Error('Must have at least one output')
  }

  const privKey = wifToPrivateKey(wif)
  const pubKey = privateKeyToPublicKey(privKey)
  const changeAddress = privateKeyToAddress(privKey)

  const totalSent = outputs.reduce((sum, o) => sum + o.satoshis, 0)
  const numOutputsWithChange = outputs.length + 1
  const fee = calculateTxFee(selectedUtxos.length, numOutputsWithChange, feeRate)
  const change = totalInput - totalSent - fee

  if (change < 0) {
    throw new Error(`Insufficient funds: need ${totalSent + fee} sats, have ${totalInput}`)
  }

  const txOutputs: TxOutput[] = outputs.map(o => ({
    satoshis: o.satoshis,
    script: addressToLockingScript(o.address),
  }))

  if (change > 0) {
    txOutputs.push({ satoshis: change, script: addressToLockingScript(changeAddress) })
  }

  const outputsBytes = serializeOutputs(txOutputs)

  const sighashInputs: SighashInput[] = selectedUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    script: hexToBytes(u.script),
    satoshis: u.satoshis,
  }))

  const txInputs: TxInput[] = sighashInputs.map((inp, i) => {
    const sighash = computeSighash(sighashInputs, outputsBytes, i, SIGHASH_ALL_FORKID)
    const sig = signHash(privKey, sighash)
    return {
      txid: inp.txid,
      vout: inp.vout,
      scriptSig: p2pkhUnlockingScript(sig, pubKey),
      sequence: SEQUENCE,
    }
  })

  const rawTx = serializeTransaction(txInputs, txOutputs)

  return {
    tx: null,
    rawTx: bytesToHex(rawTx),
    txid: computeTxid(rawTx),
    fee,
    change: change > 0 ? change : 0,
    changeAddress,
    numOutputs: change > 0 ? outputs.length + 1 : outputs.length,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout })),
    totalSent,
  }
}
