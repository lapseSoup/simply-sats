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
        ↑ Send
      </button>
      <button
        className="action-btn secondary"
        onClick={onReceive}
        aria-label="Receive BSV"
      >
        ↓ Receive
      </button>
    </div>
  )
}
