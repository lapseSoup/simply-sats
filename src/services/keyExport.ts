import { saveFileDialog } from '../utils/dialog'
import { writeFile } from '../utils/fs'
import { isTauri, tauriInvoke } from '../utils/tauri'
import type { ToastType } from '../contexts/UIContext'
import type { ActiveWallet } from '../domain/types'
import { buildBrowserEncryptedKeyExport } from './browserSecretExports'

/**
 * Fetch wallet keys, encrypt, and save to a JSON file.
 * Used by both password-based and one-time-password export flows.
 *
 * Browser-only secret handling is delegated to browserSecretExports.ts so the
 * JS-side private-key path stays confined to explicit export boundaries.
 */
export async function exportKeysToFile(
  wallet: ActiveWallet,
  password: string,
  showToast: (msg: string, type?: ToastType) => void
): Promise<void> {
  if (isTauri()) {
    const encrypted = await tauriInvoke<{
      version: number
      ciphertext: string
      iv: string
      salt: string
      iterations: number
    }>('build_encrypted_key_export_from_store', {
      password,
      walletAddress: wallet.walletAddress,
      ordAddress: wallet.ordAddress,
      identityPubKey: wallet.identityPubKey
    })

    const filePath = await saveFileDialog({
      defaultPath: `simply-sats-keys-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (filePath) {
      await writeFile(filePath, JSON.stringify({
        format: 'simply-sats-keys-encrypted',
        version: 1,
        encrypted
      }, null, 2))
      showToast('Encrypted keys saved to file!')
    }
    return
  }

  const encryptedExport = await buildBrowserEncryptedKeyExport(wallet, password)
  const filePath = await saveFileDialog({
    defaultPath: `simply-sats-keys-${new Date().toISOString().split('T')[0]}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (filePath) {
    await writeFile(filePath, JSON.stringify(encryptedExport, null, 2))
    showToast('Encrypted keys saved to file!')
  }
}
