import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Catches render crashes so the app does not white-screen silently. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Money Track UI crash', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-4 text-center">
          <h1 className="text-xl font-semibold text-[var(--text)]">Something went wrong</h1>
          <p className="max-w-md text-sm text-[var(--muted)]" role="alert">
            The page crashed unexpectedly. Try refreshing. If it keeps happening, sign out and back
            in.
          </p>
          <button type="button" className="btn" onClick={() => window.location.assign('/')}>
            Reload Money Track
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
