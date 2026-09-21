import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { FilePreviewer } from "./file_previewer/FilePreviewer";

export function FilePreview({
  language,
  preview,
}: {
  language: AppLanguage;
  preview: WorkspaceFilePreview | null;
}): React.JSX.Element {
  return (
    <FilePreviewErrorBoundary resetKey={preview?.path ?? "empty"}>
      <FilePreviewer language={language} preview={preview} />
    </FilePreviewErrorBoundary>
  );
}

class FilePreviewErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Files preview failed", error, info.componentStack);
  }

  componentDidUpdate(previousProps: { resetKey: string }): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="files-preview-empty">
        <AlertTriangle size={24} />
        <h3>Preview failed</h3>
        <p>{this.state.error.message || "This file preview crashed and was isolated."}</p>
      </div>
    );
  }
}
