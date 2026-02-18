/**
 * Action Repository
 *
 * Operations for BRC-100 action results tracking.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../../services/logger'
import type { ActionResult } from './types'
import type { ActionResultRow, SqlParams } from './row-types'

/**
 * Ensure action_results table exists
 */
export async function ensureActionResultsTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS action_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        action_type TEXT NOT NULL,
        description TEXT,
        origin TEXT,
        txid TEXT,
        approved INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        input_params TEXT,
        output_result TEXT,
        requested_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_txid ON action_results(txid)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_origin ON action_results(origin)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_requested ON action_results(requested_at)')
  } catch (e) {
    dbLogger.error('Failed to ensure action_results table:', e)
  }
}

/**
 * Record a BRC-100 action request
 */
export async function recordActionRequest(action: Omit<ActionResult, 'id'>): Promise<number> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const result = await database.execute(
    `INSERT INTO action_results
     (request_id, action_type, description, origin, txid, approved, error, input_params, output_result, requested_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      action.requestId,
      action.actionType,
      action.description || null,
      action.origin || null,
      action.txid || null,
      action.approved ? 1 : 0,
      action.error || null,
      action.inputParams || null,
      action.outputResult || null,
      action.requestedAt,
      action.completedAt || null
    ]
  )

  return result.lastInsertId as number
}

/**
 * Update an action result after completion
 */
export async function updateActionResult(
  requestId: string,
  updates: Partial<Pick<ActionResult, 'txid' | 'approved' | 'error' | 'outputResult' | 'completedAt'>>
): Promise<void> {
  const database = getDatabase()

  const setClauses: string[] = []
  const params: SqlParams = []
  let paramIndex = 1

  if (updates.txid !== undefined) {
    setClauses.push(`txid = $${paramIndex++}`)
    params.push(updates.txid)
  }
  if (updates.approved !== undefined) {
    setClauses.push(`approved = $${paramIndex++}`)
    params.push(updates.approved ? 1 : 0)
  }
  if (updates.error !== undefined) {
    setClauses.push(`error = $${paramIndex++}`)
    params.push(updates.error)
  }
  if (updates.outputResult !== undefined) {
    setClauses.push(`output_result = $${paramIndex++}`)
    params.push(updates.outputResult)
  }
  if (updates.completedAt !== undefined) {
    setClauses.push(`completed_at = $${paramIndex++}`)
    params.push(updates.completedAt)
  }

  if (setClauses.length > 0) {
    params.push(requestId)
    await database.execute(
      `UPDATE action_results SET ${setClauses.join(', ')} WHERE request_id = $${paramIndex}`,
      params
    )
  }
}

/**
 * Get recent action results
 */
export async function getRecentActionResults(limit = 50): Promise<ActionResult[]> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<ActionResultRow[]>(
    'SELECT * FROM action_results ORDER BY requested_at DESC LIMIT $1',
    [limit]
  )

  return rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description ?? '',
    origin: row.origin ?? undefined,
    txid: row.txid ?? undefined,
    approved: row.approved === 1,
    error: row.error ?? undefined,
    inputParams: row.input_params ?? undefined,
    outputResult: row.output_result ?? undefined,
    requestedAt: row.requested_at,
    completedAt: row.completed_at ?? undefined
  }))
}

/**
 * Get action results by origin (app)
 */
export async function getActionResultsByOrigin(origin: string, limit = 50): Promise<ActionResult[]> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<ActionResultRow[]>(
    'SELECT * FROM action_results WHERE origin = $1 ORDER BY requested_at DESC LIMIT $2',
    [origin, limit]
  )

  return rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description ?? '',
    origin: row.origin ?? undefined,
    txid: row.txid ?? undefined,
    approved: row.approved === 1,
    error: row.error ?? undefined,
    inputParams: row.input_params ?? undefined,
    outputResult: row.output_result ?? undefined,
    requestedAt: row.requested_at,
    completedAt: row.completed_at ?? undefined
  }))
}

/**
 * Get action result by transaction ID
 */
export async function getActionResultByTxid(txid: string): Promise<ActionResult | null> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<ActionResultRow[]>(
    'SELECT * FROM action_results WHERE txid = $1',
    [txid]
  )

  if (rows.length === 0) return null

  const row = rows[0]!
  return {
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description ?? '',
    origin: row.origin ?? undefined,
    txid: row.txid ?? undefined,
    approved: row.approved === 1,
    error: row.error ?? undefined,
    inputParams: row.input_params ?? undefined,
    outputResult: row.output_result ?? undefined,
    requestedAt: row.requested_at,
    completedAt: row.completed_at ?? undefined
  }
}
