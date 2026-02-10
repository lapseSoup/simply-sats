/**
 * Audit Logging Service
 *
 * Provides logging of security-sensitive operations for:
 * - Security monitoring
 * - Debugging and troubleshooting
 * - Compliance and accountability
 *
 * Logged actions include:
 * - Wallet lifecycle (create, restore, lock, unlock)
 * - Transactions (send, receive)
 * - Connected app management (trust, revoke)
 * - Account management (create, delete, switch)
 *
 * @module services/auditLog
 */

import Database from '@tauri-apps/plugin-sql'
import { walletLogger } from './logger'
import { FEATURES } from '../config'
import type { AuditAction, AuditLogEntry, IAuditLogRepository } from '../domain/repositories'

// Default retention: 90 days
const DEFAULT_RETENTION_DAYS = 90

// Maximum entries to return in a single query
const MAX_QUERY_LIMIT = 1000

// Singleton database connection
let db: Database | null = null

/**
 * Get or create database connection
 */
async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:simplysats.db')
  }
  return db
}

/** Maximum serialized size for audit log details (10 KB) */
const MAX_DETAILS_SIZE = 10240

/**
 * Sanitize details object for audit logging.
 * Prevents unbounded data from being stored in the database.
 */
function sanitizeDetails(details: Record<string, unknown>): string | null {
  try {
    const json = JSON.stringify(details)
    if (json.length > MAX_DETAILS_SIZE) {
      walletLogger.warn('Audit log details truncated', { originalSize: json.length })
      // Keep only known safe keys, drop the rest
      const safe: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(details)) {
        const valStr = JSON.stringify(value)
        if (typeof key === 'string' && key.length <= 64 && valStr.length <= 1024) {
          safe[key] = value
        }
      }
      return JSON.stringify(safe)
    }
    return json
  } catch {
    walletLogger.warn('Failed to serialize audit log details')
    return null
  }
}

/**
 * Log an audit action to the database
 */
export async function logAuditAction(
  action: AuditAction,
  options?: {
    details?: Record<string, unknown>
    accountId?: number
    origin?: string
    txid?: string
    success?: boolean
  }
): Promise<void> {
  if (!FEATURES.AUDIT_LOG) {
    return
  }

  try {
    const database = await getDb()
    const timestamp = Math.floor(Date.now() / 1000)
    const detailsJson = options?.details ? sanitizeDetails(options.details) : null

    await database.execute(
      `INSERT INTO audit_log (timestamp, action, details, account_id, origin, txid, success)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        timestamp,
        action,
        detailsJson,
        options?.accountId ?? null,
        options?.origin ?? null,
        options?.txid ?? null,
        options?.success !== false ? 1 : 0
      ]
    )

    walletLogger.debug('Audit log entry created', { action, success: options?.success !== false })
  } catch (error) {
    walletLogger.error('Failed to log audit action', { action, error })
  }
}

/**
 * Get recent audit log entries
 */
export async function getRecentAuditLogs(limit: number = 100): Promise<AuditLogEntry[]> {
  if (!FEATURES.AUDIT_LOG) {
    return []
  }

  try {
    const database = await getDb()
    const effectiveLimit = Math.min(limit, MAX_QUERY_LIMIT)

    const rows = await database.select<AuditLogEntry[]>(
      `SELECT id, timestamp, action, details, account_id as accountId, origin, txid, success
       FROM audit_log
       ORDER BY timestamp DESC
       LIMIT ?`,
      [effectiveLimit]
    )

    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details as unknown as string) : undefined
    }))
  } catch (error) {
    walletLogger.error('Failed to get audit logs', { error })
    return []
  }
}

/**
 * Get audit log entries by action type
 */
export async function getAuditLogsByAction(
  action: AuditAction,
  limit: number = 100
): Promise<AuditLogEntry[]> {
  if (!FEATURES.AUDIT_LOG) {
    return []
  }

  try {
    const database = await getDb()
    const effectiveLimit = Math.min(limit, MAX_QUERY_LIMIT)

    const rows = await database.select<AuditLogEntry[]>(
      `SELECT id, timestamp, action, details, account_id as accountId, origin, txid, success
       FROM audit_log
       WHERE action = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [action, effectiveLimit]
    )

    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details as unknown as string) : undefined
    }))
  } catch (error) {
    walletLogger.error('Failed to get audit logs by action', { action, error })
    return []
  }
}

/**
 * Get audit log entries for a specific account
 */
