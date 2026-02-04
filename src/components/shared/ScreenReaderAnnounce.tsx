import { useEffect, useState, createContext, useContext, type ReactNode } from 'react'

interface AnnouncementContext {
  announce: (message: string, priority?: 'polite' | 'assertive') => void
}

const AnnouncementCtx = createContext<AnnouncementContext | null>(null)

export function useAnnounce() {
  const ctx = useContext(AnnouncementCtx)
  if (!ctx) {
    // Return no-op if not within provider
    return { announce: () => {} }
  }
  return ctx
}

interface ScreenReaderAnnounceProps {
  children: ReactNode
}

export function ScreenReaderAnnounceProvider({ children }: ScreenReaderAnnounceProps) {
  const [politeMessage, setPoliteMessage] = useState('')
  const [assertiveMessage, setAssertiveMessage] = useState('')

  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (priority === 'assertive') {
      setAssertiveMessage('')
      // Small delay to ensure screen reader catches the change
      setTimeout(() => setAssertiveMessage(message), 50)
    } else {
      setPoliteMessage('')
      setTimeout(() => setPoliteMessage(message), 50)
    }
  }

  // Clear messages after announcement
  useEffect(() => {
    if (politeMessage) {
      const timer = setTimeout(() => setPoliteMessage(''), 1000)
      return () => clearTimeout(timer)
    }
  }, [politeMessage])

  useEffect(() => {
    if (assertiveMessage) {
      const timer = setTimeout(() => setAssertiveMessage(''), 1000)
      return () => clearTimeout(timer)
    }
  }, [assertiveMessage])

  return (
    <AnnouncementCtx.Provider value={{ announce }}>
      {children}
      {/* Hidden live regions for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </AnnouncementCtx.Provider>
  )
}
