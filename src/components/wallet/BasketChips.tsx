import { useWallet } from '../../contexts/WalletContext'

// Inline SVG icons for basket chips
const iconProps = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const WalletIcon = () => <svg {...iconProps}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M16 10h.01"/></svg>
const ImageIcon = () => <svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
const KeyIcon = () => <svg {...iconProps}><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>
const LockIcon = () => <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
const LinkIcon = () => <svg {...iconProps}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>

export function BasketChips() {
  const { balance, basketBalances, ordinals } = useWallet()

  return (
    <div className="baskets-row" role="list" aria-label="Wallet baskets">
      <div className="basket-chip" role="listitem" title="Default balance">
        <span className="basket-chip-icon" aria-hidden="true"><WalletIcon /></span>
        <span className="basket-chip-value">{(basketBalances.default || balance).toLocaleString()}</span>
        <span className="sr-only">sats in default basket</span>
      </div>
      <div className="basket-chip" role="listitem" title="Ordinals count">
        <span className="basket-chip-icon" aria-hidden="true"><ImageIcon /></span>
        <span className="basket-chip-value">{ordinals.length}</span>
        <span className="sr-only">ordinals</span>
      </div>
      <div className="basket-chip" role="listitem" title="Identity balance">
        <span className="basket-chip-icon" aria-hidden="true"><KeyIcon /></span>
        <span className="basket-chip-value">{basketBalances.identity.toLocaleString()}</span>
        <span className="sr-only">sats in identity basket</span>
      </div>
      <div className="basket-chip" role="listitem" title="Locked balance">
        <span className="basket-chip-icon" aria-hidden="true"><LockIcon /></span>
        <span className="basket-chip-value">{basketBalances.locks.toLocaleString()}</span>
        <span className="sr-only">sats locked</span>
      </div>
      {basketBalances.derived > 0 && (
        <div className="basket-chip" role="listitem" title="Derived addresses balance">
          <span className="basket-chip-icon" aria-hidden="true"><LinkIcon /></span>
          <span className="basket-chip-value">{basketBalances.derived.toLocaleString()}</span>
          <span className="sr-only">sats in derived addresses</span>
        </div>
      )}
    </div>
  )
}
