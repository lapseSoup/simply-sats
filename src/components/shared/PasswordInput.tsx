/**
 * PasswordInput Component
 *
 * A reusable password input with show/hide toggle button.
 * Extracted from LockScreenModal for reuse across the app.
 */

import { memo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  autoComplete?: string
  className?: string
  autoFocus?: boolean
}

export const PasswordInput = memo(function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  autoComplete = 'new-password',
  className = 'form-input',
  autoFocus = false
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="password-input-wrapper">
      <input
        id={id}
        type={showPassword ? 'text' : 'password'}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="password-toggle-btn"
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {showPassword ? (
          <EyeOff size={18} strokeWidth={1.75} />
        ) : (
          <Eye size={18} strokeWidth={1.75} />
        )}
      </button>
    </div>
  )
})
