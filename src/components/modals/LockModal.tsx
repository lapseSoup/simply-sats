import { useState } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { calculateLockFee, getTimelockScriptSize } from '../../services/wallet'

interface LockModalProps {
  onClose: () => void
}

export function LockModal({ onClose }: LockModalProps) {
  const {
    wallet,
    balance,
    networkInfo,
    handleLock
  } = useWallet()
  const { displayInSats, showToast } = useUI()

  const [lockAmount, setLockAmount] = useState('')
  const [lockBlocks, setLockBlocks] = useState('')
  const [locking, setLocking] = useState(false)
  const [lockError, setLockError] = useState('')

  if (!wallet) return null

  const lockSats = displayInSats
    ? Math.round(parseFloat(lockAmount || '0'))
    : Math.round(parseFloat(lockAmount || '0') * 100000000)
  const blocks = parseInt(lockBlocks || '0')
  const currentHeight = networkInfo?.blockHeight || 0
  const unlockBlock = currentHeight + blocks

  // Estimate unlock time (average 10 min per block)
  const estimatedMinutes = blocks * 10
  const estimatedHours = Math.floor(estimatedMinutes / 60)
  const estimatedDays = Math.floor(estimatedHours / 24)

  let timeEstimate = ''
  if (estimatedDays > 0) {
    timeEstimate = `~${estimatedDays} day${estimatedDays > 1 ? 's' : ''}`
  } else if (estimatedHours > 0) {
    timeEstimate = `~${estimatedHours} hour${estimatedHours > 1 ? 's' : ''}`
  } else if (estimatedMinutes > 0) {
    timeEstimate = `~${estimatedMinutes} min`
  }

  // Calculate exact fee using actual script size
  let fee = 0
  if (wallet && blocks > 0) {
    const scriptSize = getTimelockScriptSize(wallet.walletPubKey, unlockBlock)
    fee = calculateLockFee(1, scriptSize)
  } else {
    fee = calculateLockFee(1)
  }

  const handleSubmit = async () => {
    if (!lockAmount || !lockBlocks || lockSats <= 0 || blocks <= 0) return

    setLocking(true)
    setLockError('')

    const result = await handleLock(lockSats, blocks)

    if (result.success) {
      showToast(`Locked ${lockSats.toLocaleString()} sats for ${blocks} blocks!`)
      onClose()
    } else {
      setLockError(result.error || 'Lock failed')
    }

    setLocking(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal send-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Lock BSV</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content compact">
          <div className="form-group">
            <label className="form-label" htmlFor="lock-amount" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Amount ({displayInSats ? 'sats' : 'BSV'})</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                {displayInSats ? balance.toLocaleString() : (balance / 100000000).toFixed(8)} available
              </span>
            </label>
            <input
              id="lock-amount"
              type="number"
              className="form-input"
              placeholder=""
              step={displayInSats ? '1' : '0.00000001'}
              value={lockAmount}
              onChange={e => setLockAmount(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lock-blocks">Lock Duration (blocks)</label>
            <input
              id="lock-blocks"
              type="number"
              className="form-input"
              placeholder=""
              min="1"
              value={lockBlocks}
              onChange={e => setLockBlocks(e.target.value)}
            />
            <div className="form-hint" id="lock-hint">
              {blocks > 0 ? (
                <>Unlocks at block {unlockBlock.toLocaleString()} {timeEstimate && `(${timeEstimate})`}</>
              ) : (
                <>1 block ≈ 10 minutes</>
              )}
            </div>
          </div>

          <div className="send-summary compact">
            <div className="send-summary-row">
              <span>Current Block</span>
              <span>{currentHeight.toLocaleString()}</span>
            </div>
            {lockSats > 0 && blocks > 0 && (
              <>
                <div className="send-summary-row">
                  <span>Lock Amount</span>
                  <span>{lockSats.toLocaleString()} sats</span>
                </div>
                <div className="send-summary-row">
                  <span>Unlock Block</span>
                  <span>{unlockBlock.toLocaleString()}</span>
                </div>
                <div className="send-summary-row">
                  <span>Fee</span>
                  <span>{fee} sats</span>
                </div>
              </>
            )}
          </div>

          {lockError && (
            <div className="warning compact" role="alert">
              <span className="warning-icon">⚠️</span>
              <span className="warning-text">{lockError}</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={locking || !lockAmount || !lockBlocks || lockSats <= 0 || blocks <= 0}
          >
            {locking ? 'Locking...' : `🔒 Lock ${lockSats > 0 ? lockSats.toLocaleString() + ' sats' : 'BSV'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
