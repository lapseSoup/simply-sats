import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { Search, LayoutGrid, List as ListIcon, ChevronRight } from 'lucide-react'
import { List } from 'react-window'
import { useWallet } from '../../contexts/WalletContext'
import type { Ordinal } from '../../services/wallet'
import { NoOrdinalsEmpty } from '../shared/EmptyState'
import { OrdinalsGridSkeleton } from '../shared/Skeleton'
import { OrdinalImage } from '../shared/OrdinalImage'

const VIRTUALIZATION_THRESHOLD = 50
const ORDINAL_LIST_ITEM_HEIGHT = 68 // ~60px item + 8px gap

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

export function OrdinalsTab({ onSelectOrdinal, onTransferOrdinal: _onTransferOrdinal }: OrdinalsTabProps) {
  // Note: _onTransferOrdinal is available for future use
  const { ordinals, ordinalContentCache, loading } = useWallet()
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
    // Note: ordinals are stored in the order received from the API (newest first).
    // We use the original array index for time-based ordering since txid strings
    // are hashes and don't represent chronological order.
    if (sortBy === 'oldest') {
      result.reverse()
    } else if (sortBy === 'content') {
      result.sort((a, b) => (a.contentType || '').localeCompare(b.contentType || ''))
    }
    // 'newest' keeps the default API order (newest first)

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

  // Show skeleton during initial load (loading with no data yet)
  if (loading && ordinals.length === 0) {
    return (
      <div className="ordinals-tab">
        <OrdinalsGridSkeleton />
      </div>
    )
  }

  if (ordinals.length === 0) {
    return (
      <div className="ordinals-tab">
        <NoOrdinalsEmpty />
      </div>
    )
  }

  return (
    <div className="ordinals-tab">
      {/* Search and Filter Bar */}
      <div className="ordinals-controls">
        <div className="ordinals-search">
          <span className="search-icon" aria-hidden="true"><Search size={14} strokeWidth={1.75} /></span>
          <input
            type="text"
            className="search-input"
            placeholder="Search by origin or content type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
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
            <LayoutGrid size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <ListIcon size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Filter + Sort Dropdowns */}
      <div className="ordinals-toolbar">
        <select
          className="sort-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as ContentCategory)}
          aria-label="Filter ordinals by type"
        >
          {(Object.keys(CONTENT_CATEGORIES) as ContentCategory[]).map((category) => (
            <option key={category} value={category}>
              {CONTENT_CATEGORIES[category]} ({categoryCounts[category]})
            </option>
          ))}
        </select>
        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          aria-label="Sort ordinals"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="content">Type</option>
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
          <div className="empty-icon" aria-hidden="true"><Search size={24} strokeWidth={1.75} /></div>
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
              cachedContent={ordinalContentCache.get(ord.origin)}
            />
          ))}
        </div>
      ) : filteredOrdinals.length >= VIRTUALIZATION_THRESHOLD ? (
        <VirtualizedOrdinalList
          ordinals={filteredOrdinals}
          onSelect={onSelectOrdinal}
        />
      ) : (
        <div className="ordinals-list" role="list" aria-label="Ordinals collection">
          {filteredOrdinals.map((ord) => (
            <OrdinalListItem
              key={ord.origin}
              ordinal={ord}
              onSelect={onSelectOrdinal}
              cachedContent={ordinalContentCache.get(ord.origin)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface VirtualizedOrdinalListProps {
  ordinals: Ordinal[]
  onSelect: (ordinal: Ordinal) => void
}

function VirtualizedOrdinalList({ ordinals, onSelect }: VirtualizedOrdinalListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="ordinals-list-virtual-container" role="list" aria-label="Ordinals collection">
      <List
        rowCount={ordinals.length}
        rowHeight={ORDINAL_LIST_ITEM_HEIGHT}
        rowProps={{}}
        overscanCount={5}
        style={{ height: containerHeight }}
        rowComponent={({ index, style }) => (
          <div style={{ ...style, paddingBottom: 8 }}>
            <OrdinalListItem
              ordinal={ordinals[index]}
              onSelect={onSelect}
            />
          </div>
        )}
      />
    </div>
  )
}

interface OrdinalItemProps {
  ordinal: Ordinal
  onSelect: (ordinal: Ordinal) => void
  cachedContent?: { contentData?: Uint8Array; contentText?: string }
}

const OrdinalGridItem = memo(function OrdinalGridItem({ ordinal, onSelect, cachedContent }: OrdinalItemProps) {
  return (
    <div
      className="ordinal-card"
      onClick={() => onSelect(ordinal)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(ordinal)}
      aria-label={`Ordinal ${ordinal.origin.slice(0, 8)}`}
    >
      <OrdinalImage
        origin={ordinal.origin}
        contentType={ordinal.contentType}
        size="lg"
        alt={`Ordinal ${ordinal.origin.slice(0, 8)}`}
        cachedContent={cachedContent}
      />
    </div>
  )
})

const OrdinalListItem = memo(function OrdinalListItem({ ordinal, onSelect, cachedContent }: OrdinalItemProps) {
  return (
    <div
      className="ordinal-list-item"
      onClick={() => onSelect(ordinal)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(ordinal)}
      aria-label={`Ordinal ${ordinal.origin}`}
    >
      <OrdinalImage
        origin={ordinal.origin}
        contentType={ordinal.contentType}
        size="sm"
        alt={`Ordinal ${ordinal.origin.slice(0, 8)}`}
        cachedContent={cachedContent}
      />
      <div className="ordinal-list-info">
        <div className="ordinal-list-id">{ordinal.origin}</div>
        <div className="ordinal-list-meta">
          {ordinal.contentType && (
            <span className="ordinal-content-type">{ordinal.contentType}</span>
          )}
        </div>
      </div>
      <div className="ordinal-list-arrow" aria-hidden="true"><ChevronRight size={14} strokeWidth={1.75} /></div>
    </div>
  )
})
