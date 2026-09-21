import type { PreviewerProps } from "./types";

export function NotebookPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-notebook">
      <pre className="files-preview-code">{preview.content ?? preview.message ?? ""}</pre>
    </div>
  );
}
