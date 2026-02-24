import { useState } from 'react'
import { AlertTriangle, CircleCheck, XCircle } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { MnemonicInput } from '../forms/MnemonicInput'
import { verifyMnemonicMatchesWallet } from '../../services/wallet'
import { uiLogger } from '../../services/logger'

interface TestRecoveryModalProps {
  expectedAddress: string
  onClose: () => void
}

type VerificationStatus = 'idle' | 'verifying' | 'success' | 'failure'

export function TestRecoveryModal({ expectedAddress, onClose }: TestRecoveryModalProps) {
  const [mnemonic, setMnemonic] = useState('')
  const [status, setStatus] = useState<VerificationStatus>('idle')
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleVerify = async () => {
    if (!mnemonic.trim()) {
      setError('Please enter your recovery phrase')
      return
    }

    const words = mnemonic.trim().split(/\s+/)
    if (words.length !== 12 && words.length !== 24) {
      setError('Please enter 12 or 24 words')
      return
    }

    setStatus('verifying')
    setError(null)

    try {
      const result = await verifyMnemonicMatchesWallet(mnemonic.trim(), expectedAddress)
      setDerivedAddress(result.derivedAddress)
      setStatus(result.valid ? 'success' : 'failure')
    } catch (err) {
      uiLogger.error('Recovery verification failed', err)
      setError(err instanceof Error ? err.message : 'Verification failed')
      setStatus('idle')
    }
  }

  const handleReset = () => {
    setMnemonic('')
    setStatus('idle')
    setDerivedAddress(null)
    setError(null)
  }

  return (
    <Modal onClose={onClose} title="Test Recovery Phrase">
      <div className="modal-content">
        {status === 'idle' || status === 'verifying' ? (
          <>
            <div className="result-message" style={{ marginBottom: 16, lineHeight: 1.5 }}>
              Verify that your backup recovery phrase matches your wallet.
              This check is read-only and will not modify your wallet.
            </div>

            <div className="form-group">
              <label className="form-label">Enter your 12-word recovery phrase</label>
              <MnemonicInput
                value={mnemonic}
                onChange={setMnemonic}
              />
            </div>

            {error && (
              <div className="warning compact" role="alert" style={{ marginTop: 12 }}>
                <span className="warning-icon"><AlertTriangle size={16} strokeWidth={1.75} /></span>
                <span className="warning-text">{error}</span>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleVerify}
              disabled={status === 'verifying' || !mnemonic.trim()}
              style={{ marginTop: 16, width: '100%' }}
            >
              {status === 'verifying' ? 'Verifying...' : 'Verify Recovery Phrase'}
            </button>
          </>
        ) : status === 'success' ? (
          <div className="verification-result" style={{ textAlign: 'center' }}>
            <div className="result-icon-circle success">
              <CircleCheck size={32} strokeWidth={1.5} color="var(--success)" />
            </div>
            <div className="result-title success">Recovery Verified!</div>
            <div className="result-message">
              Your recovery phrase correctly generates your wallet address.
              Your backup is valid.
            </div>
            <div className="result-address-block">{derivedAddress}</div>
            <button className="btn btn-secondary" onClick={onClose} style={{ width: '100%' }}>
              Close
            </button>
          </div>
        ) : (
          <div className="verification-result" style={{ textAlign: 'center' }}>
            <div className="result-icon-circle error">
              <XCircle size={32} strokeWidth={1.5} color="var(--error)" />
            </div>
            <div className="result-title error">Recovery Failed</div>
            <div className="result-message">
              The recovery phrase you entered does not match your wallet.
              Please check your backup and try again.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                Expected address:
              </div>
              <div className="result-address-block" style={{ marginBottom: 0 }}>
                {expectedAddress}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                Derived address:
              </div>
              <div className="result-address-block" style={{ marginBottom: 0 }}>
                {derivedAddress}
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleReset} style={{ width: '100%' }}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
