import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import type { PreviewerProps } from "./types";

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;

export function ImagePreviewer({
  preview,
}: PreviewerProps): JSX.Element {
  const [userZoom, setUserZoom] = useState(1);

  useEffect(() => {
    setUserZoom(1);
  }, [preview.dataUrl, preview.path]);

  const fitToPane = userZoom === 1;

  return (
    <div className="files-preview-image">
      <div className="files-preview-image-stage">
        {preview.dataUrl ? (
          <>
            <div className="files-preview-zoom files-preview-zoom-float" role="group" aria-label="Zoom">
              <button
                type="button"
                className="files-preview-zoom-btn"
                title="Zoom out"
                aria-label="Zoom out"
                disabled={userZoom <= ZOOM_MIN}
                onClick={() => setUserZoom((zoom) => Math.max(ZOOM_MIN, Number((zoom - ZOOM_STEP).toFixed(2))))}
              >
                <ZoomOut size={14} />
              </button>
              <button
                type="button"
                className="files-preview-zoom-label"
                title="Reset to fit"
                aria-label={`Zoom ${Math.round(userZoom * 100)} percent. Click to fit.`}
                onClick={() => setUserZoom(1)}
              >
                {fitToPane ? "Fit" : `${Math.round(userZoom * 100)}%`}
              </button>
              <button
                type="button"
                className="files-preview-zoom-btn"
                title="Zoom in"
                aria-label="Zoom in"
                disabled={userZoom >= ZOOM_MAX}
                onClick={() => setUserZoom((zoom) => Math.min(ZOOM_MAX, Number((zoom + ZOOM_STEP).toFixed(2))))}
              >
                <ZoomIn size={14} />
              </button>
            </div>
            <div className={`files-preview-image-viewport${fitToPane ? " is-fit" : ""}`}>
              <div
                className="files-preview-image-frame"
                style={fitToPane ? undefined : { width: `${Math.round(userZoom * 100)}%` }}
              >
                <img src={preview.dataUrl} alt={preview.name} />
              </div>
            </div>
          </>
        ) : (
          <p>{preview.message || "Image is too large for inline preview."}</p>
        )}
      </div>
    </div>
  );
}
