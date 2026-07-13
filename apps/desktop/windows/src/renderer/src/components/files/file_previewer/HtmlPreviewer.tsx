import { Code2, Eye, FileCode2 } from "lucide-react";
import { useState } from "react";
import type { PreviewerProps } from "./types";

export function HtmlPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const content = preview.content ?? "";
  return (
    <div className="files-preview-html">
      <div className="files-preview-subtoolbar">
        <span>
          <FileCode2 size={13} />
          HTML
        </span>
        <div>
          <button
            type="button"
            className={mode === "rendered" ? "active" : ""}
            onClick={() => setMode("rendered")}
          >
            <Eye size={12} />
            Render
          </button>
          <button
            type="button"
            className={mode === "source" ? "active" : ""}
            onClick={() => setMode("source")}
          >
            <Code2 size={12} />
            Source
          </button>
        </div>
      </div>
      {mode === "rendered" ? (
        <iframe
          className="files-preview-html-frame"
          sandbox=""
          srcDoc={content}
          title={`HTML preview of ${preview.name}`}
        />
      ) : (
        <pre className="files-preview-code">{content}</pre>
      )}
    </div>
  );
}
