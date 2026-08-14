import { Code2, FileText } from "lucide-react";
import { HighlightedLines } from "./HighlightedLines";
import type { PreviewerProps } from "./types";

export function TextPreviewer({
  preview,
  highlight,
  language,
}: PreviewerProps): React.JSX.Element {
  const title = preview.kind === "code" ? "Code" : "Text";
  const Icon = preview.kind === "code" ? Code2 : FileText;
  return (
    <div className="files-preview-text">
      <div className="files-preview-subtoolbar">
        <span>
          <Icon size={13} />
          {title}
        </span>
        {preview.truncated ? <span>truncated</span> : null}
      </div>
      <HighlightedLines
        content={preview.content ?? preview.message ?? ""}
        highlight={highlight}
        language={language}
        truncated={preview.truncated}
      />
    </div>
  );
}
