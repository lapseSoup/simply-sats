import type { TxHistoryItem } from '../../domain/types'

export type { TxHistoryItem }

export function formatTxDate(height: number, currentHeight: number, createdAt?: number): string | null {
  const effectiveTs: number | null = (height > 0 && currentHeight > 0)
    ? Date.now() - (currentHeight - height) * 10 * 60 * 1000
    : (createdAt ?? null)

  if (!effectiveTs || effectiveTs <= 0) return null

  const diff = Date.now() - effectiveTs
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`

  const txDate = new Date(effectiveTs)
  return txDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(txDate.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
  })
}
