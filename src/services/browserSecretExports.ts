import type { DatabaseBackup } from '../infrastructure/database'
import type { ActiveWallet } from '../domain/types'
import { hasPrivateKeyMaterial } from '../domain/types'
import { encrypt, type EncryptedData } from './crypto'

interface BrowserExportMaterial {
  identityWif: string
  walletWif: string
  ordWif: string
  mnemonic: string | null
}

function getBrowserExportMaterial(wallet: ActiveWallet): BrowserExportMaterial {
  if (!hasPrivateKeyMaterial(wallet)) {
    throw new Error('Private keys are unavailable in this session')
  }

  return {
    identityWif: wallet.identityWif,
    walletWif: wallet.walletWif,
    ordWif: wallet.ordWif,
    mnemonic: wallet.mnemonic || null
  }
}

function scrubBrowserExportMaterial(material: BrowserExportMaterial): void {
  material.identityWif = '0'.repeat(material.identityWif.length)
  material.walletWif = '0'.repeat(material.walletWif.length)
  material.ordWif = '0'.repeat(material.ordWif.length)
  material.mnemonic = '0'.repeat(material.mnemonic?.length ?? 0)
}

export async function buildBrowserEncryptedKeyExport(
  wallet: ActiveWallet,
  password: string
): Promise<{
  format: 'simply-sats-keys-encrypted'
  version: 1
  encrypted: EncryptedData
}> {
  const material = getBrowserExportMaterial(wallet)

  try {
    const keyData = {
      format: 'simply-sats',
      version: 1,
      mnemonic: material.mnemonic || null,
      keys: {
        identity: { wif: material.identityWif, pubKey: wallet.identityPubKey },
        payment: { wif: material.walletWif, address: wallet.walletAddress },
        ordinals: { wif: material.ordWif, address: wallet.ordAddress }
      }
    }

    const encrypted = await encrypt(JSON.stringify(keyData), password)
    return {
      format: 'simply-sats-keys-encrypted',
      version: 1,
      encrypted
    }
  } finally {
    scrubBrowserExportMaterial(material)
  }
}

export async function buildBrowserEncryptedDatabaseBackup(
  wallet: ActiveWallet,
  password: string,
  database: DatabaseBackup
): Promise<EncryptedData> {
  const material = getBrowserExportMaterial(wallet)

  try {
    const fullBackup = {
      format: 'simply-sats-full',
      wallet: {
        mnemonic: material.mnemonic || null,
        keys: {
          identity: { wif: material.identityWif, pubKey: wallet.identityPubKey },
          payment: { wif: material.walletWif, address: wallet.walletAddress },
          ordinals: { wif: material.ordWif, address: wallet.ordAddress }
        }
      },
      database
    }

    return encrypt(JSON.stringify(fullBackup), password)
  } finally {
    scrubBrowserExportMaterial(material)
  }
}
