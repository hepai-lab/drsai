import { useState } from "react";
import { Code2, Eye, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PreviewerProps } from "./types";

export function MarkdownPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const content = preview.content ?? "";
  return (
    <div className="files-preview-markdown">
      <div className="files-preview-subtoolbar">
        <span>
          <FileText size={13} />
          Markdown
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
        <div className="files-preview-rendered-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="files-preview-code">{content}</pre>
      )}
    </div>
  );
}
