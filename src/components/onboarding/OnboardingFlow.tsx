import { useState, useMemo } from 'react'
import { Shield, Zap, Gem, Lock, ChevronLeft, ChevronRight, Wallet, KeyRound } from 'lucide-react'
import { SimplySatsLogo } from '../shared'
import { PasswordInput } from '../shared/PasswordInput'
import { useUI } from '../../contexts/UIContext'
import { SECURITY } from '../../config'
import { validatePassword, getPasswordStrengthLabel, getPasswordStrengthColor } from '../../utils/passwordValidation'

interface OnboardingFlowProps {
  onCreateWallet: (password: string) => Promise<string | null>
  onRestoreClick: () => void
  onWalletCreated?: (mnemonic: string) => void
}

type OnboardingStep = 'welcome' | 'features' | 'action' | 'password'

const features = [
  {
    icon: <Shield size={32} strokeWidth={1.75} />,
    title: 'Secure by Design',
    description: 'Your keys never leave your device. Industry-standard encryption protects your wallet.'
  },
  {
    icon: <Zap size={32} strokeWidth={1.75} />,
    title: 'BRC-100 Ready',
    description: 'Seamlessly connect with apps using the BRC-100 standard for BSV interactions.'
  },
  {
    icon: <Gem size={32} strokeWidth={1.75} />,
    title: 'Ordinals Support',
    description: 'View, manage, and transfer your 1Sat Ordinals collection with ease.'
  },
  {
    icon: <Lock size={32} strokeWidth={1.75} />,
    title: 'Time Locks',
    description: 'Lock your BSV for a specific block height. Perfect for savings and commitments.'
  }
]

