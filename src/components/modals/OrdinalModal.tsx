import type { Ordinal } from '../../services/wallet'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Modal } from '../shared/Modal'
import { OrdinalImage } from '../shared/OrdinalImage'

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
    <Modal onClose={onClose} title="Ordinal">
      <div className="ordinal-detail">
        <div className="ordinal-preview">
          <OrdinalImage
            origin={ordinal.origin}
            contentType={ordinal.contentType}
            size="lg"
            alt={`Ordinal ${ordinal.origin.slice(0, 8)}`}
            lazy={false}
          />
        </div>
        <div className="ordinal-info-list">
          <div className="ordinal-info-row">
            <span className="ordinal-info-label">Origin</span>
            <span className="ordinal-info-value">{ordinal.origin.slice(0, 16)}...</span>
          </div>
          <div className="ordinal-info-row">
            <span className="ordinal-info-label">Outpoint</span>
            <span className="ordinal-info-value">{`${ordinal.txid}:${ordinal.vout}`.slice(0, 16)}...</span>
          </div>
          {ordinal.contentType && (
            <div className="ordinal-info-row">
              <span className="ordinal-info-label">Type</span>
              <span className="ordinal-info-value">{ordinal.contentType}</span>
            </div>
          )}
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
    </Modal>
  )
}
