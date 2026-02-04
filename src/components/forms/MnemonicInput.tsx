import { useState, useRef } from 'react'
import { wordlists } from 'bip39'

const BIP39_WORDLIST = wordlists.english

interface MnemonicInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function MnemonicInput({ value, onChange, placeholder }: MnemonicInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const getCurrentWord = (): { word: string; startIndex: number; endIndex: number } => {
    const textarea = textareaRef.current
    if (!textarea) return { word: '', startIndex: 0, endIndex: 0 }

    const cursorPos = textarea.selectionStart
    const text = value

    // Find word boundaries
    let startIndex = cursorPos
    while (startIndex > 0 && text[startIndex - 1] !== ' ') {
      startIndex--
    }

    let endIndex = cursorPos
    while (endIndex < text.length && text[endIndex] !== ' ') {
      endIndex++
    }

    return {
      word: text.slice(startIndex, endIndex).toLowerCase(),
      startIndex,
      endIndex
    }
  }

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

  return (
    <div className="mnemonic-input-container">
      <textarea
        ref={textareaRef}
        className="form-input"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        aria-label="Recovery phrase input"
        aria-describedby="mnemonic-hint"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
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
    </div>
  )
}
