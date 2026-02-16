/**
 * Backup Reminder Service
 *
 * Tracks when the user last verified their backup mnemonic
 * and prompts them periodically to re-verify.
 */

import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

const BACKUP_REMINDER_KEY = STORAGE_KEYS.BACKUP_REMINDER
const BACKUP_REMINDER_INTERVAL_DAYS = 30

/**
 * Record that the user has verified their backup
 */
export function recordBackupVerification(): void {
  localStorage.setItem(BACKUP_REMINDER_KEY, Date.now().toString())
}

/**
 * Check if the user needs a backup reminder
 * Returns true if >30 days since last verification or never verified
 */
export function needsBackupReminder(): boolean {
  const lastVerified = localStorage.getItem(BACKUP_REMINDER_KEY)
  if (!lastVerified) return true

  const lastVerifiedMs = parseInt(lastVerified, 10)
  if (isNaN(lastVerifiedMs)) return true

  const daysSince = (Date.now() - lastVerifiedMs) / (1000 * 60 * 60 * 24)
  return daysSince >= BACKUP_REMINDER_INTERVAL_DAYS
}

/**
 * Get days since last backup verification
 * Returns null if never verified
 */
export function daysSinceLastBackup(): number | null {
  const lastVerified = localStorage.getItem(BACKUP_REMINDER_KEY)
  if (!lastVerified) return null

  const lastVerifiedMs = parseInt(lastVerified, 10)
  if (isNaN(lastVerifiedMs)) return null

  return Math.floor((Date.now() - lastVerifiedMs) / (1000 * 60 * 60 * 24))
}
