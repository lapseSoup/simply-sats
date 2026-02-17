import { memo } from 'react'

interface SkipLinkProps {
  targetId: string
  children: string
}

export const SkipLink = memo(function SkipLink({ targetId, children }: SkipLinkProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const target = document.getElementById(targetId)
    if (target) {
      target.focus()
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <a
      href={`#${targetId}`}
      className="skip-link"
      onClick={handleClick}
    >
      {children}
    </a>
  )
})
