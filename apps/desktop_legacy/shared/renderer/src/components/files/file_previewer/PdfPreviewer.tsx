import { FileText } from "lucide-react";
import { formatBytes, type PreviewerProps } from "./types";

export function PdfPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-pdf">
      <div className="files-preview-subtoolbar">
        <span>
          <FileText size={13} />
          PDF
        </span>
        {preview.message ? <span>{preview.message}</span> : null}
      </div>
      <div className="files-preview-pdf-safe">
        <p>
          Inline PDF rendering is disabled here to keep the desktop shell stable.
          Use the system open button in the Files toolbar for the full document.
        </p>
        <dl>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(preview.size)}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd title={preview.path}>{preview.relativePath}</dd>
          </div>
        </dl>
      </div>
      {preview.content ? <pre className="files-preview-code">{preview.content}</pre> : null}
    </div>
  );
}
