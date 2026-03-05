/** Average BSV block time is ~10 minutes (600 seconds) */
export const AVERAGE_BLOCK_TIME_SECONDS = 600

/** Format a duration in seconds to a human-readable string like "~1 month", "~2 weeks", "~2d 5h", or "~30m" */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ready!'

  const days = Math.floor(seconds / 86400)

  if (days >= 30) {
    const months = Math.floor(days / 30)
    return `~${months} month${months > 1 ? 's' : ''}`
  }

  if (days >= 7) {
    const weeks = Math.floor(days / 7)
    return `~${weeks} week${weeks > 1 ? 's' : ''}`
  }

  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `~${days}d ${hours}h`
  } else if (hours > 0) {
    return `~${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `~${minutes}m`
  } else {
    return '<1m'
  }
}
