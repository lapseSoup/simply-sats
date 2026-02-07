import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, ArrowDownLeft, ArrowUpRight, Circle } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { searchTransactions, searchTransactionsByLabels, getAllLabels } from '../../services/database'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'

type SearchResult = {
  tx_hash: string
  amount?: number
  height: number
  description?: string
}

export function SearchTab() {
  const { activeAccountId } = useWallet()
  const { formatUSD } = useUI()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedTx, setSelectedTx] = useState<SearchResult | null>(null)
  const [allLabels, setAllLabels] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Load all labels on mount
  useEffect(() => {
    getAllLabels(activeAccountId || undefined)
      .then(setAllLabels)
      .catch(() => setAllLabels([]))
  }, [activeAccountId])

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
      let txs
      if (labels.length > 0) {
        // Multi-label AND search with optional freeText
        txs = await searchTransactionsByLabels(
          labels,
          freeText.trim() || undefined,
          activeAccountId || undefined
        )
      } else {
        // Simple text search
        txs = await searchTransactions(freeText.trim(), activeAccountId || undefined)
      }
      setResults(txs.map(tx => ({
        tx_hash: tx.txid,
        amount: tx.amount,
        height: tx.blockHeight || 0,
        description: tx.description
      })))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [activeAccountId])

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
      selectLabel(filteredLabels[highlightedIndex])
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !suggestionsRef.current) return
    const items = suggestionsRef.current.querySelectorAll('.search-suggestion-item')
    items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const getTxIcon = (amount?: number) => {
    if (amount && amount > 0) return <ArrowDownLeft size={14} strokeWidth={1.75} />
    if (amount && amount < 0) return <ArrowUpRight size={14} strokeWidth={1.75} />
    return <Circle size={14} strokeWidth={1.75} />
  }

  const getTxType = (amount?: number) => {
    if (amount && amount > 0) return 'Received'
    if (amount && amount < 0) return 'Sent'
    return 'Transaction'
  }

  return (
    <>
      <div className="search-tab">
        <div className="search-input-container">
          <Search size={16} strokeWidth={1.75} className="search-icon" />

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
          />
          {showSuggestions && filteredLabels.length > 0 && (
            <div className="search-suggestions" ref={suggestionsRef}>
              {filteredLabels.map((label, index) => (
                <button
                  key={label}
                  className={`search-suggestion-item${index === highlightedIndex ? ' highlighted' : ''}`}
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
          <div className="search-empty">No transactions found</div>
        )}

        {!query.trim() && selectedLabels.length === 0 && (
          <div className="search-empty">
            Search transactions by label, TXID, or description
          </div>
        )}

        {results.length > 0 && (
          <div className="tx-list" role="list" aria-label="Search results">
            {results.map(tx => (
              <div
                key={tx.tx_hash}
                className="tx-item"
                onClick={() => setSelectedTx(tx)}
                role="listitem"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelectedTx(tx)}
                style={{ cursor: 'pointer' }}
              >
                <div className="tx-icon" aria-hidden="true">{getTxIcon(tx.amount)}</div>
                <div className="tx-info">
                  <div className="tx-type">{getTxType(tx.amount)}</div>
                  <div className="tx-meta">
                    <span className="tx-hash">{tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-6)}</span>
                    {tx.height > 0 && <span>• Block {tx.height.toLocaleString()}</span>}
                  </div>
                </div>
                <div className="tx-amount">
                  {tx.amount ? (
                    <>
                      <div className={`tx-amount-value ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                        {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} sats
                      </div>
                      <div className="tx-amount-usd" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        ${formatUSD(Math.abs(tx.amount))}
                      </div>
                    </>
                  ) : (
                    <div className="tx-amount-value">View &rarr;</div>
                  )}
                </div>
              </div>
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
}
