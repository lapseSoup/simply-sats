/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertCircle, Wallet } from 'lucide-react'
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
            <AlertCircle className="error-icon" size={48} strokeWidth={2} />
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
            <Wallet className="error-icon" size={48} strokeWidth={2} color="#ef4444" />
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
