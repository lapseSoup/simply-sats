/**
 * Database Connection Management
 *
 * Handles database initialization, singleton access, and transactions.
 * Supports reentrant transactions via SAVEPOINT for nested calls.
 *
 * NOTE on connection pools: tauri-plugin-sql uses a sqlx SqlitePool (default 5
 * connections). Each `database.execute()` may run on a different pool connection.
 * This means BEGIN TRANSACTION, operations, and COMMIT may all run on different
 * connections — so SQLite transactions via this API are NOT reliable.
 *
 * withTransaction should only be used where idempotency is acceptable, or where
 * the caller can tolerate partial writes. For critical atomic operations, use
 * a single multi-statement execute() call (not yet supported by tauri-plugin-sql),
 * or accept individual auto-commit semantics.
 *
 * When a COMMIT fails (because BEGIN ran on a different connection), we attempt
 * to drain any dangling open transactions by issuing ROLLBACK multiple times
 * across all pool slots to avoid SQLITE_BUSY for subsequent writes.
 */

import Database from '@tauri-apps/plugin-sql'
import { dbLogger } from '../../services/logger'

// Database instance (singleton)
let db: Database | null = null

// Transaction queue — serializes all transactions to prevent concurrent corruption
let transactionQueue: Promise<unknown> = Promise.resolve()
// Transaction nesting depth (0 = no active transaction)
let transactionDepth = 0
// Whether we're currently inside the serialized queue (guards direct executeTransaction calls)
let isInsideQueue = false

// sqlx SqlitePool default max_connections (tauri-plugin-sql v2)
const POOL_SIZE = 5

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db

  db = await Database.load('sqlite:simplysats.db')
  dbLogger.info('Database initialized')
  return db
}

/**
 * Get database instance (must call initDatabase first)
 */
export function getDatabase(): Database {
  if (!db) {
    dbLogger.error('Database not initialized — call initDatabase() first')
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * Execute multiple database operations within a transaction.
 * Supports reentrant calls: nested withTransaction uses SAVEPOINT
 * so inner failures roll back only to the savepoint, not the outer transaction.
 */
export async function withTransaction<T>(
  operations: () => Promise<T>
): Promise<T> {
  // If this is a top-level transaction (depth === 0), serialize via queue
  // to prevent concurrent BEGIN/COMMIT corruption.
  // Nested calls (SAVEPOINTs) run inside the outer transaction's queue slot.
  if (transactionDepth === 0) {
    const result = new Promise<T>((resolve, reject) => {
      transactionQueue = transactionQueue.then(async () => {
        isInsideQueue = true
        try {
          const r = await executeTransaction(operations)
          resolve(r)
        } catch (e) {
          reject(e)
        } finally {
          isInsideQueue = false
        }
      })
    })
    return result
  }
  // Nested call — already inside a serialized slot
  return executeTransaction(operations)
}

async function executeTransaction<T>(
  operations: () => Promise<T>
): Promise<T> {
  // Guard: top-level calls must go through the queue (via withTransaction)
  if (transactionDepth === 0 && !isInsideQueue) {
    throw new Error('executeTransaction must be called via withTransaction()')
  }

  const database = getDatabase()
  const depth = transactionDepth++

  try {
    if (depth === 0) {
      await database.execute('BEGIN TRANSACTION')
    } else {
      await database.execute(`SAVEPOINT sp_${depth}`)
    }

    const result = await operations()

    if (depth === 0) {
      await database.execute('COMMIT')
    } else {
      await database.execute(`RELEASE SAVEPOINT sp_${depth}`)
    }
    return result
  } catch (error) {
    if (depth === 0) {
      // COMMIT or operation failed. Since BEGIN ran on one pool connection and
      // COMMIT may have run on another (and failed), there may be a dangling
      // open transaction on a pool connection holding a write lock. Issue
      // ROLLBACK across all pool slots to clean up any dangling transactions.
      // ROLLBACK on connections with no active transaction is a no-op in SQLite.
      await drainDanglingTransactions(database)
    } else {
      try {
        await database.execute(`ROLLBACK TO SAVEPOINT sp_${depth}`)
      } catch (rollbackError) {
        dbLogger.error('Failed to rollback savepoint', rollbackError)
      }
    }
    throw error
  } finally {
    transactionDepth = depth
  }
}

/**
 * Issue ROLLBACK across all pool connections to clear any dangling BEGIN
 * TRANSACTION that may have been left open when COMMIT ran on a different
 * pool connection than the one that issued BEGIN.
 *
 * SQLite ignores ROLLBACK when no transaction is active, so this is safe.
 */
async function drainDanglingTransactions(database: Database): Promise<void> {
  const rollbacks: Promise<void>[] = []
  for (let i = 0; i < POOL_SIZE; i++) {
    rollbacks.push(
      database.execute('ROLLBACK').then(() => undefined).catch((_e: unknown) => {
        // "cannot rollback - no transaction is active" is expected for most
        // connections. Only log unexpected errors.
        const msg = String(_e)
        if (!msg.includes('no transaction') && !msg.includes('cannot rollback')) {
          dbLogger.warn('Unexpected error during drain rollback', { error: msg })
        }
      })
    )
  }
  await Promise.allSettled(rollbacks)
}

/**
 * Close the database connection (for testing/cleanup)
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close()
    db = null
    dbLogger.info('Database connection closed')
  }
}
