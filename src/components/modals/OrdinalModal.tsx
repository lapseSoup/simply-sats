import type { Ordinal } from '../../services/wallet'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
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

  const openFullSize = async () => {
    const label = `ordinal-${ordinal.origin.slice(0, 12).replace(/[^a-zA-Z0-9-_]/g, '_')}`
    const imageUrl = `https://ordinals.gorillapool.io/content/${ordinal.origin}`
    const viewerUrl = `${window.location.origin}/ordinal-viewer.html?src=${encodeURIComponent(imageUrl)}`

    // Cap window size at 90% of screen
    let width = 800
    let height = 800
    try {
      const monitor = await currentMonitor()
      if (monitor) {
        const maxW = Math.floor(monitor.size.width / monitor.scaleFactor * 0.9)
        const maxH = Math.floor(monitor.size.height / monitor.scaleFactor * 0.9)
        width = Math.min(width, maxW)
        height = Math.min(height, maxH)
      }
    } catch {
      // Fall back to default size
    }

    new WebviewWindow(label, {
      url: viewerUrl,
      title: `Ordinal ${ordinal.origin.slice(0, 8)}...`,
      width,
      height,
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
            <button className="btn btn-secondary" onClick={openFullSize}>
              Full Size
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => copyToClipboard(ordinal.origin, 'Origin copied!')}
          >
            Copy Origin
          </button>
          {onList && (
            <button className="btn btn-secondary" onClick={onList}>
              List for Sale
            </button>
          )}
          {onTransfer && (
            <button className="btn btn-primary" onClick={onTransfer}>
              Transfer
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
