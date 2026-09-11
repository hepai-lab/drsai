import { useState } from "react";
import { Code2, Eye } from "lucide-react";
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
  const isZh = language === "zh";
  const showingSource = mode === "source";
  return (
    <div className="files-preview-markdown">
      <button
        type="button"
        className="files-preview-mode-toggle files-preview-mode-toggle-float"
        aria-pressed={showingSource}
        title={showingSource
          ? (isZh ? "切换到渲染视图" : "Switch to rendered view")
          : (isZh ? "切换到源码视图" : "Switch to source view")}
        onClick={() => setMode((current) => (current === "rendered" ? "source" : "rendered"))}
      >
        {showingSource ? <Eye size={12} /> : <Code2 size={12} />}
        {showingSource
          ? (isZh ? "渲染" : "Render")
          : (isZh ? "源码" : "Source")}
      </button>
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
