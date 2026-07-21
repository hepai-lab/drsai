import { Braces } from "lucide-react";
import type { PreviewerProps } from "./types";

export function OutlinePreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-outline">
      <div className="files-preview-subtoolbar">
        <span>
          <Braces size={13} />
          Outline
        </span>
      </div>
      <ol>
        {(preview.outline ?? []).map((item, index) => (
          <li key={`${preview.path}-outline-${index}`}>{item}</li>
        ))}
      </ol>
    </div>
  );
}
