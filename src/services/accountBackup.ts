import { getDatabase } from './database'
import type { AccountRow } from '../infrastructure/database/row-types'
import { accountLogger } from './logger'

// Backup-only account row shape. This intentionally includes encrypted keys.
export interface EncryptedAccountBackup {
  id?: number
  name: string
  identityAddress: string
  encryptedKeys: string
  isActive: boolean
  createdAt: number
  lastAccessedAt?: number
  derivationIndex?: number
}

function mapRowToEncryptedAccountBackup(row: AccountRow): EncryptedAccountBackup {
  return {
    id: row.id,
    name: row.name,
    identityAddress: row.identity_address,
    encryptedKeys: row.encrypted_keys,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    derivationIndex: row.derivation_index ?? undefined
  }
}

export async function exportEncryptedAccountsForBackup(): Promise<EncryptedAccountBackup[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountRow[]>(
      'SELECT * FROM accounts ORDER BY last_accessed_at DESC'
    )

    return rows.map(mapRowToEncryptedAccountBackup)
  } catch (e) {
    accountLogger.error('Failed to export encrypted accounts for backup', e)
    return []
  }
}
