import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import { useEditorStore } from './store/editorStore';
import './styles.css';

// Expose React globally so user-authored components (bundled via esbuild)
// can import react without bundling their own copy.
(window as any).__EDITOR_REACT__ = React;
(window as any).__EDITOR_REACT_DOM__ = ReactDOM;

function formatErrorDetails(value: unknown): string {
  if (value instanceof Error) {
    const parts = [value.message || value.name || 'Error'];
    if (value.cause) parts.push(`Cause: ${formatErrorDetails(value.cause)}`);
    if (value.stack) parts.push(value.stack);
    return parts.filter(Boolean).join('\n');
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reportGlobalRendererError(source: string, errorLike: unknown) {
  const message = formatErrorDetails(errorLike) || 'Unknown renderer error';
  console.error(`[Global renderer error] ${source}:`, errorLike);
  useEditorStore.getState().setProjectError(`[${source}] ${message}`);
}

window.addEventListener('error', (event) => {
  reportGlobalRendererError('window.error', event.error ?? event.message);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  reportGlobalRendererError('unhandledrejection', event.reason);
  event.preventDefault();
});

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean; message: string; copied: boolean }
> {
  state = { hasError: false, message: '', copied: false };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: formatErrorDetails(error),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Root error boundary] App render crashed:', error, info);
    useEditorStore.getState().setProjectError(`[render] ${formatErrorDetails(error)}`);
  }

  handleCopy = () => {
    navigator.clipboard.writeText(this.state.message || 'No error details available.');
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 1500);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fatal-error-screen">
          <div className="fatal-error-card">
            <div className="fatal-error-header">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="#f87171" strokeWidth="1.5" />
                <path d="M10 6v4.5M10 13v.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="fatal-error-title">Fatal Render Error</span>
            </div>
            <p className="fatal-error-hint">The application crashed. Copy the error details below for debugging.</p>
            <div className="fatal-error-stack-wrapper">
              <pre className="fatal-error-stack">{this.state.message || 'No error details available.'}</pre>
            </div>
            <div className="fatal-error-actions">
              <button className="fatal-error-btn fatal-error-btn-copy" onClick={this.handleCopy}>
                {this.state.copied ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
                      <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H3.5" stroke="currentColor" strokeWidth="1.1" />
                    </svg>
                    Copy Error
                  </>
                )}
              </button>
              <button className="fatal-error-btn fatal-error-btn-reload" onClick={() => window.location.reload()}>
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
