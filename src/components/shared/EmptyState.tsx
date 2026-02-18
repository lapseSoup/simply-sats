/**
 * EmptyState Component
 *
 * Displays a friendly message when a list or view has no content.
 * Supports different visual styles and optional call-to-action.
 */

import { memo } from 'react'
import type { ReactNode } from 'react'
import {
  Inbox,
  Image,
  Coins,
  Lock,
  Users,
  Search,
  AlertTriangle
} from 'lucide-react'

interface EmptyStateProps {
  /** Icon or emoji to display */
  icon?: ReactNode
  /** Main title/heading */
  title: string
  /** Description text */
  description?: string
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
  }
  /** Visual size variant */
  size?: 'small' | 'medium' | 'large'
  /** Additional CSS class */
  className?: string
}

export const EmptyState = memo(function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'medium',
  className = ''
}: EmptyStateProps) {
  return (
    <div className={`empty-state empty-state-${size} ${className}`}>
      {icon && (
        <div className="empty-state-icon">
          {icon}
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && (
        <p className="empty-state-description">{description}</p>
      )}
      {action && (
        <button
          className="empty-state-action btn btn-primary"
          onClick={action.onClick}
          type="button"
        >
          {action.label}
        </button>
      )}
    </div>
  )
})

// Pre-configured empty states for common use cases

export function NoTransactionsEmpty({ onReceive }: { onReceive?: () => void }) {
  return (
    <EmptyState
      icon={<Inbox size={48} strokeWidth={1.5} />}
      title="No Transactions Yet"
      description="Your transaction history will appear here."
      action={onReceive ? { label: 'Receive BSV', onClick: onReceive } : undefined}
    />
  )
}

export function NoOrdinalsEmpty({ onReceive }: { onReceive?: () => void }) {
  return (
    <EmptyState
      icon={<Image size={48} strokeWidth={1.5} />}
      title="No Ordinals Yet"
      description="Your 1Sat ordinals will appear here once you receive them."
      action={onReceive ? { label: 'View Ordinals Address', onClick: onReceive } : undefined}
    />
  )
}

export function NoTokensEmpty({ onRefresh, loading }: { onRefresh?: () => void, loading?: boolean }) {
  return (
    <EmptyState
      icon={<Coins size={48} strokeWidth={1.5} />}
      title="No Tokens Found"
      description="You don't have any BSV20 or BSV21 tokens yet."
      action={onRefresh ? { label: loading ? 'Checking...' : 'Check Again', onClick: onRefresh } : undefined}
    />
  )
}

export function NoLocksEmpty({ onLock }: { onLock?: () => void }) {
  return (
    <EmptyState
      icon={<Lock size={48} strokeWidth={1.5} />}
      title="No Locks Yet"
      description="Lock your BSV until a specific block height. Great for savings goals and commitments."
      action={onLock ? { label: 'Lock Sats', onClick: onLock } : undefined}
    />
  )
}

export function NoContactsEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<Users size={48} strokeWidth={1.5} />}
      title="No Contacts Yet"
      description="Add contacts to easily send and receive payments."
      action={onAdd ? { label: 'Add Contact', onClick: onAdd } : undefined}
      size="small"
    />
  )
}

export function NoSearchResultsEmpty() {
  return (
    <EmptyState
      icon={<Search size={48} strokeWidth={1.5} />}
      title="No Results Found"
      description="Try adjusting your search or filter criteria."
      size="small"
    />
  )
}

export function ErrorStateEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={48} strokeWidth={1.5} />}
      title="Something Went Wrong"
      description="We couldn't load this content. Please try again."
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
    />
  )
}
