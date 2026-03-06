import { useState, useCallback } from 'react'
import { Modal } from '../shared/Modal'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { isTauri, tauriInvoke } from '../../utils/tauri'
import { walletLogger } from '../../services/logger'
import { hasPrivateKeyMaterial } from '../../domain/types'

interface SignMessageModalProps {
  onClose: () => void
}

export function SignMessageModal({ onClose }: SignMessageModalProps) {
  const { wallet } = useWalletState()
  const { showToast } = useUI()
  const [message, setMessage] = useState('')
  const [signature, setSignature] = useState('')
  const [verifyMessage, setVerifyMessage] = useState('')
  const [verifySignature, setVerifySignature] = useState('')
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'sign' | 'verify'>('sign')

  const handleSign = useCallback(async () => {
    if (!wallet) return
    try {
      const sig = isTauri()
        ? await tauriInvoke<string>('sign_message_from_store', {
          message,
          keyType: 'wallet',
        })
        : await (async () => {
          if (!hasPrivateKeyMaterial(wallet)) {
            throw new Error('Private key is unavailable in this session')
          }
          return tauriInvoke<string>('sign_message', {
            wif: wallet.walletWif,
            message,
          })
        })()
      setSignature(sig)
      showToast('Message signed')
    } catch (err) {
      showToast('Signing failed: ' + (err instanceof Error ? err.message : 'unknown error'), 'error')
    }
  }, [wallet, message, showToast])

  const handleVerify = useCallback(async () => {
    if (!wallet) return
    try {
      const valid = await tauriInvoke<boolean>('verify_signature', {
        publicKeyHex: wallet.walletPubKey,
        message: verifyMessage,
        signatureHex: verifySignature,
      })
      setVerifyResult(valid)
    } catch (err) {
      // Q-71: Log the actual error — don't silently swallow Tauri communication failures
      walletLogger.warn('Signature verification failed', { error: String(err) })
      setVerifyResult(false)
    }
  }, [wallet, verifyMessage, verifySignature])

  const handleCopySignature = useCallback(() => {
    navigator.clipboard.writeText(signature).catch(clipErr => walletLogger.warn('Clipboard write failed', { error: String(clipErr) }))
    showToast('Copied')
  }, [signature, showToast])

  if (!wallet) return null

  return (
    <Modal onClose={onClose} title="Sign / Verify Message">
      <div className="modal-content compact">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn ${tab === 'sign' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('sign')}>Sign</button>
          <button className={`btn ${tab === 'verify' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('verify')}>Verify</button>
        </div>

        {tab === 'sign' && (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="sign-message">Message</label>
              <textarea
                id="sign-message"
                className="form-input"
                rows={3}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Enter message to sign"
              />
            </div>
            <button className="btn btn-primary" onClick={handleSign} disabled={!message}>
              Sign
            </button>
            {signature && (
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Signature (DER hex)</label>
                <textarea className="form-input mono" rows={3} readOnly value={signature} />
                <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={handleCopySignature}>
                  Copy
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'verify' && (
          <>
            <p className="form-hint" style={{ marginBottom: 8 }}>
              Verifies the signature against this wallet's public key.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="verify-message">Message</label>
              <textarea
                id="verify-message"
                className="form-input"
                rows={3}
                value={verifyMessage}
                onChange={e => setVerifyMessage(e.target.value)}
                placeholder="Enter original message"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="verify-sig">Signature (DER hex)</label>
              <textarea
                id="verify-sig"
                className="form-input mono"
                rows={3}
                value={verifySignature}
                onChange={e => setVerifySignature(e.target.value)}
                placeholder="Paste DER hex signature"
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleVerify}
              disabled={!verifyMessage || !verifySignature}
            >
              Verify
            </button>
            {verifyResult !== null && (
              <div className="warning compact" style={{ marginTop: 12 }}>
                {verifyResult ? 'Valid signature' : 'Invalid signature'}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
