/**
 * Fee Estimation Component
 *
 * Displays transaction fee estimation with:
 * - Visual fee rate selector (Low/Medium/High)
 * - Estimated transaction size and breakdown
 * - Fee in sats and USD
 *
 * @module components/shared/FeeEstimation
 */

import { useState, useEffect, useMemo } from 'react'
import {
  DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD
} from '../../domain/transaction/fees'
import { useUI } from '../../contexts/UIContext'

interface FeeEstimationProps {
  /** Number of inputs in the transaction */
  inputCount: number
  /** Number of outputs in the transaction */
  outputCount: number
  /** Current fee in satoshis */
  currentFee: number
  /** Callback when fee rate changes */
  onFeeRateChange?: (rate: number) => void
  /** Whether to show detailed breakdown */
  showDetails?: boolean
  /** Make the component compact */
  compact?: boolean
}

/** Predefined fee tiers */
const FEE_TIERS = [
  { label: 'Low', rate: 0.05, description: 'Economy' },
  { label: 'Standard', rate: 0.1, description: 'Normal' },
  { label: 'Fast', rate: 0.5, description: 'Priority' },
] as const

type FeeTier = typeof FEE_TIERS[number]['label']

/**
 * Calculate which tier a rate falls into
 */
function getTierFromRate(rate: number): FeeTier {
  if (rate <= 0.05) return 'Low'
  if (rate <= 0.2) return 'Standard'
  return 'Fast'
}

/**
 * Estimate confirmation time based on fee rate
 */
function estimateConfirmationTime(rate: number): string {
  if (rate >= 0.5) return '~10 seconds'
  if (rate >= 0.1) return '~10 seconds'
  if (rate >= 0.05) return '~10 seconds'
  return '~10 seconds' // BSV has fast blocks regardless
}

export function FeeEstimation({
  inputCount,
  outputCount,
  currentFee,
  onFeeRateChange,
  showDetails = false,
  compact = false
}: FeeEstimationProps) {
  const { formatUSD } = useUI()
  const [selectedTier, setSelectedTier] = useState<FeeTier>('Standard')
  const [customRate, setCustomRate] = useState(DEFAULT_FEE_RATE)
  const [showCustom, setShowCustom] = useState(false)

  // Calculate transaction size
  const txSize = useMemo(() => {
    if (inputCount === 0) return 0
    return TX_OVERHEAD + (inputCount * P2PKH_INPUT_SIZE) + (outputCount * P2PKH_OUTPUT_SIZE)
  }, [inputCount, outputCount])

  // Get current fee rate
  const currentRate = useMemo(() => {
    if (showCustom) return customRate
    return FEE_TIERS.find(t => t.label === selectedTier)?.rate || DEFAULT_FEE_RATE
  }, [selectedTier, showCustom, customRate])

  // Notify parent of rate changes
  useEffect(() => {
    onFeeRateChange?.(currentRate)
  }, [currentRate, onFeeRateChange])

  const handleTierSelect = (tier: FeeTier) => {
    setSelectedTier(tier)
    setShowCustom(false)
  }

  const handleCustomRateChange = (rate: number) => {
    const clampedRate = Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
    setCustomRate(clampedRate)
    setShowCustom(true)
    // Update the visual tier display based on rate
    setSelectedTier(getTierFromRate(clampedRate))
  }

  if (inputCount === 0) {
    return null
  }

  if (compact) {
    return (
      <div className="fee-estimation-compact">
        <div className="fee-estimation-row">
          <span className="fee-label">Network Fee</span>
          <span className="fee-value">
            {currentFee} sats
            <span className="fee-usd">(${formatUSD(currentFee)})</span>
          </span>
        </div>
        {onFeeRateChange && (
          <div className="fee-tiers-inline">
            {FEE_TIERS.map(tier => (
              <button
                key={tier.label}
                className={`fee-tier-btn ${selectedTier === tier.label && !showCustom ? 'active' : ''}`}
                onClick={() => handleTierSelect(tier.label as FeeTier)}
              >
                {tier.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fee-estimation">
      <div className="fee-estimation-header">
        <span className="fee-estimation-title">Transaction Fee</span>
        <span className="fee-estimation-time">{estimateConfirmationTime(currentRate)}</span>
      </div>

      {/* Fee tier selector */}
      {onFeeRateChange && (
        <div className="fee-tiers">
          {FEE_TIERS.map(tier => (
            <button
              key={tier.label}
              className={`fee-tier ${selectedTier === tier.label && !showCustom ? 'active' : ''}`}
              onClick={() => handleTierSelect(tier.label as FeeTier)}
            >
              <span className="fee-tier-label">{tier.label}</span>
              <span className="fee-tier-rate">{tier.rate} sat/byte</span>
              <span className="fee-tier-desc">{tier.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Fee summary */}
      <div className="fee-summary">
        <div className="fee-summary-row">
          <span>Fee</span>
          <span className="fee-amount">
            <strong>{currentFee}</strong> sats
            <span className="fee-usd">(${formatUSD(currentFee)})</span>
          </span>
        </div>

        {showDetails && (
          <>
            <div className="fee-summary-row detail">
              <span>Rate</span>
              <span>{currentRate.toFixed(2)} sat/byte</span>
            </div>
            <div className="fee-summary-row detail">
              <span>Size</span>
              <span>{txSize} bytes</span>
            </div>
            <div className="fee-summary-row detail">
              <span>Inputs</span>
              <span>{inputCount}</span>
            </div>
            <div className="fee-summary-row detail">
              <span>Outputs</span>
              <span>{outputCount}</span>
            </div>
          </>
        )}
      </div>

      {/* Custom rate input (expandable) */}
      {onFeeRateChange && (
        <div className="fee-custom">
          <button
            className="fee-custom-toggle"
            onClick={() => setShowCustom(!showCustom)}
          >
            {showCustom ? '▼' : '▶'} Custom fee rate
          </button>
          {showCustom && (
            <div className="fee-custom-input">
              <input
                type="range"
                min={MIN_FEE_RATE}
                max={MAX_FEE_RATE}
                step={0.01}
                value={customRate}
                onChange={e => handleCustomRateChange(parseFloat(e.target.value))}
                className="fee-slider"
              />
              <div className="fee-custom-labels">
                <span>Low ({MIN_FEE_RATE})</span>
                <span className="fee-custom-current">{customRate.toFixed(2)} sat/byte</span>
                <span>High ({MAX_FEE_RATE})</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
