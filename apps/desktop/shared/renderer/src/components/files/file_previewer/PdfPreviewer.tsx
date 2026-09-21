import { useEffect, useState, type JSX } from "react";
import { formatBytes, toFileUrl, type PreviewerProps } from "./types";

/** Prefer decoding data URLs directly — `fetch(data:...)` fails in Electron. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mime = mimeMatch?.[1] || "application/pdf";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export function PdfPreviewer({
  preview,
}: PreviewerProps): JSX.Element {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobError, setBlobError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setBlobError(null);

    void (async () => {
      try {
        if (preview.dataUrl?.startsWith("data:")) {
          const blob = dataUrlToBlob(preview.dataUrl);
          const nextUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          objectUrl = nextUrl;
          setBlobUrl(nextUrl);
          return;
        }

        // Local workspace path fallback when bytes were not shipped over IPC.
        if (preview.path && !preview.path.startsWith("artifact://")) {
          setBlobUrl(toFileUrl(preview.path));
          return;
        }

        setBlobError(null);
      } catch (cause) {
        if (cancelled) return;
        setBlobError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview.dataUrl, preview.path]);

  const preparing = Boolean(preview.dataUrl) && !blobUrl && !blobError;
  const showFallback = !blobUrl && (Boolean(blobError) || !preview.dataUrl);

  return (
    <div className="files-preview-pdf">
      {blobUrl ? (
        <div className="files-preview-pdf-viewport">
          <iframe
            className="files-preview-pdf-iframe"
            src={blobUrl}
            title={preview.relativePath || preview.path || "PDF preview"}
          />
        </div>
      ) : null}

      {preparing ? (
        <div className="files-preview-pdf-safe">
          <p>Preparing inline PDF preview…</p>
        </div>
      ) : null}

      {showFallback ? (
        <div className="files-preview-pdf-safe">
          <p>
            {blobError
              ? `Inline PDF preview failed: ${blobError}`
              : "Inline PDF preview is unavailable for this file (too large or unreadable). Use the system open button in the Files toolbar for the full document."}
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
          {/* Extracted text only when the original PDF cannot be shown. */}
          {preview.content ? <pre className="files-preview-code">{preview.content}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