export function OnboardingFlow({ onCreateWallet, onRestoreClick, onWalletCreated }: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [featureIndex, setFeatureIndex] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const { showToast } = useUI()

  // Password strength meter
  const passwordStrength = useMemo(() => {
    if (!password) return null
    const result = validatePassword(password)
    return {
      score: result.score,
      label: getPasswordStrengthLabel(result.score),
      color: getPasswordStrengthColor(result.score)
    }
  }, [password])

  const handleNext = () => {
    setIsAnimating(true)
    setTimeout(() => {
      if (step === 'welcome') {
        setStep('features')
      } else if (step === 'features') {
        if (featureIndex < features.length - 1) {
          setFeatureIndex(featureIndex + 1)
        } else {
          setStep('action')
        }
      }
      setIsAnimating(false)
    }, 200)
  }

  const handlePrev = () => {
    setIsAnimating(true)
    setTimeout(() => {
      if (step === 'password') {
        setStep('action')
        setPassword('')
        setConfirmPassword('')
        setPasswordError('')
      } else if (step === 'action') {
        setStep('features')
        setFeatureIndex(features.length - 1)
      } else if (step === 'features') {
        if (featureIndex > 0) {
          setFeatureIndex(featureIndex - 1)
        } else {
          setStep('welcome')
        }
      }
      setIsAnimating(false)
    }, 200)
  }

  const handleSkip = () => {
    setStep('action')
    setFeatureIndex(0)
  }

  const handleCreate = async () => {
    // Validate password
    if (password.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    setPasswordError('')
    setCreating(true)
    try {
      const mnemonic = await onCreateWallet(password)
      if (mnemonic) {
        onWalletCreated?.(mnemonic)
      } else {
        showToast('Failed to create wallet', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error creating wallet', 'error')
    }
    setCreating(false)
  }

  // Calculate total progress (welcome + features + action/password)
  const totalSteps = 2 + features.length
  const currentProgress = step === 'welcome' ? 0
    : step === 'features' ? 1 + featureIndex
    : totalSteps - 1 // action and password both show as final step
  const progressPercent = (currentProgress / (totalSteps - 1)) * 100

  return (
    <div className="onboarding" role="main" aria-label="Wallet setup">
      {/* Progress indicator */}
      <div className="onboarding-progress" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div className="onboarding-progress-bar" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className={`onboarding-content ${isAnimating ? 'animating' : ''}`}>
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="onboarding-step welcome">
            <div className="onboarding-logo">
              <SimplySatsLogo size={56} />
            </div>
            <h1 className="onboarding-title">Welcome to Simply Sats</h1>
            <p className="onboarding-subtitle">
              A powerful BSV wallet built for simplicity and scale.
              Let's get you started.
            </p>
            <div className="onboarding-badge">
              <span className="status-dot online" aria-hidden="true"></span>
              BRC-100 Compatible
            </div>
          </div>
        )}

        {/* Features Step */}
        {step === 'features' && (
          <div className="onboarding-step features">
            <div className="feature-card">
              <span className="feature-icon" aria-hidden="true">{features[featureIndex]!.icon}</span>
              <h2 className="feature-title">{features[featureIndex]!.title}</h2>
              <p className="feature-description">{features[featureIndex]!.description}</p>
            </div>
            <div className="feature-dots" role="tablist" aria-label="Feature navigation">
              {features.map((_, idx) => (
                <button
                  key={idx}
                  className={`feature-dot ${idx === featureIndex ? 'active' : ''}`}
                  onClick={() => setFeatureIndex(idx)}
                  role="tab"
                  aria-selected={idx === featureIndex}
                  aria-label={`Feature ${idx + 1}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Action Step — buttons only, no password */}
        {step === 'action' && (
          <div className="onboarding-step action">
            <div className="onboarding-logo small">
              <SimplySatsLogo size={32} />
            </div>
            <h2 className="onboarding-action-title">Let's Set Up Your Wallet</h2>
            <p className="onboarding-action-subtitle">
              Choose an option to get started with Simply Sats
            </p>
            <div className="onboarding-actions">
              <button
                className="btn btn-primary btn-large"
                onClick={() => setStep('password')}
              >
                <Wallet size={16} strokeWidth={1.75} aria-hidden="true" />
                Create New Wallet
              </button>
              <button
                className="btn btn-secondary btn-large"
                onClick={onRestoreClick}
              >
                <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
                Restore Existing Wallet
              </button>
            </div>
            <p className="onboarding-disclaimer">
              Your recovery phrase is the only way to restore your wallet.
              Keep it safe and never share it.
            </p>
          </div>
        )}

        {/* Password Step — shown after clicking Create New Wallet */}
        {step === 'password' && (
          <div className="onboarding-step action">
            <div className="onboarding-logo small">
              <SimplySatsLogo size={32} />
            </div>
            <h2 className="onboarding-action-title">Create a Password</h2>
            <p className="onboarding-action-subtitle">
              This password encrypts your wallet on this device.
            </p>
            <div className="onboarding-password-section">
              <div className="form-group">
                <label className="form-label" htmlFor="create-password">Password</label>
                <PasswordInput
                  id="create-password"
                  placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={setPassword}
                />
                {passwordStrength && (
                  <div className="password-strength">
                    <div className="password-strength-bar">
                      <div
                        className="password-strength-fill"
                        style={{
                          width: `${(passwordStrength.score / 4) * 100}%`,
                          backgroundColor: passwordStrength.color
                        }}
                      />
                    </div>
                    <span className="password-strength-label" style={{ color: passwordStrength.color }}>
                      {passwordStrength.label}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirm-password">Confirm Password</label>
                <PasswordInput
                  id="confirm-password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
              </div>
              {passwordError && (
                <div className="form-error" role="alert">{passwordError}</div>
              )}
            </div>
            <div className="onboarding-actions">
              <button
                className="btn btn-primary btn-large"
                onClick={handleCreate}
                disabled={creating || !password || !confirmPassword}
              >
                {creating ? (
                  <>
                    <span className="spinner-small" aria-hidden="true" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Wallet size={16} strokeWidth={1.75} aria-hidden="true" />
                    Create Wallet
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="onboarding-nav">
        {step !== 'welcome' && (
          <button
            className="btn btn-ghost"
            onClick={handlePrev}
            aria-label="Previous"
          >
            <ChevronLeft size={16} strokeWidth={1.75} /> Back
          </button>
        )}
        <div className="nav-spacer" />
        {step !== 'action' && step !== 'password' && (
          <>
            <button
              className="btn btn-ghost"
              onClick={handleSkip}
              aria-label="Skip to wallet setup"
            >
              Skip
            </button>
            <button
              className="btn btn-primary"
              onClick={handleNext}
              aria-label="Next"
            >
              Next <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
