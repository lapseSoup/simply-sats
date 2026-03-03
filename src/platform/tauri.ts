/**
 * Tauri Platform Adapter
 *
 * Delegates all platform-specific operations to the Rust backend
 * via Tauri's invoke() IPC. This is the existing behavior wrapped
 * behind the PlatformAdapter interface — zero behavior change.
 *
 * @module platform/tauri
 */

import type {
  PlatformAdapter,
  DerivedKeyResult,
  DerivedAddressResult,
  DerivationTag,
  TaggedKeyResult,
  BuildP2PKHTxParams,
  BuildMultiKeyP2PKHTxParams,
  BuildConsolidationTxParams,
  BuildMultiOutputP2PKHTxParams,
  BuiltTransaction,
  BuiltConsolidationTransaction,
  BuiltMultiOutputTransaction,
  RateLimitCheckResult,
  FailedUnlockResult,
  EncryptedData,
  PublicWalletKeys,
} from './types'
import type { WalletKeys, KeyPair } from '../domain/types'
import { tauriInvoke } from '../utils/tauri'
import { calculateTxFee } from '../domain/transaction/fees'

/**
 * Tauri platform adapter — delegates to Rust backend via tauriInvoke.
 * This wraps the existing Tauri integration with zero behavior change.
 */
export class TauriAdapter implements PlatformAdapter {
  readonly platform = 'tauri' as const

  // ----- Key Derivation -----

  async deriveWalletKeys(mnemonic: string): Promise<WalletKeys> {
    return tauriInvoke<WalletKeys>('derive_wallet_keys', { mnemonic })
  }

  async deriveWalletKeysForAccount(mnemonic: string, accountIndex: number): Promise<WalletKeys> {
    return tauriInvoke<WalletKeys>('derive_wallet_keys_for_account', { mnemonic, accountIndex })
  }

  async keysFromWif(wif: string): Promise<KeyPair> {
    return tauriInvoke<KeyPair>('keys_from_wif', { wif })
  }

  // ----- BRC-42/43 Key Derivation -----

  async deriveChildKey(receiverWif: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult> {
    return tauriInvoke<DerivedKeyResult>('derive_child_key', {
      wif: receiverWif,
      senderPubKey: senderPubKeyHex,
      invoiceNumber,
    })
  }

  async deriveChildKeyFromStore(keyType: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult> {
    return tauriInvoke<DerivedKeyResult>('derive_child_key_from_store', {
      keyType,
      senderPubKey: senderPubKeyHex,
      invoiceNumber,
    })
  }

  async getDerivedAddresses(receiverWif: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]> {
    return tauriInvoke<DerivedAddressResult[]>('get_derived_addresses', {
      wif: receiverWif,
      senderPubKeys,
      invoiceNumbers,
    })
  }

  async getDerivedAddressesFromStore(keyType: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]> {
    return tauriInvoke<DerivedAddressResult[]>('get_derived_addresses_from_store', {
      keyType,
      senderPubKeys,
      invoiceNumbers,
    })
  }

  async findDerivedKeyForAddress(receiverWif: string, targetAddress: string, senderPubKeyHex: string, invoiceNumbers: string[], maxNumeric: number): Promise<DerivedKeyResult | null> {
    return tauriInvoke<DerivedKeyResult | null>('find_derived_key_for_address', {
      wif: receiverWif,
      targetAddress,
      senderPubKey: senderPubKeyHex,
      invoiceNumbers,
      maxNumeric,
    })
  }

  async deriveTaggedKey(rootWif: string, tag: DerivationTag): Promise<TaggedKeyResult> {
    return tauriInvoke<TaggedKeyResult>('derive_tagged_key', {
      wif: rootWif,
      label: tag.label,
      id: tag.id,
      domain: tag.domain,
    })
  }

  async deriveTaggedKeyFromStore(keyType: string, tag: DerivationTag): Promise<TaggedKeyResult> {
    return tauriInvoke<TaggedKeyResult>('derive_tagged_key_from_store', {
      keyType,
      label: tag.label,
      id: tag.id,
      domain: tag.domain,
    })
  }

  // ----- Transaction Building -----

  async buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction> {
    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      change: number
      changeAddress: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_p2pkh_tx_from_store', {
      toAddress: params.toAddress,
      satoshis: params.satoshis,
      selectedUtxos: params.selectedUtxos.map(u => ({
        txid: u.txid, vout: u.vout, satoshis: u.satoshis, script: u.script ?? ''
      })),
      totalInput: params.totalInput,
      feeRate: params.feeRate,
    })

    return {
      tx: null,
      rawTx: result.rawTx,
      txid: result.txid,
      fee: result.fee,
      change: result.change,
      changeAddress: result.changeAddress,
      numOutputs: result.change > 0 ? 2 : 1,
      spentOutpoints: result.spentOutpoints,
    }
  }

