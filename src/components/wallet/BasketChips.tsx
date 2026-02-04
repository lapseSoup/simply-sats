import { useWallet } from '../../contexts/WalletContext'

export function BasketChips() {
  const { balance, basketBalances, ordinals } = useWallet()

  return (
    <div className="baskets-row" role="list" aria-label="Wallet baskets">
      <div className="basket-chip" role="listitem" title="Default balance">
        <span className="basket-chip-icon" aria-hidden="true">💰</span>
        <span className="basket-chip-value">{(basketBalances.default || balance).toLocaleString()}</span>
        <span className="sr-only">sats in default basket</span>
      </div>
      <div className="basket-chip" role="listitem" title="Ordinals count">
        <span className="basket-chip-icon" aria-hidden="true">🔮</span>
        <span className="basket-chip-value">{ordinals.length}</span>
        <span className="sr-only">ordinals</span>
      </div>
      <div className="basket-chip" role="listitem" title="Identity balance">
        <span className="basket-chip-icon" aria-hidden="true">🔑</span>
        <span className="basket-chip-value">{basketBalances.identity.toLocaleString()}</span>
        <span className="sr-only">sats in identity basket</span>
      </div>
      <div className="basket-chip" role="listitem" title="Locked balance">
        <span className="basket-chip-icon" aria-hidden="true">🔒</span>
        <span className="basket-chip-value">{basketBalances.locks.toLocaleString()}</span>
        <span className="sr-only">sats locked</span>
      </div>
      {basketBalances.derived > 0 && (
        <div className="basket-chip" role="listitem" title="Derived addresses balance">
          <span className="basket-chip-icon" aria-hidden="true">🔗</span>
          <span className="basket-chip-value">{basketBalances.derived.toLocaleString()}</span>
          <span className="sr-only">sats in derived addresses</span>
        </div>
      )}
    </div>
  )
}
