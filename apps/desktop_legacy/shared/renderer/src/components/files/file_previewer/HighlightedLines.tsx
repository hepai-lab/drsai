import { useEffect, useRef } from "react";
import type { AppLanguage } from "../../../navigation";
import type { LineHighlight } from "./types";

/**
 * File text with the cited lines marked and scrolled to.
 *
 * A citation that only names a file leaves the reader to search it, which is
 * the work the citation was supposed to save. Line numbers here are the raw
 * file lines the indexer counted, so they address this text directly.
 */
export function HighlightedLines({
  content,
  highlight,
  language,
  truncated,
}: {
  content: string;
  highlight?: LineHighlight;
  language: AppLanguage;
  truncated?: boolean;
}): React.JSX.Element {
  const markRef = useRef<HTMLSpanElement | null>(null);
  const lines = content.split("\n");
  // Line numbers address the whole file, but a truncated preview holds only its
  // head. Marking a line that is not the cited one would be worse than saying
  // the passage is not loaded, because it reads as a verified position.
  const beyondPreview = Boolean(highlight && highlight.start > lines.length);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [content, highlight?.start, highlight?.end]);

  if (!highlight) return <pre className="files-preview-code">{content}</pre>;

  return (
    <div className="files-preview-highlighted">
      {beyondPreview ? (
        <p className="files-preview-highlight-note" role="status">
          {language === "zh"
            ? `被引位置在第 ${highlight.start} 行，超出了已加载的 ${lines.length} 行${truncated ? "（文件已截断）" : ""}。`
            : `The cited position is line ${highlight.start}, past the ${lines.length} lines loaded${truncated ? " (file truncated)" : ""}.`}
        </p>
      ) : null}
      <pre className="files-preview-code">
        {lines.map((line, index) => {
          const number = index + 1;
          const marked = !beyondPreview && number >= highlight.start && number <= highlight.end;
          return (
            <span
              key={number}
              className={`files-preview-line ${marked ? "cited" : ""}`}
              ref={marked && number === highlight.start ? markRef : undefined}
            >
              <span className="files-preview-line-number" aria-hidden="true">{number}</span>
              <span className="files-preview-line-text">{line || " "}</span>
            </span>
          );
        })}
      </pre>
    </div>
  );
}
