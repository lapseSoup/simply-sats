import { useCallback } from 'react'
import type { Ordinal } from '../../services/wallet'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import { Copy, Maximize2 } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { OrdinalImage } from '../shared/OrdinalImage'

interface OrdinalModalProps {
  ordinal: Ordinal
  onClose: () => void
  onTransfer?: () => void
  onList?: () => void
  // TODO: Enable onBuy once listPrice is supported on the Ordinal type.
  // purchaseOrdinal() is implemented in src/services/wallet/marketplace.ts and
  // ready to wire up once GorillaPool returns payout + listPrice in the API.
  onBuy?: () => void
}

export function OrdinalModal({ ordinal, onClose, onTransfer, onList, onBuy }: OrdinalModalProps) {
  const { copyToClipboard } = useUI()

  const openOnWoC = (txid: string) => {
    openUrl(`https://whatsonchain.com/tx/${txid}`)
  }

  const isImage = ordinal.contentType?.startsWith('image/')

  const openFullSize = useCallback(async () => {
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
  }, [ordinal.origin])

  const handleCopyValue = useCallback((value: string, label: string) => {
    copyToClipboard(value, `${label} copied!`)
  }, [copyToClipboard])

  return (
    <Modal onClose={onClose} title="Ordinal">
      <div className="ordinal-detail">
        <div
          className={`ordinal-preview${isImage ? ' ordinal-preview-clickable' : ''}`}
          onClick={isImage ? openFullSize : undefined}
          role={isImage ? 'button' : undefined}
          tabIndex={isImage ? 0 : undefined}
          onKeyDown={isImage ? (e) => { if (e.key === 'Enter') openFullSize() } : undefined}
          aria-label={isImage ? 'Open full size viewer' : undefined}
        >
          <OrdinalImage
            origin={ordinal.origin}
            contentType={ordinal.contentType}
            size="lg"
            alt={`Ordinal ${ordinal.origin.slice(0, 8)}`}
            lazy={false}
          />
          {isImage && (
            <div className="ordinal-preview-overlay" aria-hidden="true">
              <Maximize2 size={16} strokeWidth={2} />
            </div>
          )}
        </div>
        <div className="ordinal-info-list">
          <div
            className="ordinal-info-row"
            role="button"
            tabIndex={0}
            onClick={() => handleCopyValue(ordinal.origin, 'Origin')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCopyValue(ordinal.origin, 'Origin') }}
            aria-label="Copy origin"
          >
            <span className="ordinal-info-label">Origin</span>
            <span className="ordinal-info-value ordinal-info-value-copyable">
              {ordinal.origin.slice(0, 16)}...
              <Copy size={12} strokeWidth={1.75} />
            </span>
          </div>
          <div
            className="ordinal-info-row"
            role="button"
            tabIndex={0}
            onClick={() => handleCopyValue(`${ordinal.txid}:${ordinal.vout}`, 'Outpoint')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCopyValue(`${ordinal.txid}:${ordinal.vout}`, 'Outpoint') }}
            aria-label="Copy outpoint"
          >
            <span className="ordinal-info-label">Outpoint</span>
            <span className="ordinal-info-value ordinal-info-value-copyable">
              {`${ordinal.txid}:${ordinal.vout}`.slice(0, 16)}...
              <Copy size={12} strokeWidth={1.75} />
            </span>
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
        {(onList || onTransfer || onBuy) && (
          <div className="ordinal-actions">
            {onBuy && (
              // TODO: Show only when ordinal.listPrice > 0 once listPrice is
              // available on the Ordinal type (requires GorillaPool API support).
              <button className="btn btn-primary" onClick={onBuy}>
                Buy
              </button>
            )}
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
        )}
      </div>
    </Modal>
  )
}
