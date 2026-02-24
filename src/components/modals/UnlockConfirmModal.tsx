import { AlertTriangle, Unlock } from 'lucide-react'
import { Modal } from '../shared/Modal'
import type { LockedUTXO } from '../../services/wallet'
import { feeFromBytes } from '../../services/wallet'

interface UnlockConfirmModalProps {
  locks: LockedUTXO[]
  onConfirm: () => void
  onCancel: () => void
  unlocking: boolean
}

export function UnlockConfirmModal({ locks, onConfirm, onCancel, unlocking }: UnlockConfirmModalProps) {
  // Calculate unlock fee - same as wallet.ts getUnlockFee() logic
  // P2PKH unlock tx: 10 bytes overhead + 148 bytes per input + 34 bytes output
  const getUnlockFee = () => {
    const txSize = 10 + 148 + 34 // Single input, single output
    return feeFromBytes(txSize)
  }

  const totalSats = locks.reduce((sum, l) => sum + l.satoshis, 0)
  const totalFee = locks.length * getUnlockFee()
  const totalReceive = totalSats - totalFee
  const cantUnlock = totalReceive <= 0

  return (
    <Modal onClose={onCancel} title="Confirm Unlock">
      <div className="modal-content compact">
        {cantUnlock && (
          <div className="warning compact" style={{ marginBottom: 12 }} role="alert">
            <span className="warning-icon" aria-hidden="true"><AlertTriangle size={16} strokeWidth={1.75} /></span>
            <span className="warning-text">
              Locked amount is less than the unlock fee. Cannot unlock.
            </span>
          </div>
        )}
        <div className="send-summary compact">
          <div className="send-summary-row">
            <span>Locks to Unlock</span>
            <span>{locks.length}</span>
          </div>
          <div className="send-summary-row">
            <span>Total Locked</span>
            <span>{totalSats.toLocaleString()} sats</span>
          </div>
          <div className="send-summary-row">
            <span>Transaction Fee{locks.length > 1 ? 's' : ''}</span>
            <span>-{totalFee.toLocaleString()} sats</span>
          </div>
          <div className="send-summary-row total">
            <span>You'll Receive</span>
            <span style={{ color: cantUnlock ? 'var(--error)' : 'var(--success)' }}>
              {cantUnlock ? 'Insufficient' : `+${totalReceive.toLocaleString()} sats`}
            </span>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="unlock-btn"
            style={{ flex: 1, padding: '12px 24px', opacity: cantUnlock ? 0.5 : 1 }}
            onClick={onConfirm}
            disabled={unlocking || cantUnlock}
          >
            {unlocking ? 'Unlocking...' : cantUnlock ? 'Cannot Unlock' : <><Unlock size={16} strokeWidth={1.75} /> Unlock {totalReceive.toLocaleString()} sats</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
