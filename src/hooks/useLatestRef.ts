import { useRef, useEffect } from 'react'

/**
 * Returns a ref that always holds the latest value.
 * Useful for stable closures that need access to the most recent callback/value
 * without adding the value to effect dependency arrays.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return ref
}
