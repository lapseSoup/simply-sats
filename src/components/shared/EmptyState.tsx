/**
 * EmptyState Component
 *
 * Displays a friendly message when a list or view has no content.
 * Supports different visual styles and optional call-to-action.
 */

import type { ReactNode } from 'react'

// SVG Icons for empty states
const iconSize = { width: 48, height: 48 }
const iconStyle = { color: 'var(--text-tertiary)' }

const InboxIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

const ImageIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

const CoinIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 6v12" />
    <path d="M15 9.5c0-1-1.5-2-3-2s-3 .5-3 2c0 2 6 1 6 3.5 0 1.5-1.5 2.5-3 2.5s-3-1-3-2" />
  </svg>
)

const LockIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

const UsersIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const SearchIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

const AlertIcon = () => (
  <svg {...iconSize} style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

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
      icon={<InboxIcon />}
      title="No Transactions Yet"
      description="Your transaction history will appear here"
      action={onReceive ? { label: 'Receive BSV', onClick: onReceive } : undefined}
    />
  )
}

export function NoOrdinalsEmpty({ onReceive }: { onReceive?: () => void }) {
  return (
    <EmptyState
      icon={<ImageIcon />}
      title="No Ordinals Yet"
      description="Your 1Sat ordinals will appear here once you receive them."
      action={onReceive ? { label: 'View Ordinals Address', onClick: onReceive } : undefined}
    />
  )
}

export function NoTokensEmpty() {
  return (
    <EmptyState
      icon={<CoinIcon />}
      title="No Tokens Yet"
      description="BSV-20 and BSV-21 tokens you own will appear here."
    />
  )
}

export function NoLocksEmpty({ onLock }: { onLock?: () => void }) {
  return (
    <EmptyState
      icon={<LockIcon />}
      title="No Locks Yet"
      description="Lock your BSV until a specific block height. Great for savings goals and commitments."
      action={onLock ? { label: 'Lock Sats', onClick: onLock } : undefined}
    />
  )
}

export function NoContactsEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<UsersIcon />}
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
      icon={<SearchIcon />}
      title="No results found"
      description="Try adjusting your search or filter criteria."
      size="small"
    />
  )
}

export function ErrorStateEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertIcon />}
      title="Something went wrong"
      description="We couldn't load this content. Please try again."
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
    />
  )
}
