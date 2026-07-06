import { useMemo } from "react";
import { Braces } from "lucide-react";
import type { PreviewerProps } from "./types";

export function StructuredPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const parsed = useMemo(
    () => parseStructuredContent(preview.content ?? "", preview.kind),
    [preview.content, preview.kind],
  );
  return (
    <div className="files-preview-structured">
      <div className="files-preview-subtoolbar">
        <span>
          <Braces size={13} />
          {preview.kind}
        </span>
      </div>
      {parsed ? (
        <StructuredNode value={parsed} depth={0} />
      ) : (
        <pre className="files-preview-code">{preview.content ?? ""}</pre>
      )}
    </div>
  );
}

function StructuredNode({
  depth,
  value,
}: {
  depth: number;
  value: unknown;
}): React.JSX.Element {
  if (value === null || typeof value !== "object") {
    return <span className="files-structured-leaf">{String(value)}</span>;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <div className="files-structured-node" style={{ paddingLeft: depth * 12 }}>
      {entries.slice(0, 80).map(([key, child]) => (
        <div key={key} className="files-structured-row">
          <strong>{key}</strong>
          <StructuredNode value={child} depth={depth + 1} />
        </div>
      ))}
      {entries.length > 80 ? <small>truncated</small> : null}
    </div>
  );
}

function parseStructuredContent(content: string, kind: string): unknown | null {
  if (kind === "json") {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, 80);
  if (lines.length === 0) return null;
  return Object.fromEntries(
    lines.map((line, index) => {
      const separator = line.includes("=") ? "=" : ":";
      const [key, ...rest] = line.split(separator);
      return [key?.trim() || String(index), rest.join(separator).trim()];
    }),
  );
}
