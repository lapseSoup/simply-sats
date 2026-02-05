/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { logger } from '../../services/logger'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  context?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, context } = this.props

    // Log the error
    logger.error(`Error in ${context || 'component'}`, error, {
      componentStack: errorInfo.componentStack
    })

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo)
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (hasError && error) {
      // Custom fallback renderer
      if (typeof fallback === 'function') {
        return fallback(error, this.handleReset)
      }

      // Custom fallback element
      if (fallback) {
        return fallback
      }

      // Default fallback UI
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-content">
            <svg
              className="error-icon"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2>Something went wrong</h2>
            <p className="error-message">{error.message}</p>
            <button
              type="button"
              className="error-retry-button"
              onClick={this.handleReset}
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }

    return children
  }
}

/**
 * Specialized error boundary for wallet-related errors
 */
export class WalletErrorBoundary extends Component<
  Omit<ErrorBoundaryProps, 'context'>,
  ErrorBoundaryState
> {
  constructor(props: Omit<ErrorBoundaryProps, 'context'>) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('Wallet error', error, {
      componentStack: errorInfo.componentStack
    })

    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (hasError && error) {
      if (typeof fallback === 'function') {
        return fallback(error, this.handleReset)
      }

      if (fallback) {
        return fallback
      }

      return (
        <div className="error-boundary wallet-error" role="alert">
          <div className="error-boundary-content">
            <svg
              className="error-icon"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            <h2>Wallet Error</h2>
            <p className="error-message">{error.message}</p>
            <p className="error-hint">
              Your funds are safe. Try refreshing or restarting the app.
            </p>
            <div className="error-actions">
              <button
                type="button"
                className="error-retry-button"
                onClick={this.handleReset}
              >
                Try Again
              </button>
              <button
                type="button"
                className="error-refresh-button"
                onClick={() => window.location.reload()}
              >
                Refresh App
              </button>
            </div>
          </div>
        </div>
      )
    }

    return children
  }
}

/**
 * HOC to wrap a component with an error boundary
 */
// eslint-disable-next-line react-refresh/only-export-components
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.ComponentType<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component'

  const WithErrorBoundary = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps} context={displayName}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  )

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`

  return WithErrorBoundary
}

export default ErrorBoundary
