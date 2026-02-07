/**
 * Wallet type definitions
 * Extracted from wallet.ts for modularity
 */

// Wallet type - simplified to just BRC-100/Yours standard
export type WalletType = 'yours'

export interface WalletKeys {
  mnemonic: string
  walletType: WalletType
  walletWif: string
  walletAddress: string
  walletPubKey: string
  ordWif: string
  ordAddress: string
  ordPubKey: string
  identityWif: string
  identityAddress: string
  identityPubKey: string
}

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

// Extended UTXO type that includes WIF for multi-key spending
export interface ExtendedUTXO extends UTXO {
  wif: string
  address: string
}

// WhatsOnChain API response types
export interface WocUtxo {
  tx_hash: string
  tx_pos: number
  value: number
  height?: number
}

export interface WocHistoryItem {
  tx_hash: string
  height: number
}

export interface WocTxOutput {
  value: number
  n: number
  scriptPubKey: {
    asm: string
    hex: string
    reqSigs?: number
    type: string
    addresses?: string[]
  }
}

export interface WocTxInput {
  txid: string
  vout: number
  scriptSig: {
    asm: string
    hex: string
  }
  sequence: number
  // prevout is included in some API responses
  prevout?: {
    value: number
    scriptPubKey: {
      addresses?: string[]
    }
  }
}

export interface WocTransaction {
  txid: string
  hash: string
  version: number
  size: number
  locktime: number
  vin: WocTxInput[]
  vout: WocTxOutput[]
  blockhash?: string
  confirmations?: number
  time?: number
  blocktime?: number
  blockheight?: number
}

// GorillaPool Ordinals API response types
export interface GpOrdinalOrigin {
  outpoint?: string
  data?: {
    insc?: {
      file?: {
        type?: string
        hash?: string
      }
    }
  }
}

export interface GpOrdinalItem {
  txid: string
  vout: number
  satoshis?: number
  outpoint?: string
  origin?: GpOrdinalOrigin
}

// Backup format types
export interface ShaulletBackup {
  mnemonic?: string
  seed?: string
  keys?: {
    privateKey?: string
    wif?: string
  }
}

// 1Sat Ordinals wallet JSON format
export interface OneSatWalletBackup {
  ordPk?: string      // Ordinals private key (WIF)
  payPk?: string      // Payment private key (WIF)
  mnemonic?: string   // Optional mnemonic
}

// 1Sat Ordinals types
export interface Ordinal {
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  content?: string
}

// Ordinal details from GorillaPool API
export interface OrdinalDetails {
  origin?: string
  txid?: string
  vout?: number
  height?: number
  idx?: number
  data?: {
    insc?: {
      file?: {
        type?: string
        size?: number
        hash?: string
      }
      text?: string
      json?: Record<string, unknown>
    }
    map?: Record<string, string>
    bsv20?: {
      tick?: string
      amt?: string
      op?: string
    }
  }
  owner?: string
  satoshis?: number
  spend?: string // Spending txid if this ordinal has been spent
}

// Locked UTXO type
export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  unlockBlock: number
  publicKeyHex: string
  createdAt: number
  lockBlock?: number
  /** Block height where tx was confirmed (from API, not stored in DB) */
  confirmationBlock?: number
}
