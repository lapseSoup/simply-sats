import type { Ordinal } from '../../services/wallet'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'

interface OrdinalModalProps {
  ordinal: Ordinal
  onClose: () => void
  onTransfer?: () => void
}

export function OrdinalModal({ ordinal, onClose, onTransfer }: OrdinalModalProps) {
  const { copyToClipboard } = useUI()

  const openOnWoC = (txid: string) => {
    openUrl(`https://whatsonchain.com/tx/${txid}`)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Ordinal</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="ordinal-detail">
            <div className="ordinal-preview" aria-hidden="true">🔮</div>
            <div className="ordinal-info-list">
              <div className="ordinal-info-row">
                <span className="ordinal-info-label">Origin</span>
                <span className="ordinal-info-value">{ordinal.origin.slice(0, 16)}...</span>
              </div>
              <div className="ordinal-info-row">
                <span className="ordinal-info-label">Outpoint</span>
                <span className="ordinal-info-value">{`${ordinal.txid}:${ordinal.vout}`.slice(0, 16)}...</span>
              </div>
              <div className="ordinal-info-row">
                <span className="ordinal-info-label">TXID</span>
                <button className="link-btn" onClick={() => openOnWoC(ordinal.txid)}>
                  View on WhatsOnChain
                </button>
              </div>
            </div>
            <div className="ordinal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => copyToClipboard(ordinal.origin, 'Origin copied!')}
              >
                Copy Origin
              </button>
              {onTransfer && (
                <button
                  className="btn btn-primary"
                  onClick={onTransfer}
                >
                  Transfer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
