import { Code2, Eye } from "lucide-react";
import { useState } from "react";
import type { PreviewerProps } from "./types";

export function HtmlPreviewer({
  preview,
  language,
}: PreviewerProps): React.JSX.Element {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const content = preview.content ?? "";
  const isZh = language === "zh";
  const showingSource = mode === "source";
  return (
    <div className="files-preview-html">
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