  async buildMultiKeyP2PKHTx(params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction> {
    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      change: number
      changeAddress: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_multi_key_p2pkh_tx_from_store', {
      toAddress: params.toAddress,
      satoshis: params.satoshis,
      selectedUtxos: params.selectedUtxos.map(u => ({
        txid: u.txid, vout: u.vout, satoshis: u.satoshis, script: u.script, wif: u.wif, address: u.address
      })),
      totalInput: params.totalInput,
      feeRate: params.feeRate,
    })

    return {
      tx: null,
      rawTx: result.rawTx,
      txid: result.txid,
      fee: result.fee,
      change: result.change,
      changeAddress: result.changeAddress,
      numOutputs: result.change > 0 ? 2 : 1,
      spentOutpoints: result.spentOutpoints,
    }
  }

  async buildConsolidationTx(params: BuildConsolidationTxParams): Promise<BuiltConsolidationTransaction> {
    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      outputSats: number
      address: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_consolidation_tx_from_store', {
      utxos: params.utxos.map(u => ({
        txid: u.txid, vout: u.vout, satoshis: u.satoshis, script: u.script
      })),
      feeRate: params.feeRate,
    })

    return {
      tx: null,
      rawTx: result.rawTx,
      txid: result.txid,
      fee: result.fee,
      outputSats: result.outputSats,
      address: result.address,
      spentOutpoints: result.spentOutpoints,
    }
  }

  async buildMultiOutputP2PKHTx(params: BuildMultiOutputP2PKHTxParams): Promise<BuiltMultiOutputTransaction> {
    const totalSent = params.outputs.reduce((sum, o) => sum + o.satoshis, 0)
    const numOutputsWithChange = params.outputs.length + 1
    const fee = calculateTxFee(params.selectedUtxos.length, numOutputsWithChange, params.feeRate)
    const change = params.totalInput - totalSent - fee

    if (change < 0) {
      throw new Error(
        `Insufficient funds: need ${totalSent + fee} sats (${totalSent} + ${fee} fee), have ${params.totalInput}`
      )
    }

    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      change: number
      changeAddress: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_multi_output_p2pkh_tx_from_store', {
      outputs: params.outputs.map(o => ({ address: o.address, satoshis: o.satoshis })),
      selectedUtxos: params.selectedUtxos.map(u => ({
        txid: u.txid, vout: u.vout, satoshis: u.satoshis, script: u.script ?? ''
      })),
      totalInput: params.totalInput,
      feeRate: params.feeRate,
    })

    return {
      tx: null,
      rawTx: result.rawTx,
      txid: result.txid,
      fee: result.fee,
      change: result.change,
      changeAddress: result.changeAddress,
      numOutputs: result.change > 0 ? params.outputs.length + 1 : params.outputs.length,
      spentOutpoints: result.spentOutpoints,
      totalSent,
    }
  }

  // ----- Secure Key Storage -----

  async storeKeys(mnemonic: string, accountIndex: number): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('store_keys', { mnemonic, accountIndex })
  }

  async storeKeysDirect(
    walletWif: string, walletAddress: string, walletPubKey: string,
    ordWif: string, ordAddress: string, ordPubKey: string,
    identityWif: string, identityAddress: string, identityPubKey: string
  ): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('store_keys_direct', {
      walletWif, walletAddress, walletPubKey,
      ordWif, ordAddress, ordPubKey,
      identityWif, identityAddress, identityPubKey,
    })
  }

  async switchAccountFromStore(accountIndex: number): Promise<PublicWalletKeys> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<PublicWalletKeys>('switch_account_from_store', { accountIndex })
  }

  async rotateSessionForAccount(accountId: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('rotate_session_for_account', { accountId })
  }

  async getWifForOperation(): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('get_wif_for_operation')
  }

  async getMnemonicOnce(): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('get_mnemonic_once')
  }

  async clearKeys(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('clear_keys')
  }

  // ----- Signing & Verification -----

  async signMessageFromStore(message: string, keyType: string): Promise<string> {
    return tauriInvoke<string>('sign_message_from_store', { message, keyType })
  }

  async signDataFromStore(data: string, keyType: string): Promise<string> {
    return tauriInvoke<string>('sign_data_from_store', { data, keyType })
  }

  async verifySignature(publicKeyHex: string, message: string, signatureHex: string): Promise<boolean> {
    return tauriInvoke<boolean>('verify_signature', { publicKeyHex, message, signatureHex })
  }

  async verifyDataSignature(publicKeyHex: string, data: string, signatureHex: string): Promise<boolean> {
    return tauriInvoke<boolean>('verify_data_signature', { publicKeyHex, data, signatureHex })
  }

  // ----- Encryption -----

  async encryptData(plaintext: string, password: string): Promise<EncryptedData> {
    return tauriInvoke<EncryptedData>('encrypt_data', { plaintext, password })
  }

  async decryptData(encryptedData: EncryptedData, password: string): Promise<string> {
    return tauriInvoke<string>('decrypt_data', { encryptedData, password })
  }

  async encryptEciesFromStore(plaintext: string, recipientPubKey: string, keyType: string): Promise<{ ciphertext: string; senderPublicKey: string }> {
    return tauriInvoke<{ ciphertext: string; senderPublicKey: string }>('encrypt_ecies_from_store', {
      plaintext, recipientPubKey, keyType,
    })
  }

  async decryptEciesFromStore(ciphertextBytes: string, senderPubKey: string, keyType: string): Promise<string> {
    return tauriInvoke<string>('decrypt_ecies_from_store', {
      ciphertextBytes, senderPubKey, keyType,
    })
  }

  // ----- Secure Storage -----

  async secureStorageSave(data: EncryptedData): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('secure_storage_save', { data })
  }

  async secureStorageLoad(): Promise<EncryptedData | null> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<EncryptedData | null>('secure_storage_load')
  }

  async secureStorageExists(): Promise<boolean> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<boolean>('secure_storage_exists')
  }

  async secureStorageClear(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('secure_storage_clear')
  }

  // ----- Rate Limiting -----

  async checkUnlockRateLimit(): Promise<RateLimitCheckResult> {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<{ is_limited: boolean; remaining_ms: number }>('check_unlock_rate_limit')
    return { isLimited: response.is_limited, remainingMs: response.remaining_ms }
  }

  async recordFailedUnlock(): Promise<FailedUnlockResult> {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<{ is_locked: boolean; lockout_ms: number; attempts_remaining: number }>('record_failed_unlock')
    return { isLocked: response.is_locked, lockoutMs: response.lockout_ms, attemptsRemaining: response.attempts_remaining }
  }

  async recordSuccessfulUnlock(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('record_successful_unlock')
  }

  async getRemainingAttempts(): Promise<number> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<number>('get_remaining_unlock_attempts')
  }

  // ----- BRC-100 -----

  async respondToBrc100(requestId: string, response: unknown): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('respond_to_brc100', { requestId, response })
  }

  // ----- Hashing -----

  async sha256Hash(data: string): Promise<string> {
    return tauriInvoke<string>('sha256_hash', { data })
  }
}
