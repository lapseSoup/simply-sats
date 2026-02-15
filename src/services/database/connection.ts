/**
 * Database Connection Management
 *
 * Handles database initialization, singleton access, and transactions.
 */

import Database from '@tauri-apps/plugin-sql'
import { dbLogger } from '../logger'

// Database instance (singleton)
let db: Database | null = null

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
 * Execute multiple database operations within a transaction
 * If any operation fails, all changes are rolled back
 */
export async function withTransaction<T>(
  operations: () => Promise<T>
): Promise<T> {
  const database = getDatabase()

  try {
    await database.execute('BEGIN TRANSACTION')
    const result = await operations()
    await database.execute('COMMIT')
    return result
  } catch (error) {
    await database.execute('ROLLBACK')
    throw error
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
