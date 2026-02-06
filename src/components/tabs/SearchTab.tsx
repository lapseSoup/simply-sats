import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, ArrowDownLeft, ArrowUpRight, Circle } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { searchTransactions } from '../../services/database'
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    try {
      const txs = await searchTransactions(searchQuery.trim(), activeAccountId || undefined)
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

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, performSearch])

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
          <input
            type="text"
            className="search-input"
            placeholder="Search by label, TXID, or address..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {searching && (
          <div className="search-status">Searching...</div>
        )}

        {!searching && query.trim() && results.length === 0 && (
          <div className="search-empty">No transactions found</div>
        )}

        {!query.trim() && (
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
