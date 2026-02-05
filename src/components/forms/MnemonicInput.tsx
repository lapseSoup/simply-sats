import { useState, useRef, useCallback, useMemo } from 'react'
import { wordlists, validateMnemonic } from 'bip39'

const BIP39_WORDLIST = wordlists.english
const BIP39_SET = new Set(BIP39_WORDLIST)

interface MnemonicInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  expectedWords?: 12 | 24
}

interface WordValidation {
  word: string
  isValid: boolean
  index: number
}

export function MnemonicInput({
  value,
  onChange,
  placeholder,
  expectedWords = 12
}: MnemonicInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Parse and validate words
  const wordValidations = useMemo((): WordValidation[] => {
    const normalized = value.toLowerCase().trim()
    if (!normalized) return []

    // Split on any whitespace (handles multiple spaces, tabs, newlines)
    const words = normalized.split(/\s+/).filter(w => w.length > 0)
    return words.map((word, index) => ({
      word,
      isValid: BIP39_SET.has(word),
      index
    }))
  }, [value])

  const wordCount = wordValidations.length
  const invalidWords = wordValidations.filter(w => !w.isValid)
  const isValidCount = wordCount === expectedWords || wordCount === 24
  const isChecksumValid = useMemo(() => {
    if (wordCount !== 12 && wordCount !== 24) return false
    if (invalidWords.length > 0) return false
    const normalized = wordValidations.map(w => w.word).join(' ')
    return validateMnemonic(normalized)
  }, [wordValidations, wordCount, invalidWords.length])

  const getCurrentWord = useCallback((): { word: string; startIndex: number; endIndex: number } => {
    const textarea = textareaRef.current
    if (!textarea) return { word: '', startIndex: 0, endIndex: 0 }

    const cursorPos = textarea.selectionStart
    const text = value

    // Find word boundaries
    let startIndex = cursorPos
    while (startIndex > 0 && !/\s/.test(text[startIndex - 1])) {
      startIndex--
    }

    let endIndex = cursorPos
    while (endIndex < text.length && !/\s/.test(text[endIndex])) {
      endIndex++
    }

    return {
      word: text.slice(startIndex, endIndex).toLowerCase(),
      startIndex,
      endIndex
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    // Get current word being typed
    setTimeout(() => {
      const { word } = getCurrentWord()

      if (word.length >= 1) {
        const matches = BIP39_WORDLIST.filter(w => w.startsWith(word)).slice(0, 6)
        setSuggestions(matches)
        setShowSuggestions(matches.length > 0)
        setSelectedIndex(0)
      } else {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 0)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')

    // Normalize pasted text: lowercase, trim, collapse whitespace
    const normalized = pastedText
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')

    onChange(normalized)
    setShowSuggestions(false)
    setSuggestions([])
  }

  const selectSuggestion = (suggestion: string) => {
    const { startIndex, endIndex } = getCurrentWord()
    const newValue = value.slice(0, startIndex) + suggestion + ' ' + value.slice(endIndex).trimStart()
    onChange(newValue)
    setSuggestions([])
    setShowSuggestions(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectSuggestion(suggestions[selectedIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  // Determine status color
  const getStatusColor = () => {
    if (wordCount === 0) return 'var(--color-text-secondary, rgba(255, 255, 255, 0.5))'
    if (invalidWords.length > 0) return 'var(--color-error, #ef4444)'
    if (!isValidCount) return 'var(--color-warning, #eab308)'
    if (isChecksumValid) return 'var(--color-success, #22c55e)'
    return 'var(--color-error, #ef4444)' // Valid words but invalid checksum
  }

  const getStatusMessage = () => {
    if (wordCount === 0) return `Enter your ${expectedWords} word recovery phrase`
    if (invalidWords.length > 0) {
      const invalidList = invalidWords.slice(0, 3).map(w => `"${w.word}"`).join(', ')
      const moreCount = invalidWords.length - 3
      return `Invalid word${invalidWords.length > 1 ? 's' : ''}: ${invalidList}${moreCount > 0 ? ` +${moreCount} more` : ''}`
    }
    if (!isValidCount) return `${wordCount}/${expectedWords} words`
    if (isChecksumValid) return 'Valid recovery phrase'
    return 'Invalid checksum - please check your words'
  }

  return (
    <div className="mnemonic-input-container">
      <textarea
        ref={textareaRef}
        className={`form-input mnemonic-textarea ${invalidWords.length > 0 ? 'has-errors' : ''} ${isChecksumValid ? 'is-valid' : ''}`}
        placeholder={placeholder || `Enter your ${expectedWords} word recovery phrase`}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        aria-label="Recovery phrase input"
        aria-describedby="mnemonic-status"
        aria-invalid={invalidWords.length > 0 || (isValidCount && !isChecksumValid)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />

      {/* Word count and validation status */}
      <div
        id="mnemonic-status"
        className="mnemonic-status"
        style={{ color: getStatusColor() }}
        role="status"
        aria-live="polite"
      >
        <span className="mnemonic-status-icon">
          {wordCount === 0 && '📝'}
          {wordCount > 0 && invalidWords.length > 0 && '⚠️'}
          {wordCount > 0 && invalidWords.length === 0 && !isValidCount && '🔢'}
          {isValidCount && !isChecksumValid && invalidWords.length === 0 && '❌'}
          {isChecksumValid && '✓'}
        </span>
        <span className="mnemonic-status-text">{getStatusMessage()}</span>
        {wordCount > 0 && (
          <span className="mnemonic-word-count">
            {wordCount}/{expectedWords}
          </span>
        )}
      </div>

      {/* Word chips for visual feedback */}
      {wordCount > 0 && wordCount <= 24 && (
        <div className="mnemonic-words-preview">
          {wordValidations.map((w, i) => (
            <span
              key={i}
              className={`mnemonic-word-chip ${w.isValid ? 'valid' : 'invalid'}`}
              title={w.isValid ? 'Valid BIP-39 word' : 'Invalid word - not in BIP-39 wordlist'}
            >
              <span className="mnemonic-word-number">{i + 1}</span>
              {w.word}
            </span>
          ))}
        </div>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <div className="mnemonic-suggestions" role="listbox" aria-label="Word suggestions">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion}
              className={`mnemonic-suggestion ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              role="option"
              aria-selected={index === selectedIndex}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .mnemonic-input-container {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .mnemonic-textarea {
          min-height: 100px;
          resize: vertical;
          font-family: monospace;
          line-height: 1.6;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .mnemonic-textarea.has-errors {
          border-color: var(--color-error, #ef4444);
        }

        .mnemonic-textarea.is-valid {
          border-color: var(--color-success, #22c55e);
        }

        .mnemonic-textarea.is-valid:focus {
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
        }

        .mnemonic-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8125rem;
          padding: 0.25rem 0;
        }

        .mnemonic-status-icon {
          font-size: 1rem;
        }

        .mnemonic-status-text {
          flex: 1;
        }

        .mnemonic-word-count {
          font-family: monospace;
          font-weight: 500;
          padding: 0.125rem 0.5rem;
          background: var(--color-surface, rgba(255, 255, 255, 0.05));
          border-radius: 0.25rem;
        }

        .mnemonic-words-preview {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          padding: 0.75rem;
          background: var(--color-surface, rgba(255, 255, 255, 0.03));
          border-radius: 0.5rem;
          max-height: 150px;
          overflow-y: auto;
        }

        .mnemonic-word-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
          font-family: monospace;
          border-radius: 0.25rem;
          transition: all 0.15s ease;
        }

        .mnemonic-word-chip.valid {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-success, #22c55e);
          border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .mnemonic-word-chip.invalid {
          background: rgba(239, 68, 68, 0.15);
          color: var(--color-error, #ef4444);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .mnemonic-word-number {
          font-size: 0.625rem;
          opacity: 0.6;
          min-width: 1rem;
        }

        .mnemonic-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-surface-2, #1a1a2e);
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          border-radius: 0.5rem;
          margin-top: 0.25rem;
          max-height: 200px;
          overflow-y: auto;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .mnemonic-suggestion {
          padding: 0.625rem 0.75rem;
          cursor: pointer;
          font-family: monospace;
          transition: background 0.1s ease;
        }

        .mnemonic-suggestion:hover,
        .mnemonic-suggestion.selected {
          background: var(--color-primary, #f7931a);
          color: white;
        }
      `}</style>
    </div>
  )
}
