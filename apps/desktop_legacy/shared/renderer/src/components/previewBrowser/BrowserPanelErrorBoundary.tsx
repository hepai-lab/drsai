import { Component, ReactNode } from "react";
import { Globe2, ShieldAlert } from "lucide-react";

interface BrowserPanelErrorBoundaryProps {
  children: ReactNode;
}

interface BrowserPanelErrorBoundaryState {
  error: string | null;
}

export class BrowserPanelErrorBoundary extends Component<
  BrowserPanelErrorBoundaryProps,
  BrowserPanelErrorBoundaryState
> {
  state: BrowserPanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BrowserPanelErrorBoundaryState {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown): void {
    console.error("Preview Browser panel failed", error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <aside className="preview-browser-panel" aria-label="Preview Browser">
        <div className="preview-browser-header">
          <div>
            <h2>Browser</h2>
            <p>Preview panel recovered from an error.</p>
          </div>
        </div>
        <div className="preview-browser-status warning">
          <ShieldAlert size={14} />
          <span>{this.state.error}</span>
        </div>
        <div className="preview-browser-empty">
          <Globe2 size={28} />
          <h3>Browser panel paused</h3>
          <p>Close and reopen the Browser tab after fixing the page or URL that caused the failure.</p>
        </div>
      </aside>
    );
  }
}
