import { useState, useMemo, memo } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import type { Ordinal } from '../../services/wallet'

interface OrdinalsTabProps {
  onSelectOrdinal: (ordinal: Ordinal) => void
  onTransferOrdinal?: (ordinal: Ordinal) => void
}

type SortOption = 'newest' | 'oldest' | 'content'
type ViewMode = 'grid' | 'list'

// Content type categories for filtering
const CONTENT_CATEGORIES = {
  all: 'All',
  image: 'Images',
  text: 'Text',
  json: 'JSON',
  other: 'Other'
} as const

type ContentCategory = keyof typeof CONTENT_CATEGORIES

function getContentCategory(contentType: string | undefined): ContentCategory {
  if (!contentType) return 'other'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('text/')) return 'text'
  if (contentType.includes('json')) return 'json'
  return 'other'
}

function getContentIcon(contentType: string | undefined): string {
  const category = getContentCategory(contentType)
  switch (category) {
    case 'image':
      return '🖼️'
    case 'text':
      return '📝'
    case 'json':
      return '📋'
    default:
      return '🔮'
  }
}

export function OrdinalsTab({ onSelectOrdinal, onTransferOrdinal: _onTransferOrdinal }: OrdinalsTabProps) {
  // Note: _onTransferOrdinal is available for future use
  const { ordinals } = useWallet()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filterCategory, setFilterCategory] = useState<ContentCategory>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Filter and sort ordinals
  const filteredOrdinals = useMemo(() => {
    let result = [...ordinals]

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (ord) =>
          ord.origin.toLowerCase().includes(query) ||
          ord.contentType?.toLowerCase().includes(query)
      )
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      result = result.filter(
        (ord) => getContentCategory(ord.contentType) === filterCategory
      )
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          // Origin format includes txid, so we can use it as a proxy for age
          return a.origin.localeCompare(b.origin)
        case 'newest':
          return b.origin.localeCompare(a.origin)
        case 'content':
          return (a.contentType || '').localeCompare(b.contentType || '')
        default:
          return 0
      }
    })

    return result
  }, [ordinals, searchQuery, sortBy, filterCategory])

  // Count ordinals by category for filter badges
  const categoryCounts = useMemo(() => {
    const counts: Record<ContentCategory, number> = {
      all: ordinals.length,
      image: 0,
      text: 0,
      json: 0,
      other: 0
    }

    ordinals.forEach((ord) => {
      const category = getContentCategory(ord.contentType)
      counts[category]++
    })

    return counts
  }, [ordinals])

  if (ordinals.length === 0) {
    return (
      <div className="ordinals-tab">
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">🔮</div>
          <div className="empty-title">No Ordinals Yet</div>
          <div className="empty-text">
            Your 1Sat ordinals will appear here once you receive them.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ordinals-tab">
      {/* Search and Filter Bar */}
      <div className="ordinals-controls">
        <div className="ordinals-search">
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search by origin or content type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search ordinals"
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="ordinals-view-toggle">
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <span aria-hidden="true">⊞</span>
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="ordinals-filters" role="group" aria-label="Filter by content type">
        {(Object.keys(CONTENT_CATEGORIES) as ContentCategory[]).map((category) => (
          <button
            key={category}
            className={`filter-chip ${filterCategory === category ? 'active' : ''}`}
            onClick={() => setFilterCategory(category)}
            aria-pressed={filterCategory === category}
          >
            {CONTENT_CATEGORIES[category]}
            <span className="filter-count">{categoryCounts[category]}</span>
          </button>
        ))}
      </div>

      {/* Sort Controls */}
      <div className="ordinals-sort">
        <label htmlFor="sort-select" className="sort-label">Sort by:</label>
        <select
          id="sort-select"
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="content">Content Type</option>
        </select>
      </div>

      {/* Results Summary */}
      {(searchQuery || filterCategory !== 'all') && (
        <div className="ordinals-results-summary">
          Showing {filteredOrdinals.length} of {ordinals.length} ordinals
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      )}

      {/* Ordinals Display */}
      {filteredOrdinals.length === 0 ? (
        <div className="empty-state small">
          <div className="empty-icon" aria-hidden="true">🔍</div>
          <div className="empty-title">No Results</div>
          <div className="empty-text">
            No ordinals match your search criteria.
            <button className="btn-link" onClick={() => {
              setSearchQuery('')
              setFilterCategory('all')
            }}>
              Clear filters
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="ordinals-grid" role="list" aria-label="Ordinals collection">
          {filteredOrdinals.map((ord) => (
            <OrdinalGridItem
              key={ord.origin}
              ordinal={ord}
              onSelect={onSelectOrdinal}
            />
          ))}
        </div>
      ) : (
        <div className="ordinals-list" role="list" aria-label="Ordinals collection">
          {filteredOrdinals.map((ord) => (
            <OrdinalListItem
              key={ord.origin}
              ordinal={ord}
              onSelect={onSelectOrdinal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface OrdinalItemProps {
  ordinal: Ordinal
  onSelect: (ordinal: Ordinal) => void
}

const OrdinalGridItem = memo(function OrdinalGridItem({ ordinal, onSelect }: OrdinalItemProps) {
  const icon = getContentIcon(ordinal.contentType)

  return (
    <div
      className="ordinal-card"
      onClick={() => onSelect(ordinal)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(ordinal)}
      aria-label={`Ordinal ${ordinal.origin.slice(0, 8)}`}
    >
      <div className="ordinal-card-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="ordinal-card-info">
        <div className="ordinal-card-id">
          {ordinal.origin.slice(0, 8)}...
        </div>
        {ordinal.contentType && (
          <div className="ordinal-card-type">
            {ordinal.contentType.split('/')[1] || ordinal.contentType}
          </div>
        )}
      </div>
    </div>
  )
})

const OrdinalListItem = memo(function OrdinalListItem({ ordinal, onSelect }: OrdinalItemProps) {
  const icon = getContentIcon(ordinal.contentType)

  return (
    <div
      className="ordinal-list-item"
      onClick={() => onSelect(ordinal)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(ordinal)}
      aria-label={`Ordinal ${ordinal.origin}`}
    >
      <div className="ordinal-list-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="ordinal-list-info">
        <div className="ordinal-list-id">{ordinal.origin}</div>
        <div className="ordinal-list-meta">
          {ordinal.contentType && (
            <span className="ordinal-content-type">{ordinal.contentType}</span>
          )}
        </div>
      </div>
      <div className="ordinal-list-arrow" aria-hidden="true">→</div>
    </div>
  )
})
