import type { PreviewerProps } from "./types";
import { HighlightedLines } from "./HighlightedLines";

export function TextPreviewer({
  preview,
  highlight,
  language,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-text">
      <HighlightedLines
        content={preview.content ?? preview.message ?? ""}
        highlight={highlight}
        language={language}
        truncated={preview.truncated}
      />
    </div>
  );
}
