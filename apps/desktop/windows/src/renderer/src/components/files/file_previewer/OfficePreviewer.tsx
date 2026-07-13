import { FileType2 } from "lucide-react";
import { MetadataPreviewer } from "./MetadataPreviewer";
import type { PreviewerProps } from "./types";

export function OfficePreviewer(props: PreviewerProps): React.JSX.Element {
  const { preview } = props;
  if (!preview.content) return <MetadataPreviewer {...props} />;
  return (
    <div className="files-preview-office">
      <div className="files-preview-subtoolbar">
        <span>
          <FileType2 size={13} />
          Office text
        </span>
        {preview.message ? <span>{preview.message}</span> : null}
      </div>
      <pre className="files-preview-code">{preview.content}</pre>
    </div>
  );
}
