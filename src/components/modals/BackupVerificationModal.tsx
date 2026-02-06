/**
 * Backup Verification Modal
 *
 * A mandatory backup verification flow that ensures users have properly
 * recorded their recovery phrase before allowing wallet creation to complete.
 *
 * Flow:
 * 1. Display mnemonic words with warning
 * 2. User clicks "I've Written It Down"
 * 3. Verification step: user must select correct words for 3 random positions
 * 4. Only after successful verification can user proceed
 *
 * @module components/modals/BackupVerificationModal
 */

import { useState, useMemo, useCallback } from 'react'
import { AlertTriangle, XCircle, PenLine, Lock, ShieldOff, CircleCheck } from 'lucide-react'
import { recordBackupVerification } from '../../services/backupReminder'

interface BackupVerificationModalProps {
  mnemonic: string
  onConfirm: () => void
  onCancel?: () => void
}

type VerificationStep = 'display' | 'verify' | 'success'

interface WordChallenge {
  position: number // 0-indexed position in mnemonic
  word: string // Correct word
  options: string[] // Shuffled options including correct word
}

/**
 * Generate 3 random word challenges from the mnemonic
 */
function generateChallenges(words: string[]): WordChallenge[] {
  // Pick 3 random positions
  const positions: number[] = []
  while (positions.length < 3) {
    const pos = Math.floor(Math.random() * words.length)
    if (!positions.includes(pos)) {
      positions.push(pos)
    }
  }
  positions.sort((a, b) => a - b)

  return positions.map(pos => {
    const correctWord = words[pos]

    // Pick 3 other random words as wrong options
    const wrongWords: string[] = []
    while (wrongWords.length < 3) {
      const randomPos = Math.floor(Math.random() * words.length)
      const word = words[randomPos]
      if (word !== correctWord && !wrongWords.includes(word)) {
        wrongWords.push(word)
      }
    }

    // Shuffle all 4 options
    const options = [correctWord, ...wrongWords]
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[options[i], options[j]] = [options[j], options[i]]
    }

    return {
      position: pos,
      word: correctWord,
      options
    }
  })
}

export function BackupVerificationModal({
  mnemonic,
  onConfirm,
  onCancel
}: BackupVerificationModalProps) {
  const words = useMemo(() => mnemonic.split(' '), [mnemonic])
  const [step, setStep] = useState<VerificationStep>('display')
  const [challenges, setChallenges] = useState<WordChallenge[]>([])
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleProceedToVerify = useCallback(() => {
    setChallenges(generateChallenges(words))
    setCurrentChallengeIndex(0)
    setSelectedAnswers([])
    setError(null)
    setStep('verify')
  }, [words])

  const handleSelectWord = useCallback((word: string) => {
    const challenge = challenges[currentChallengeIndex]

    if (word !== challenge.word) {
      setError(`Incorrect. Word #${challenge.position + 1} is not "${word}". Please try again.`)
      // Reset verification
      setTimeout(() => {
        setCurrentChallengeIndex(0)
        setSelectedAnswers([])
        setError(null)
      }, 2000)
      return
    }

    // Correct answer
    const newAnswers = [...selectedAnswers, word]
    setSelectedAnswers(newAnswers)
    setError(null)

    if (currentChallengeIndex < challenges.length - 1) {
      // Move to next challenge
      setCurrentChallengeIndex(currentChallengeIndex + 1)
    } else {
      // All challenges complete
      setStep('success')
    }
  }, [challenges, currentChallengeIndex, selectedAnswers])

  const handleBackToDisplay = useCallback(() => {
    setStep('display')
    setChallenges([])
    setCurrentChallengeIndex(0)
    setSelectedAnswers([])
    setError(null)
  }, [])

  return (
    <div className="modal-overlay">
      <div className="modal centered backup-verification-modal">
        {step === 'display' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Save Your Recovery Phrase</h2>
              {onCancel && (
                <button
                  className="modal-close"
                  onClick={onCancel}
                  aria-label="Cancel"
                >
                  ×
                </button>
              )}
            </div>
            <div className="modal-content compact">
              <div className="warning compact" role="alert">
                <span className="warning-icon" aria-hidden="true"><AlertTriangle size={16} strokeWidth={1.75} /></span>
                <span className="warning-text">
                  Write down these 12 words in order. This is the <strong>ONLY</strong> way
                  to recover your wallet. Never share it with anyone!
                </span>
              </div>

              <div className="mnemonic-display">
                <div className="mnemonic-words" role="list" aria-label="Recovery phrase words">
                  {words.map((word, i) => (
                    <div key={i} className="mnemonic-word" role="listitem">
                      <span className="mnemonic-word-number" aria-hidden="true">{i + 1}.</span>
                      <span className="sr-only">Word {i + 1}:</span>
                      <span className="mnemonic-word-text">{word}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="backup-instructions">
                <div className="backup-instruction">
                  <span className="backup-instruction-icon"><PenLine size={16} strokeWidth={1.75} /></span>
                  <span>Write each word on paper, numbered 1-12</span>
                </div>
                <div className="backup-instruction">
                  <span className="backup-instruction-icon"><Lock size={16} strokeWidth={1.75} /></span>
                  <span>Store in a safe, private location</span>
                </div>
                <div className="backup-instruction">
                  <span className="backup-instruction-icon"><ShieldOff size={16} strokeWidth={1.75} /></span>
                  <span>Never store digitally or share online</span>
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleProceedToVerify}
              >
                I've Written It Down
              </button>
            </div>
          </>
        )}

        {step === 'verify' && challenges.length > 0 && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Verify Your Backup</h2>
            </div>
            <div className="modal-content compact">
              <div className="verification-progress">
                <div className="verification-progress-bar">
                  {challenges.map((_, i) => (
                    <div
                      key={i}
                      className={`verification-progress-step ${
                        i < currentChallengeIndex ? 'complete' :
                        i === currentChallengeIndex ? 'active' : ''
                      }`}
                    />
                  ))}
                </div>
                <div className="verification-progress-label">
                  Question {currentChallengeIndex + 1} of {challenges.length}
                </div>
              </div>

              <div className="verification-challenge">
                <div className="verification-question">
                  What is word <strong>#{challenges[currentChallengeIndex].position + 1}</strong>?
                </div>

                {error && (
                  <div className="warning compact error" role="alert">
                    <span className="warning-icon" aria-hidden="true"><XCircle size={16} strokeWidth={1.75} /></span>
                    <span className="warning-text">{error}</span>
                  </div>
                )}

                <div className="verification-options">
                  {challenges[currentChallengeIndex].options.map((option, i) => (
                    <button
                      key={i}
                      className="btn btn-secondary verification-option"
                      onClick={() => handleSelectWord(option)}
                      disabled={!!error}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="btn btn-ghost"
                onClick={handleBackToDisplay}
              >
                ← Go Back to View Phrase
              </button>
            </div>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Backup Verified!</h2>
            </div>
            <div className="modal-content compact">
              <div className="verification-success">
                <div className="verification-success-icon"><CircleCheck size={48} strokeWidth={1.5} color="#22c55e" /></div>
                <div className="verification-success-title">
                  Your backup is confirmed
                </div>
                <div className="verification-success-message">
                  You've successfully verified your recovery phrase.
                  Keep it safe - you'll need it to restore your wallet.
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => {
                  recordBackupVerification()
                  onConfirm()
                }}
              >
                Complete Setup
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
