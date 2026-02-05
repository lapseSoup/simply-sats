/**
 * BRC-100 Cryptography Operations
 *
 * ECIES encryption and decryption using BSV SDK.
 */

import { PrivateKey, PublicKey, Hash, SymmetricKey } from '@bsv/sdk'
import type { WalletKeys } from '../wallet'

/**
 * Encrypt plaintext using ECIES with counterparty's public key
 */
export function encryptECIES(
  keys: WalletKeys,
  plaintext: string,
  recipientPubKey: string
): { ciphertext: string; senderPublicKey: string } {
  // Derive shared secret using ECDH
  const senderPrivKey = PrivateKey.fromWif(keys.identityWif)
  const recipientPublicKey = PublicKey.fromString(recipientPubKey)

  // Use ECDH to derive shared secret
  const sharedSecret = senderPrivKey.deriveSharedSecret(recipientPublicKey)
  const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

  // Encrypt using AES with the shared secret
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
  const encrypted = symmetricKey.encrypt(Array.from(plaintextBytes))

  // Convert encrypted bytes to hex string
  const encryptedHex = Array.from(encrypted as number[])
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Return as hex string along with sender's public key for decryption
  return {
    ciphertext: encryptedHex,
    senderPublicKey: keys.identityPubKey
  }
}

/**
 * Decrypt ciphertext using ECIES with counterparty's public key
 */
export function decryptECIES(
  keys: WalletKeys,
  ciphertextBytes: number[],
  senderPubKey: string
): string {
  // Derive shared secret using ECDH
  const recipientPrivKey = PrivateKey.fromWif(keys.identityWif)
  const senderPublicKey = PublicKey.fromString(senderPubKey)

  // Use ECDH to derive shared secret
  const sharedSecret = recipientPrivKey.deriveSharedSecret(senderPublicKey)
  const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

  // Decrypt using AES with the shared secret
  const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
  const decrypted = symmetricKey.decrypt(ciphertextBytes)

  // Return plaintext
  const decryptedBytes = decrypted instanceof Uint8Array
    ? decrypted
    : new Uint8Array(decrypted as number[])
  return new TextDecoder().decode(decryptedBytes)
}
