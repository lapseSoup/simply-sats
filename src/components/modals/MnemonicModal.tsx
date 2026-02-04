interface MnemonicModalProps {
  mnemonic: string
  onConfirm: () => void
}

export function MnemonicModal({ mnemonic, onConfirm }: MnemonicModalProps) {
  const words = mnemonic.split(' ')

  return (
    <div className="modal-overlay">
      <div className="modal centered">
        <div className="modal-header">
          <h2 className="modal-title">Recovery Phrase</h2>
        </div>
        <div className="modal-content compact">
          <div className="warning compact" role="alert">
            <span className="warning-icon" aria-hidden="true">⚠️</span>
            <span className="warning-text">
              Write down these 12 words and keep them safe. This is the ONLY way to recover your wallet!
            </span>
          </div>
          <div className="mnemonic-display">
            <div className="mnemonic-words" role="list" aria-label="Recovery phrase words">
              {words.map((word, i) => (
                <div key={i} className="mnemonic-word" role="listitem">
                  <span aria-hidden="true">{i + 1}.</span>
                  <span className="sr-only">Word {i + 1}:</span>
                  {word}
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={onConfirm}>
            I've Saved My Phrase
          </button>
        </div>
      </div>
    </div>
  )
}
