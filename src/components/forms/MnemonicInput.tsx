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
    while (startIndex > 0 && !/\s/.test(text[startIndex - 1]!)) {
      startIndex--
    }

    let endIndex = cursorPos
    while (endIndex < text.length && !/\s/.test(text[endIndex]!)) {
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
        const matches = BIP39_WORDLIST!.filter(w => w.startsWith(word)).slice(0, 6)
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

    // Normalize pasted text: lowercase, trim
    let normalized = pastedText.toLowerCase().trim()

    // Remove common copy/paste artifacts:
    // - Numbered words like "1. word" or "1) word" or "1 word"
    normalized = normalized.replace(/^\d+[.)\s]+/gm, '')
    // - Commas between words
    normalized = normalized.replace(/,/g, ' ')
    // - Bullet points
    normalized = normalized.replace(/[•\-*]/g, ' ')
    // - Newlines to spaces
    normalized = normalized.replace(/[\r\n]+/g, ' ')
    // - Multiple spaces to single space
    normalized = normalized.replace(/\s+/g, ' ').trim()

    onChange(normalized)
    setShowSuggestions(false)
    setSuggestions([])
  }

  const handleClear = () => {
    onChange('')
    setSuggestions([])
    setShowSuggestions(false)
    textareaRef.current?.focus()
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
      selectSuggestion(suggestions[selectedIndex]!)
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  // Determine status color
  const getStatusColor = () => {
    if (wordCount === 0) return 'var(--text-secondary)'
    if (invalidWords.length > 0) return 'var(--error)'
    if (!isValidCount) return 'var(--warning)'
    if (isChecksumValid) return 'var(--success)'
    return 'var(--error)' // Valid words but invalid checksum
  }

  const getStatusMessage = () => {
    if (wordCount === 0) return `Enter your ${expectedWords} word recovery phrase`
    if (invalidWords.length > 0) {
      const invalidList = invalidWords.slice(0, 3).map(w => `"${w.word}"`).join(', ')
      const moreCount = invalidWords.length - 3
      // Check for common typo patterns
      const hasNumbers = invalidWords.some(w => /\d/.test(w.word))
      const hasSpecialChars = invalidWords.some(w => /[^a-z]/.test(w.word))
      let hint = ''
      if (hasNumbers) hint = ' (remove numbers)'
      else if (hasSpecialChars) hint = ' (letters only)'
      return `Invalid word${invalidWords.length > 1 ? 's' : ''}: ${invalidList}${moreCount > 0 ? ` +${moreCount} more` : ''}${hint}`
    }
    if (!isValidCount) {
      if (wordCount < expectedWords) {
        return `${wordCount}/${expectedWords} words - need ${expectedWords - wordCount} more`
      }
      return `${wordCount}/${expectedWords} words - too many words`
    }
    if (isChecksumValid) return 'Valid recovery phrase ✓'
    return 'Words are correct but order may be wrong - please verify'
  }

  return (
    <div className="mnemonic-input-container">
      <div className="mnemonic-textarea-wrapper">
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
          aria-activedescendant={showSuggestions && selectedIndex >= 0 ? `mnemonic-suggestion-${selectedIndex}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            className="mnemonic-clear-btn"
            onClick={handleClear}
            aria-label="Clear recovery phrase"
            title="Clear"
          >
            ×
          </button>
        )}
      </div>

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
              id={`mnemonic-suggestion-${index}`}
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
          gap: 4px;
        }

        .mnemonic-textarea-wrapper {
          position: relative;
        }

        .mnemonic-textarea {
          min-height: 64px;
          resize: none;
          font-family: monospace;
          font-size: 13px;
          line-height: 1.5;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          padding-right: 3rem;
        }

        .mnemonic-clear-btn {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          width: 1.75rem;
          height: 1.75rem;
          min-width: 1.75rem;
          min-height: 1.75rem;
          border-radius: 50%;
          border: none;
          background: var(--bg-surface-2);
          color: var(--text-secondary);
          font-size: 1.25rem;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .mnemonic-clear-btn:hover {
          background: var(--error);
          color: white;
        }

        .mnemonic-textarea.has-errors {
          border-color: var(--error);
        }

        .mnemonic-textarea.is-valid {
          border-color: var(--success);
        }

        .mnemonic-textarea.is-valid:focus {
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
        }

        .mnemonic-status {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          padding: 0;
        }

        .mnemonic-status-icon {
          font-size: 0.875rem;
        }

        .mnemonic-status-text {
          flex: 1;
        }

        .mnemonic-word-count {
          font-family: monospace;
          font-weight: 500;
          padding: 0.125rem 0.5rem;
          background: var(--bg-surface-2);
          border-radius: 0.25rem;
        }

        .mnemonic-words-preview {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          padding: 6px;
          background: var(--bg-surface-2);
          border-radius: 0.375rem;
          max-height: 80px;
          overflow-y: auto;
        }

        .mnemonic-word-chip {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 6px;
          font-size: 0.6875rem;
          font-family: monospace;
          border-radius: 3px;
          transition: all 0.15s ease;
        }

        .mnemonic-word-chip.valid {
          background: var(--success-bg);
          color: var(--success);
          border: 1px solid var(--success-border);
        }

        .mnemonic-word-chip.invalid {
          background: var(--error-bg);
          color: var(--error);
          border: 1px solid var(--error-border);
        }

        .mnemonic-word-number {
          font-size: 0.5625rem;
          opacity: 1;
          color: var(--text-tertiary, rgba(255, 255, 255, 0.35));
          min-width: 0.875rem;
        }

        .mnemonic-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--bg-surface-3);
          border: 1px solid var(--border);
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
          background: var(--accent);
          color: white;
        }
      `}</style>
    </div>
  )
}
