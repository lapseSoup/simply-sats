/**
 * EmptyState Component
 *
 * Displays a friendly message when a list or view has no content.
 * Supports different visual styles and optional call-to-action.
 */

import type { ReactNode } from 'react'

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

export function EmptyState({
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

      <style>{`
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 32px 24px;
        }

        .empty-state-small {
          padding: 16px;
        }

        .empty-state-small .empty-state-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }

        .empty-state-small .empty-state-title {
          font-size: 14px;
        }

        .empty-state-small .empty-state-description {
          font-size: 12px;
        }

        .empty-state-medium .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .empty-state-medium .empty-state-title {
          font-size: 16px;
        }

        .empty-state-medium .empty-state-description {
          font-size: 13px;
        }

        .empty-state-large {
          padding: 48px 24px;
        }

        .empty-state-large .empty-state-icon {
          font-size: 64px;
          margin-bottom: 24px;
        }

        .empty-state-large .empty-state-title {
          font-size: 20px;
        }

        .empty-state-large .empty-state-description {
          font-size: 14px;
        }

        .empty-state-icon {
          color: var(--text-tertiary);
          line-height: 1;
        }

        .empty-state-title {
          margin: 0 0 8px 0;
          font-weight: 600;
          color: var(--text-primary);
        }

        .empty-state-description {
          margin: 0;
          color: var(--text-secondary);
          max-width: 280px;
          line-height: 1.5;
        }

        .empty-state-action {
          margin-top: 16px;
        }
      `}</style>
    </div>
  )
}

// Pre-configured empty states for common use cases

export function NoTransactionsEmpty({ onReceive }: { onReceive?: () => void }) {
  return (
    <EmptyState
      icon="📭"
      title="No transactions yet"
      description="Your transaction history will appear here once you send or receive BSV."
      action={onReceive ? { label: 'Receive BSV', onClick: onReceive } : undefined}
    />
  )
}

export function NoOrdinalsEmpty({ onReceive }: { onReceive?: () => void }) {
  return (
    <EmptyState
      icon="🎨"
      title="No ordinals found"
      description="1Sat Ordinal inscriptions you own will appear here."
      action={onReceive ? { label: 'View Ordinals Address', onClick: onReceive } : undefined}
    />
  )
}

export function NoTokensEmpty() {
  return (
    <EmptyState
      icon="🪙"
      title="No tokens found"
      description="BSV-20 and BSV-21 tokens you own will appear here."
    />
  )
}

export function NoLocksEmpty({ onLock }: { onLock?: () => void }) {
  return (
    <EmptyState
      icon="🔒"
      title="No time-locked sats"
      description="Lock your sats until a future block height. Perfect for HODLing!"
      action={onLock ? { label: 'Lock Sats', onClick: onLock } : undefined}
    />
  )
}

export function NoContactsEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon="👥"
      title="No contacts yet"
      description="Add contacts to easily send and receive payments."
      action={onAdd ? { label: 'Add Contact', onClick: onAdd } : undefined}
      size="small"
    />
  )
}

export function NoSearchResultsEmpty() {
  return (
    <EmptyState
      icon="🔍"
      title="No results found"
      description="Try adjusting your search or filter criteria."
      size="small"
    />
  )
}

export function ErrorStateEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      title="Something went wrong"
      description="We couldn't load this content. Please try again."
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
    />
  )
}
