import { memo } from 'react'

/**
 * SimplySatsLogo - Modern "S" with satoshi dots representing the smallest unit of Bitcoin
 */
interface SimplySatsLogoProps {
  size?: number
}

export const SimplySatsLogo = memo(function SimplySatsLogo({ size = 32 }: SimplySatsLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background circle dots representing satoshis */}
      <circle cx="12" cy="12" r="3" fill="currentColor" opacity={0.15} />
      <circle cx="52" cy="12" r="3" fill="currentColor" opacity={0.15} />
      <circle cx="12" cy="52" r="3" fill="currentColor" opacity={0.15} />
      <circle cx="52" cy="52" r="3" fill="currentColor" opacity={0.15} />

      {/* Main S shape - bold, modern, geometric */}
      <path
        d="M44 18C44 18 40 12 32 12C24 12 18 17 18 24C18 31 24 33 32 35C40 37 46 39 46 48C46 55 40 60 32 60C22 60 18 52 18 52"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Top accent line */}
      <line x1="32" y1="4" x2="32" y2="12" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />

      {/* Bottom accent line */}
      <line x1="32" y1="60" x2="32" y2="52" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />

      {/* Satoshi dot accent - center */}
      <circle cx="32" cy="36" r="4" fill="currentColor" />
    </svg>
  )
})
