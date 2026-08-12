import { Component, type ReactNode } from "react";

interface State {
  hasError: boolean;
  error?: Error;
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void error;
    void info;
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen items-center justify-center p-8 text-center">
            <div className="max-w-md space-y-4 rounded-lg border bg-background p-8 shadow-lg">
              <h2 className="text-2xl font-bold">Something went wrong.</h2>
              <p className="text-sm text-muted-foreground">
                Please refresh the page or contact your supervisor.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Reload
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}