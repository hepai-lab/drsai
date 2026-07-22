import { File } from "lucide-react";
import { formatBytes, type PreviewerProps } from "./types";
import { MetadataList } from "./MetadataList";

export function MetadataPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-metadata">
      <File size={22} />
      <h3>{preview.name}</h3>
      <p>{preview.message || "Preview is metadata-only for this file type."}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{preview.kind}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(preview.size)}</dd>
        </div>
      </dl>
      <MetadataList metadata={preview.metadata} />
    </div>
  );
}