export async function getAuditLogsByAccount(
  accountId: number,
  limit: number = 100
): Promise<AuditLogEntry[]> {
  if (!FEATURES.AUDIT_LOG) {
    return []
  }

  try {
    const database = await getDb()
    const effectiveLimit = Math.min(limit, MAX_QUERY_LIMIT)

    const rows = await database.select<AuditLogEntry[]>(
      `SELECT id, timestamp, action, details, account_id as accountId, origin, txid, success
       FROM audit_log
       WHERE account_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [accountId, effectiveLimit]
    )

    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details as unknown as string) : undefined
    }))
  } catch (error) {
    walletLogger.error('Failed to get audit logs by account', { accountId, error })
    return []
  }
}

/**
 * Export all audit log entries
 */
export async function exportAuditLogs(): Promise<AuditLogEntry[]> {
  if (!FEATURES.AUDIT_LOG) {
    return []
  }

  try {
    const database = await getDb()

    const rows = await database.select<AuditLogEntry[]>(
      `SELECT id, timestamp, action, details, account_id as accountId, origin, txid, success
       FROM audit_log
       ORDER BY timestamp ASC`
    )

    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details as unknown as string) : undefined
    }))
  } catch (error) {
    walletLogger.error('Failed to export audit logs', { error })
    return []
  }
}

/**
 * Clear audit log entries older than a specified timestamp
 * @param timestamp Unix timestamp in seconds
 * @returns Number of entries deleted
 */
export async function clearOldAuditLogs(timestamp?: number): Promise<number> {
  if (!FEATURES.AUDIT_LOG) {
    return 0
  }

  try {
    const database = await getDb()
    const cutoff = timestamp ?? Math.floor(Date.now() / 1000) - (DEFAULT_RETENTION_DAYS * 24 * 60 * 60)

    const result = await database.execute(
      `DELETE FROM audit_log WHERE timestamp < ?`,
      [cutoff]
    )

    walletLogger.info('Cleared old audit logs', { cutoff, deleted: result.rowsAffected })
    return result.rowsAffected
  } catch (error) {
    walletLogger.error('Failed to clear old audit logs', { error })
    return 0
  }
}

/**
 * Get failed unlock attempts (security monitoring)
 */
export async function getFailedUnlockAttempts(
  since?: number
): Promise<AuditLogEntry[]> {
  if (!FEATURES.AUDIT_LOG) {
    return []
  }

  const cutoff = since ?? Math.floor(Date.now() / 1000) - (24 * 60 * 60) // Last 24 hours

  try {
    const database = await getDb()

    const rows = await database.select<AuditLogEntry[]>(
      `SELECT id, timestamp, action, details, account_id as accountId, origin, txid, success
       FROM audit_log
       WHERE action = 'unlock_failed' AND timestamp > ?
       ORDER BY timestamp DESC`,
      [cutoff]
    )

    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details as unknown as string) : undefined
    }))
  } catch (error) {
    walletLogger.error('Failed to get failed unlock attempts', { error })
    return []
  }
}

/**
 * Audit log repository implementation
 */
export const auditLogRepository: IAuditLogRepository = {
  async log(action: AuditAction, details?: Record<string, unknown>): Promise<void> {
    await logAuditAction(action, { details })
  },

  async getRecent(limit?: number): Promise<AuditLogEntry[]> {
    return getRecentAuditLogs(limit)
  },

  async getByAction(action: AuditAction, limit?: number): Promise<AuditLogEntry[]> {
    return getAuditLogsByAction(action, limit)
  },

  async getByAccount(accountId: number, limit?: number): Promise<AuditLogEntry[]> {
    return getAuditLogsByAccount(accountId, limit)
  },

  async exportAll(): Promise<AuditLogEntry[]> {
    return exportAuditLogs()
  },

  async clearOlderThan(timestamp: number): Promise<number> {
    return clearOldAuditLogs(timestamp)
  }
}

// Convenience functions for common audit actions
export const audit = {
  walletCreated: (accountId?: number) =>
    logAuditAction('wallet_created', { accountId }),

  walletRestored: (accountId?: number) =>
    logAuditAction('wallet_restored', { accountId }),

  walletUnlocked: (accountId?: number) =>
    logAuditAction('wallet_unlocked', { accountId, success: true }),

  walletLocked: (accountId?: number) =>
    logAuditAction('wallet_locked', { accountId }),

  unlockFailed: (accountId?: number, reason?: string) =>
    logAuditAction('unlock_failed', { accountId, details: { reason }, success: false }),

  transactionSent: (txid: string, amount: number, accountId?: number) =>
    logAuditAction('transaction_sent', { txid, accountId, details: { amount } }),

  transactionReceived: (txid: string, amount: number, accountId?: number) =>
    logAuditAction('transaction_received', { txid, accountId, details: { amount } }),

  lockCreated: (txid: string, amount: number, unlockBlock: number, accountId?: number) =>
    logAuditAction('lock_created', { txid, accountId, details: { amount, unlockBlock } }),

  lockReleased: (txid: string, amount: number, accountId?: number) =>
    logAuditAction('lock_released', { txid, accountId, details: { amount } }),

  originTrusted: (origin: string, accountId?: number) =>
    logAuditAction('origin_trusted', { origin, accountId }),

  originRemoved: (origin: string, accountId?: number) =>
    logAuditAction('origin_removed', { origin, accountId }),

  appConnected: (origin: string, accountId?: number) =>
    logAuditAction('app_connected', { origin, accountId }),

  appDisconnected: (origin: string, accountId?: number) =>
    logAuditAction('app_disconnected', { origin, accountId }),

  accountCreated: (accountId: number, name: string) =>
    logAuditAction('account_created', { accountId, details: { name } }),

  accountDeleted: (accountId: number, name: string) =>
    logAuditAction('account_deleted', { accountId, details: { name } }),

  accountSwitched: (fromAccountId: number | undefined, toAccountId: number) =>
    logAuditAction('account_switched', { accountId: toAccountId, details: { fromAccountId } })
}
