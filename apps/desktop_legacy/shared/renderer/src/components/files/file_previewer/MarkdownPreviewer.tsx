import { useState } from "react";
import { Code2, Eye, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedLines } from "./HighlightedLines";
import type { PreviewerProps } from "./types";

export function MarkdownPreviewer({
  preview,
  highlight,
  language,
}: PreviewerProps): React.JSX.Element {
  // Opened to check a citation, the source view is the one that can show the
  // cited lines; rendered markdown has no line to point at. Still switchable,
  // because reading the passage in context is the next thing a reader wants.
  const [mode, setMode] = useState<"rendered" | "source">(highlight ? "source" : "rendered");
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
        <HighlightedLines
          content={content}
          highlight={highlight}
          language={language}
          truncated={preview.truncated}
        />
      )}
    </div>
  );
}
