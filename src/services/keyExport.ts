import { saveFileDialog } from '../utils/dialog'
import { writeFile } from '../utils/fs'
import { tauriInvoke } from '../utils/tauri'
import { encrypt } from './crypto'
import type { ToastType } from '../contexts/UIContext'
import type { WalletKeys } from '../domain/types'

/**
 * Fetch wallet keys, encrypt, and save to a JSON file.
 * Used by both password-based and one-time-password export flows.
 *
 * Sensitive interim variables (WIFs, mnemonic) are overwritten after use
 * to reduce their lifespan in memory.  JS strings are immutable so this
 * creates new strings and lets the originals be GC'd -- not perfect, but
 * better than leaving named references pointing at secrets indefinitely.
 */
export async function exportKeysToFile(
  wallet: WalletKeys,
  password: string,
  showToast: (msg: string, type?: ToastType) => void
): Promise<void> {
  const { getWifForOperation } = await import('./wallet')
  let identityWif = await getWifForOperation('identity', 'exportKeys', wallet)
  let walletWif = await getWifForOperation('wallet', 'exportKeys', wallet)
  let ordWif = await getWifForOperation('ordinals', 'exportKeys', wallet)
  let mnemonic = await tauriInvoke<string | null>('get_mnemonic')

  try {
    const keyData = {
      format: 'simply-sats',
      version: 1,
      mnemonic: mnemonic || null,
      keys: {
        identity: { wif: identityWif, pubKey: wallet.identityPubKey },
        payment: { wif: walletWif, address: wallet.walletAddress },
        ordinals: { wif: ordWif, address: wallet.ordAddress }
      }
    }
    const encrypted = await encrypt(JSON.stringify(keyData), password)
    const encryptedExport = {
      format: 'simply-sats-keys-encrypted',
      version: 1,
      encrypted
    }
    const filePath = await saveFileDialog({
      defaultPath: `simply-sats-keys-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (filePath) {
      await writeFile(filePath, JSON.stringify(encryptedExport, null, 2))
      showToast('Encrypted keys saved to file!')
    }
  } finally {
    // Overwrite sensitive interim variables to shorten their in-memory lifespan
    identityWif = '0'.repeat(identityWif.length)
    walletWif = '0'.repeat(walletWif.length)
    ordWif = '0'.repeat(ordWif.length)
    mnemonic = '0'.repeat(mnemonic?.length ?? 0)
  }
}
