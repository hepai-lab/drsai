import type { PreviewerProps } from "./types";
import { MetadataList } from "./MetadataList";

export function ImagePreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-image">
      {preview.dataUrl ? (
        <img src={preview.dataUrl} alt={preview.name} />
      ) : (
        <p>{preview.message || "Image is too large for inline preview."}</p>
      )}
      <MetadataList metadata={preview.metadata} />
    </div>
  );
}
