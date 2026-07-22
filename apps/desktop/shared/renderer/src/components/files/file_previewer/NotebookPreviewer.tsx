import { NotebookTabs } from "lucide-react";
import type { PreviewerProps } from "./types";

export function NotebookPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-notebook">
      <div className="files-preview-subtoolbar">
        <span>
          <NotebookTabs size={13} />
          Notebook cells
        </span>
        {preview.truncated ? <span>truncated</span> : null}
      </div>
      <pre className="files-preview-code">{preview.content ?? preview.message ?? ""}</pre>
    </div>
  );
}
