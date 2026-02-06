import { useState } from 'react'
import { AlertTriangle, CircleCheck, XCircle } from 'lucide-react'
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Test Recovery Phrase</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {status === 'idle' || status === 'verifying' ? (
            <>
              <div style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
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
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <CircleCheck size={32} strokeWidth={1.5} color="#22c55e" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--success)', marginBottom: 8 }}>
                Recovery Verified!
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                Your recovery phrase correctly generates your wallet address.
                Your backup is valid.
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 20,
                fontSize: 11,
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}>
                {derivedAddress}
              </div>
              <button
                className="btn btn-secondary"
                onClick={onClose}
                style={{ width: '100%' }}
              >
                Close
              </button>
            </div>
          ) : (
            <div className="verification-result" style={{ textAlign: 'center' }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <XCircle size={32} strokeWidth={1.5} color="#ef4444" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--error)', marginBottom: 8 }}>
                Recovery Failed
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                The recovery phrase you entered does not match your wallet.
                Please check your backup and try again.
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                  Expected address:
                </div>
                <div style={{
                  background: 'var(--bg-secondary)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all'
                }}>
                  {expectedAddress}
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                  Derived address:
                </div>
                <div style={{
                  background: 'var(--bg-secondary)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all'
                }}>
                  {derivedAddress}
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleReset}
                style={{ width: '100%' }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
