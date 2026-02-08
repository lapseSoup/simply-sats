import type { Ordinal } from '../../services/wallet'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Modal } from '../shared/Modal'
import { OrdinalImage } from '../shared/OrdinalImage'

interface OrdinalModalProps {
  ordinal: Ordinal
  onClose: () => void
  onTransfer?: () => void
  onList?: () => void
}

export function OrdinalModal({ ordinal, onClose, onTransfer, onList }: OrdinalModalProps) {
  const { copyToClipboard } = useUI()

  const openOnWoC = (txid: string) => {
    openUrl(`https://whatsonchain.com/tx/${txid}`)
  }

  const isImage = ordinal.contentType?.startsWith('image/')

  const openFullSize = () => {
    const label = `ordinal-${ordinal.origin.slice(0, 12).replace(/[^a-zA-Z0-9-_]/g, '_')}`
    new WebviewWindow(label, {
      url: `https://ordinals.gorillapool.io/content/${ordinal.origin}`,
      title: `Ordinal ${ordinal.origin.slice(0, 8)}...`,
      width: 800,
      height: 800,
      resizable: true,
    })
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
          {isImage && (
            <button
              className="btn btn-secondary"
              onClick={openFullSize}
            >
              Open Full Size
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => copyToClipboard(ordinal.origin, 'Origin copied!')}
          >
            Copy Origin
          </button>
          {onList && (
            <button
              className="btn btn-secondary"
              onClick={onList}
            >
              List for Sale
            </button>
          )}
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
