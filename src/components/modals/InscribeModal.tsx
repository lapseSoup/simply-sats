/**
 * InscribeModal Component
 *
 * Modal for creating new 1Sat Ordinal inscriptions by uploading a file.
 */

import { useState, useRef, useCallback } from 'react'
import { CircleCheck, Upload } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { buildInscriptionTx } from '../../services/wallet/inscribe'

const MAX_FILE_BYTES = 100 * 1024 // 100 KB

const ACCEPTED_TYPES = [
  'image/*',
  'text/*',
  'application/json',
].join(',')

interface InscribeModalProps {
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function InscribeModal({ onClose }: InscribeModalProps) {
  const { wallet, utxos } = useWalletState()
  const { showToast } = useUI()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [txid, setTxid] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setError('')

    if (!file) {
      setSelectedFile(null)
      return
    }

    if (file.size > MAX_FILE_BYTES) {
      setError(`File is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_FILE_BYTES)}.`)
      setSelectedFile(null)
      // Reset the input so the user can try again
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFile(file)
  }, [])

  const handleInscribe = useCallback(async () => {
    if (!selectedFile || !wallet) return

    setLoading(true)
    setError('')

    try {
      const buffer = await selectedFile.arrayBuffer()
      const content = new Uint8Array(buffer)

      // Filter to payment UTXOs (wallet address, not ordinal address)
      const paymentUtxos = utxos.filter(u => u.address === wallet.walletAddress)

      if (paymentUtxos.length === 0) {
        throw new Error('No payment UTXOs available. Your wallet needs a balance to pay inscription fees.')
      }

      const inscribedTxid = await buildInscriptionTx({
        paymentWif: wallet.walletWif,
        paymentUtxos,
        content,
        contentType: selectedFile.type || 'application/octet-stream',
        destinationAddress: wallet.ordAddress,
      })

      setTxid(inscribedTxid)
      showToast('Ordinal inscribed successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription failed')
    } finally {
      setLoading(false)
    }
  }, [selectedFile, wallet, utxos, showToast])

  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setError('')
    setTxid(null)
    setLoading(false)
    onClose()
  }, [onClose])

  if (txid) {
    return (
      <Modal onClose={handleClose} title="Inscription Complete">
        <div className="transfer-success">
          <div className="success-icon">
            <CircleCheck size={64} strokeWidth={1.5} color="var(--success)" />
          </div>
          <h3>Ordinal Inscribed!</h3>
          <p className="success-message">
            Your inscription has been broadcast to the network.
          </p>
          <div className="txid-display">
            <span className="txid-label">Transaction ID:</span>
            <a
              href={`https://whatsonchain.com/tx/${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="txid-link"
            >
              {txid.slice(0, 16)}...{txid.slice(-8)}
            </a>
          </div>
          <button type="button" className="btn btn-primary" onClick={handleClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={handleClose} title="Inscribe Ordinal">
      <div className="transfer-content">
        {/* File Picker */}
        <div className="form-group">
          <label htmlFor="inscribe-file">Select File to Inscribe</label>
          <input
            id="inscribe-file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="form-input"
            onChange={handleFileChange}
            disabled={loading}
          />
          <p className="form-hint">
            Accepted: images, text, JSON &mdash; max {formatBytes(MAX_FILE_BYTES)}
          </p>
        </div>

        {/* File Preview */}
        {selectedFile && (
          <div className="fee-info">
            <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className="fee-label">{selectedFile.name}</span>
            <span className="fee-value">
              {selectedFile.type || 'unknown type'} &mdash; {formatBytes(selectedFile.size)}
            </span>
          </div>
        )}

        {error && <p className="error-message">{error}</p>}

        {/* Actions */}
        <div className="button-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleInscribe}
            disabled={loading || !selectedFile || !wallet}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="spinner-small" aria-hidden="true" />
                Inscribing...
              </>
            ) : 'Inscribe'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
