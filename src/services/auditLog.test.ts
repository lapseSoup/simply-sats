// @vitest-environment node

/**
 * Tests for Audit Logging Service (auditLog.ts)
 *
 * Covers: logAuditAction, getRecentAuditLogs, getAuditLogsByAction,
 *         getAuditLogsByAccount, exportAuditLogs, clearOldAuditLogs,
 *         getFailedUnlockAttempts, auditLogRepository, audit convenience object,
 *         sanitizeDetails (sensitive field redaction, size truncation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDbExecute,
  mockDbSelect,
  mockDbLoad,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbLoad: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: (...args: unknown[]) => mockDbLoad(...args),
  },
}))

vi.mock('./logger', () => ({
  walletLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../config', () => ({
  FEATURES: { AUDIT_LOG: true },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  logAuditAction,
  getRecentAuditLogs,
  getAuditLogsByAction,
  getAuditLogsByAccount,
  exportAuditLogs,
  clearOldAuditLogs,
  getFailedUnlockAttempts,
  auditLogRepository,
  audit,
} from './auditLog'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Log Service', () => {
  const mockDb = {
    execute: mockDbExecute,
    select: mockDbSelect,
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mockDbLoad.mockResolvedValue(mockDb)
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 })
    mockDbSelect.mockResolvedValue([])
  })

  // =========================================================================
  // logAuditAction
  // =========================================================================

  describe('logAuditAction', () => {
    it('should insert audit log entry into database', async () => {
      await logAuditAction('wallet_created')

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining(['wallet_created'])
      )
    })

    it('should serialize details as JSON', async () => {
      await logAuditAction('transaction_sent', {
        details: { amount: 5000, recipient: '1Addr' },
      })

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.any(Number), // timestamp
          'transaction_sent',
          expect.stringContaining('"amount":5000'),
        ])
      )
    })

    it('should redact sensitive fields in details', async () => {
      await logAuditAction('wallet_created', {
        details: { name: 'Test', password: 'secret123', mnemonic: 'twelve words here' },
      })

      // The details string should contain [REDACTED] for sensitive fields
      const callArgs = mockDbExecute.mock.calls[0]![1] as unknown[]
      const detailsJson = callArgs[2] as string
      const parsed = JSON.parse(detailsJson)
      expect(parsed.password).toBe('[REDACTED]')
      expect(parsed.mnemonic).toBe('[REDACTED]')
      expect(parsed.name).toBe('Test')
    })

    it('should redact case-insensitively', async () => {
      await logAuditAction('wallet_created', {
        details: { Password: 'secret', WIF: 'L1test', PrivateKey: 'hex' },
      })

      const callArgs = mockDbExecute.mock.calls[0]![1] as unknown[]
      const detailsJson = callArgs[2] as string
      const parsed = JSON.parse(detailsJson)
      expect(parsed.Password).toBe('[REDACTED]')
      expect(parsed.WIF).toBe('[REDACTED]')
      expect(parsed.PrivateKey).toBe('[REDACTED]')
    })

    it('should truncate oversized details by filtering large values', async () => {
      const largeDetails: Record<string, unknown> = {}
      // Create details larger than 10KB with some values > 1024 chars
      for (let i = 0; i < 20; i++) {
        largeDetails[`field_${i}`] = 'x'.repeat(2000) // > 1024 chars, will be excluded
      }
      largeDetails['small_field'] = 'kept' // < 1024 chars, will be kept

      await logAuditAction('wallet_created', { details: largeDetails })

      // Should still execute (truncated)
      expect(mockDbExecute).toHaveBeenCalled()
      const callArgs = mockDbExecute.mock.calls[0]![1] as unknown[]
      const detailsJson = callArgs[2] as string
      const parsed = JSON.parse(detailsJson)
      // Only the small field should survive truncation
      expect(parsed.small_field).toBe('kept')
      // Large fields should be excluded
      expect(parsed.field_0).toBeUndefined()
    })

    it('should pass accountId, origin, txid options', async () => {
      await logAuditAction('transaction_sent', {
        accountId: 42,
        origin: 'https://app.com',
        txid: 'abc123',
        success: true,
      })

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([42, 'https://app.com', 'abc123', 1])
      )
    })

    it('should set success to 0 when explicitly false', async () => {
      await logAuditAction('unlock_failed', { success: false })

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0])
      )
    })

    it('should not throw on database error', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB down'))

      await expect(logAuditAction('wallet_created')).resolves.toBeUndefined()
    })
  })

  // =========================================================================
  // getRecentAuditLogs
  // =========================================================================

  describe('getRecentAuditLogs', () => {
    it('should return recent audit log entries', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, timestamp: 1000, action: 'wallet_created', details: null, accountId: null, origin: null, txid: null, success: 1 },
        { id: 2, timestamp: 2000, action: 'wallet_unlocked', details: '{"reason":"login"}', accountId: 1, origin: null, txid: null, success: 1 },
      ])

      const result = await getRecentAuditLogs()

      expect(result).toHaveLength(2)
      expect(result[0]!.action).toBe('wallet_created')
      expect(result[1]!.details).toEqual({ reason: 'login' })
    })

    it('should use default limit of 100', async () => {
      await getRecentAuditLogs()

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        [100]
      )
    })

    it('should cap limit at MAX_QUERY_LIMIT (1000)', async () => {
      await getRecentAuditLogs(5000)

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        [1000]
      )
    })

    it('should return empty array on database error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getRecentAuditLogs()

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // getAuditLogsByAction
  // =========================================================================

  describe('getAuditLogsByAction', () => {
    it('should filter by action type', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, timestamp: 1000, action: 'wallet_locked', details: null, accountId: null, origin: null, txid: null, success: 1 },
      ])

      const result = await getAuditLogsByAction('wallet_locked')

      expect(result).toHaveLength(1)
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('WHERE action = ?'),
        ['wallet_locked', 100]
      )
    })

    it('should return empty array on error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getAuditLogsByAction('wallet_locked')

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // getAuditLogsByAccount
  // =========================================================================

  describe('getAuditLogsByAccount', () => {
    it('should filter by account ID', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, timestamp: 1000, action: 'transaction_sent', details: '{"amount":5000}', accountId: 42, origin: null, txid: 'tx1', success: 1 },
      ])

      const result = await getAuditLogsByAccount(42)

      expect(result).toHaveLength(1)
      expect(result[0]!.details).toEqual({ amount: 5000 })
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('WHERE account_id = ?'),
        [42, 100]
      )
    })

    it('should return empty array on error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getAuditLogsByAccount(42)

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // exportAuditLogs
  // =========================================================================

  describe('exportAuditLogs', () => {
    it('should return all audit logs ordered by timestamp ASC', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, timestamp: 1000, action: 'wallet_created', details: null, accountId: null, origin: null, txid: null, success: 1 },
        { id: 2, timestamp: 2000, action: 'wallet_unlocked', details: null, accountId: null, origin: null, txid: null, success: 1 },
      ])

      const result = await exportAuditLogs()

      expect(result).toHaveLength(2)
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY timestamp ASC')
      )
    })

    it('should return empty array on error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await exportAuditLogs()

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // clearOldAuditLogs
  // =========================================================================

  describe('clearOldAuditLogs', () => {
    it('should delete entries older than given timestamp', async () => {
      mockDbExecute.mockResolvedValue({ rowsAffected: 5 })

      const result = await clearOldAuditLogs(1000)

      expect(result).toBe(5)
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM audit_log WHERE timestamp < ?'),
        [1000]
      )
    })

    it('should use default 90-day retention when no timestamp given', async () => {
      mockDbExecute.mockResolvedValue({ rowsAffected: 0 })

      await clearOldAuditLogs()

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        [expect.any(Number)]
      )
    })

    it('should return 0 on error', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB error'))

      const result = await clearOldAuditLogs(1000)

      expect(result).toBe(0)
    })
  })

  // =========================================================================
  // getFailedUnlockAttempts
  // =========================================================================

  describe('getFailedUnlockAttempts', () => {
    it('should query for unlock_failed actions', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, timestamp: 5000, action: 'unlock_failed', details: '{"reason":"wrong password"}', accountId: null, origin: null, txid: null, success: 0 },
      ])

      const result = await getFailedUnlockAttempts()

      expect(result).toHaveLength(1)
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining("action = 'unlock_failed'"),
        [expect.any(Number)]
      )
    })

    it('should accept custom since parameter', async () => {
      mockDbSelect.mockResolvedValue([])

      await getFailedUnlockAttempts(1234)

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        [1234]
      )
    })

    it('should return empty array on error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getFailedUnlockAttempts()

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // auditLogRepository
  // =========================================================================

  describe('auditLogRepository', () => {
    it('should delegate log to logAuditAction', async () => {
      await auditLogRepository.log('wallet_created', { name: 'test' })

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should delegate getRecent to getRecentAuditLogs', async () => {
      mockDbSelect.mockResolvedValue([])

      const result = await auditLogRepository.getRecent(50)

      expect(result).toEqual([])
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        [50]
      )
    })

    it('should delegate getByAction', async () => {
      mockDbSelect.mockResolvedValue([])

      await auditLogRepository.getByAction('wallet_locked', 10)

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('WHERE action = ?'),
        ['wallet_locked', 10]
      )
    })

    it('should delegate getByAccount', async () => {
      mockDbSelect.mockResolvedValue([])

      await auditLogRepository.getByAccount(42, 25)

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('WHERE account_id = ?'),
        [42, 25]
      )
    })

    it('should delegate exportAll', async () => {
      mockDbSelect.mockResolvedValue([])

      await auditLogRepository.exportAll()

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY timestamp ASC')
      )
    })

    it('should delegate clearOlderThan', async () => {
      mockDbExecute.mockResolvedValue({ rowsAffected: 3 })

      const result = await auditLogRepository.clearOlderThan(5000)

      expect(result).toBe(3)
    })
  })

  // =========================================================================
  // audit convenience object
  // =========================================================================

  describe('audit convenience functions', () => {
    it('should log walletCreated', async () => {
      await audit.walletCreated(1)

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['wallet_created', 1])
      )
    })

    it('should log walletRestored', async () => {
      await audit.walletRestored(2)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log walletUnlocked', async () => {
      await audit.walletUnlocked(1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log walletLocked', async () => {
      await audit.walletLocked()

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log unlockFailed with reason', async () => {
      await audit.unlockFailed(1, 'wrong password')

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log transactionSent', async () => {
      await audit.transactionSent('txid123', 5000, 1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log transactionReceived', async () => {
      await audit.transactionReceived('txid456', 10000, 1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log lockCreated', async () => {
      await audit.lockCreated('txid789', 50000, 850000, 1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log lockReleased', async () => {
      await audit.lockReleased('txid789', 50000)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log originTrusted', async () => {
      await audit.originTrusted('https://app.com', 1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log originRemoved', async () => {
      await audit.originRemoved('https://app.com')

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log appConnected', async () => {
      await audit.appConnected('https://app.com', 1)

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log appDisconnected', async () => {
      await audit.appDisconnected('https://app.com')

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log accountCreated', async () => {
      await audit.accountCreated(2, 'Savings')

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log accountDeleted', async () => {
      await audit.accountDeleted(2, 'Savings')

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should log accountSwitched', async () => {
      await audit.accountSwitched(1, 2)

      expect(mockDbExecute).toHaveBeenCalled()
    })
  })
})
