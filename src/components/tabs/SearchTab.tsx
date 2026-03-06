import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Search, X, ArrowDownLeft, ArrowUpRight, Circle } from 'lucide-react'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import type { TxHistoryItem } from '../../domain/types'
import { useTransactionSearch } from '../../hooks/useTransactionSearch'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'
import { EmptyState, NoSearchResultsEmpty } from '../shared/EmptyState'
import { TransactionItemRow } from '../shared/TransactionItemRow'

export const SearchTab = memo(function SearchTab() {
  const { activeAccountId } = useWalletState()
  const { formatUSD, displayInSats, formatBSVShort } = useUI()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TxHistoryItem[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedTx, setSelectedTx] = useState<TxHistoryItem | null>(null)
  const [allLabels, setAllLabels] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const { loadLabels, searchTransactions } = useTransactionSearch(activeAccountId)

  // Load all labels on mount
  useEffect(() => {
    let cancelled = false

    void loadLabels()
      .then((labels) => {
        if (!cancelled) {
          setAllLabels(labels)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllLabels([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [loadLabels])

  // Filter suggestions: match query text, exclude already-selected labels
  const filteredLabels = query.trim()
    ? allLabels.filter(l =>
        l.toLowerCase().includes(query.trim().toLowerCase()) &&
        !selectedLabels.includes(l)
      )
    : []

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filteredLabels.length])

  const performSearch = useCallback(async (freeText: string, labels: string[]) => {
    // Nothing to search
    if (!freeText.trim() && labels.length === 0) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    try {
      const txs = await searchTransactions(freeText, labels)
      setResults(txs)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [searchTransactions])

  // Debounced search — triggers on query or selectedLabels change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim() && selectedLabels.length === 0) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query, selectedLabels)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, selectedLabels, performSearch])

  const selectLabel = (label: string) => {
    setSelectedLabels(prev => [...prev, label])
    setQuery('')
    setShowSuggestions(false)
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }

  const removeLabel = (label: string) => {
    setSelectedLabels(prev => prev.filter(l => l !== label))
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredLabels.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev =>
        prev < filteredLabels.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev =>
        prev > 0 ? prev - 1 : filteredLabels.length - 1
      )
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      selectLabel(filteredLabels[highlightedIndex]!)
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !suggestionsRef.current) return
    const items = suggestionsRef.current.querySelectorAll('.search-suggestion-item')
    items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const getTxIcon = (amount?: number) => {
    if (amount != null && amount > 0) return <ArrowDownLeft size={14} strokeWidth={1.75} />
    if (amount != null && amount < 0) return <ArrowUpRight size={14} strokeWidth={1.75} />
    return <Circle size={14} strokeWidth={1.75} />
  }

  const getTxType = (amount?: number) => {
    if (amount != null && amount > 0) return 'Received'
    if (amount != null && amount < 0) return 'Sent'
    return 'Transaction'
  }

  return (
    <>
      <div className="search-tab">
        <div className="search-input-container">
          {selectedLabels.length === 0 && (
            <Search size={16} strokeWidth={1.75} className="search-icon" />
          )}

          {/* Selected label chips */}
          {selectedLabels.length > 0 && (
            <div className="search-label-chips">
              {selectedLabels.map(label => (
                <span key={label} className="search-label-chip">
                  {label}
                  <button
                    onClick={() => removeLabel(label)}
                    className="search-label-chip-remove"
                    aria-label={`Remove ${label} filter`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder={selectedLabels.length > 0 ? 'Add another label or search...' : 'Search by label, TXID, or address...'}
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setShowSuggestions(false), 200)
            }}
            onKeyDown={handleKeyDown}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Search transactions by label, TXID, or address"
            role="combobox"
            aria-expanded={showSuggestions && filteredLabels.length > 0}
            aria-autocomplete="list"
            aria-controls="search-suggestions-listbox"
            aria-activedescendant={highlightedIndex >= 0 ? `search-suggestion-${highlightedIndex}` : undefined}
          />
          {showSuggestions && filteredLabels.length > 0 && (
            <div
              id="search-suggestions-listbox"
              className="search-suggestions"
              ref={suggestionsRef}
              role="listbox"
            >
              {filteredLabels.map((label, index) => (
                <button
                  key={label}
                  id={`search-suggestion-${index}`}
                  className={`search-suggestion-item${index === highlightedIndex ? ' highlighted' : ''}`}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onMouseDown={e => {
                    e.preventDefault()
                    selectLabel(label)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {searching && (
          <div className="search-status">Searching...</div>
        )}

        {!searching && (query.trim() || selectedLabels.length > 0) && results.length === 0 && (
          <NoSearchResultsEmpty />
        )}

        {!query.trim() && selectedLabels.length === 0 && (
          <EmptyState
            icon={<Search size={32} strokeWidth={1.5} />}
            title="Search Transactions"
            description="Search by label, TXID, or description"
            size="small"
          />
        )}

        {results.length > 0 && (
          <div className="tx-list" role="list" aria-label="Search results">
            {results.map(tx => (
              <TransactionItemRow
                key={tx.tx_hash}
                tx={tx}
                txType={getTxType(tx.amount)}
                txIcon={getTxIcon(tx.amount)}
                onClick={() => setSelectedTx(tx)}
                formatUSD={formatUSD}
                displayInSats={displayInSats}
                formatBSVShort={formatBSVShort}
                currentHeight={0}
              />
            ))}
          </div>
        )}
      </div>

      {selectedTx && (
        <TransactionDetailModal
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </>
  )
})
