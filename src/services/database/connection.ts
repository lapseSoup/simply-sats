/**
 * Database Connection Management
 *
 * Handles database initialization, singleton access, and transactions.
 * Supports reentrant transactions via SAVEPOINT for nested calls.
 */

import Database from '@tauri-apps/plugin-sql'
import { dbLogger } from '../logger'

// Database instance (singleton)
let db: Database | null = null

// Transaction queue — serializes all transactions to prevent concurrent corruption
let transactionQueue: Promise<unknown> = Promise.resolve()
// Transaction nesting depth (0 = no active transaction)
let transactionDepth = 0
// Whether we're currently inside the serialized queue (guards direct executeTransaction calls)
let isInsideQueue = false

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
    try {
      if (depth === 0) {
        await database.execute('ROLLBACK')
      } else {
        await database.execute(`ROLLBACK TO SAVEPOINT sp_${depth}`)
      }
    } catch (rollbackError) {
      dbLogger.error('Failed to rollback', rollbackError)
    }
    throw error
  } finally {
    transactionDepth = depth
  }
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
