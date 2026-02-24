/**
 * Ordinal Cache Service Facade
 *
 * Thin service layer over infrastructure/database/ordinalRepository.
 * Provides a clean import boundary so that contexts don't reach
 * directly into the infrastructure layer (architecture rule:
 * Components → Hooks → Contexts → Services → Infrastructure).
 */

export {
  upsertOrdinalCache,
  batchUpsertOrdinalCache,
  markOrdinalTransferred,
  getAllCachedOrdinalOrigins,
  getCachedOrdinalContent,
  getBatchOrdinalContent,
  upsertOrdinalContent,
  hasOrdinalContent,
  getCachedOrdinals,
  ensureOrdinalCacheRowForTransferred,
} from '../infrastructure/database/ordinalRepository'

export type { CachedOrdinal } from '../infrastructure/database/types'
