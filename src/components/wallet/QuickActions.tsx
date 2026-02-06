import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'

interface QuickActionsProps {
  onSend: () => void
  onReceive: () => void
}

export function QuickActions({ onSend, onReceive }: QuickActionsProps) {
  return (
    <div className="quick-actions">
      <button
        className="action-btn primary"
        onClick={onSend}
        aria-label="Send BSV"
      >
        <ArrowUpRight size={16} strokeWidth={1.75} /> Send
      </button>
      <button
        className="action-btn secondary"
        onClick={onReceive}
        aria-label="Receive BSV"
      >
        <ArrowDownLeft size={16} strokeWidth={1.75} /> Receive
      </button>
    </div>
  )
}
