/**
 * Skeleton Loading Components
 *
 * Provides various skeleton placeholders for loading states.
 * Uses CSS animations for a smooth pulsing effect.
 */

import { memo } from 'react'
import type { CSSProperties } from 'react'

interface SkeletonProps {
  /** Width of the skeleton (CSS value) */
  width?: string | number
  /** Height of the skeleton (CSS value) */
  height?: string | number
  /** Border radius (CSS value) */
  borderRadius?: string | number
  /** Additional CSS class */
  className?: string
  /** Additional inline styles */
  style?: CSSProperties
  /** Variant type for common shapes */
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded'
}

/**
 * Base skeleton component with customizable dimensions
 */
export const Skeleton = memo(function Skeleton({
  width = '100%',
  height = '1em',
  borderRadius,
  className = '',
  style = {},
  variant = 'text'
}: SkeletonProps) {
  const getVariantStyles = (): CSSProperties => {
    switch (variant) {
      case 'circular':
        return { borderRadius: '50%' }
      case 'rectangular':
        return { borderRadius: 0 }
      case 'rounded':
        return { borderRadius: '8px' }
      case 'text':
      default:
        return { borderRadius: '4px' }
    }
  }

  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: borderRadius !== undefined
          ? (typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius)
          : undefined,
        ...getVariantStyles(),
        ...style
      }}
      aria-hidden="true"
    />
  )
})

/**
 * Skeleton for balance display
 */
export function BalanceSkeleton() {
  return (
    <div className="balance-skeleton">
      <Skeleton width={180} height={48} variant="rounded" className="balance-main" />
      <Skeleton width={100} height={20} variant="rounded" className="balance-usd" />
    </div>
  )
}

/**
 * Skeleton for a single list item (transaction, ordinal, etc.)
 */
export function ListItemSkeleton() {
  return (
    <div className="list-item-skeleton">
      <Skeleton width={40} height={40} variant="circular" />
      <div className="list-item-skeleton-content">
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={12} />
      </div>
      <Skeleton width={60} height={16} />
    </div>
  )
}

/**
 * Skeleton for ordinal grid item
 */
export function OrdinalGridSkeleton() {
  return (
    <div className="ordinal-grid-skeleton">
      <Skeleton width="100%" height={0} style={{ paddingBottom: '100%' }} variant="rounded" />
    </div>
  )
}

/**
 * Skeleton for ordinal grid (multiple items)
 */
export function OrdinalsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="ordinals-grid-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <OrdinalGridSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Skeleton for transaction/activity list
 */
export function ActivityListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="activity-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <ListItemSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Skeleton for token balance row
 */
export function TokenRowSkeleton() {
  return (
    <div className="token-row-skeleton">
      <Skeleton width={32} height={32} variant="circular" />
      <div className="token-row-skeleton-content">
        <Skeleton width={80} height={14} />
        <Skeleton width={50} height={12} />
      </div>
      <div className="token-row-skeleton-balance">
        <Skeleton width={70} height={14} />
        <Skeleton width={50} height={12} />
      </div>
    </div>
  )
}

/**
 * Skeleton for tokens list
 */
export function TokensListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="tokens-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <TokenRowSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Skeleton for lock item
 */
export function LockItemSkeleton() {
  return (
    <div className="lock-item-skeleton">
      <div className="lock-item-skeleton-header">
        <Skeleton width={100} height={20} variant="rounded" />
        <Skeleton width={60} height={16} variant="rounded" />
      </div>
      <Skeleton width="100%" height={8} variant="rounded" className="lock-progress" />
      <div className="lock-item-skeleton-footer">
        <Skeleton width={120} height={12} />
        <Skeleton width={80} height={12} />
      </div>
    </div>
  )
}

/**
 * Skeleton for locks list
 */
export function LocksListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="locks-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <LockItemSkeleton key={i} />
      ))}
    </div>
  )
}
