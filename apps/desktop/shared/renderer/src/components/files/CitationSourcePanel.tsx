import { useEffect, useState } from "react";
import { FileText, TriangleAlert, X } from "lucide-react";
import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { CitationPart } from "@shared/structuredConversation";
import { isMissingWorkspacePreview, loadWorkspacePreview } from "../../workspacePreview";
import { resolveCitationSource } from "../../knowledgeSources";
import type { AppLanguage } from "../../navigation";
import { FilePreviewer } from "./file_previewer/FilePreviewer";

/**
 * Whether the preview came from the root we asked for.
 *
 * Compared case-insensitively with separators normalised, because the main
 * process returns the canonical real path while the root comes from the user's
 * own configuration. A root reached through a symlink reads as a mismatch,
 * which shows an error rather than an unverified file — the safe direction.
 */
function sameRoot(resolved: string, requested: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return normalize(resolved) === normalize(requested);
}

/**
 * The document a citation stands on, opened at the cited position.
 *
 * The whole point of a citation is that a reader can go check it. Naming a file
 * inside a corpus the chat cannot resolve is not something anyone can check, so
 * this pane resolves the Knowledge Base root, loads the file and marks the lines
 * the answer actually rested on.
 */
export function CitationSourcePanel({
  citation,
  language,
  onClose,
}: {
  citation: CitationPart;
  language: AppLanguage;
  onClose: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const target = await resolveCitationSource(citation);
        if (!target) {
          throw new Error(zh
            ? "找不到该引用所属的本地知识库，无法定位原文。"
            : "The Knowledge Base this citation belongs to is not available locally.");
        }
        const loaded = await loadWorkspacePreview(
          {
            workspacePath: target.rootPath,
            path: target.relativePath,
            // Ask for the largest slice the preview allows: a citation is useless
            // if the lines it points at fall outside what was loaded.
            maxBytes: 500_000,
          },
          { cacheMissing: false },
        );
        // A deleted file now resolves to a placeholder instead of failing, which
        // would render as an empty pane. Citations travel with the excerpt they
        // quote, and the error branch below keeps that excerpt on screen, so
        // sending a missing source there preserves the only thing left to check.
        if (isMissingWorkspacePreview(loaded)) {
          throw new Error(zh
            ? `被引文件已不存在（可能已被删除、移动或重命名）：${target.relativePath}`
            : `The cited file no longer exists (it may have been deleted, moved or renamed): ${target.relativePath}`);
        }
        // A preview root that does not exist falls back to the default
        // workspace instead of failing, which would quietly show a same-named
        // file from somewhere else as the source of the claim. Nothing about
        // the result would look wrong, so it has to be checked here.
        if (!sameRoot(loaded.workspacePath, target.rootPath)) {
          throw new Error(zh
            ? `知识库根目录 ${target.rootPath} 不可访问，无法确认这就是被引文件。`
            : `The Knowledge Base root ${target.rootPath} is unavailable, so the file shown could not be confirmed as the cited one.`);
        }
        if (!cancelled) setPreview(loaded);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [citation, zh]);

  const highlight = citation.lineStart !== undefined
    ? { start: citation.lineStart, end: citation.lineEnd ?? citation.lineStart }
    : undefined;

  return (
    <div className="citation-source-panel">
      <div className="citation-source-header">
        <FileText size={14} aria-hidden="true" />
        <div className="citation-source-title">
          <strong>{citation.title}</strong>
          {citation.locator ? <small>{citation.locator}</small> : null}
        </div>
        <button type="button" onClick={onClose} title={zh ? "关闭原文" : "Close source"} aria-label={zh ? "关闭原文" : "Close source"}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {loading ? (
        <p className="citation-source-status" role="status">{zh ? "正在打开原文…" : "Opening the source…"}</p>
      ) : error ? (
        <div className="citation-source-status error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <div>
            <p>{error}</p>
            {/* The passage travelled with the citation, so the claim can still
                be checked against it even when the file cannot be opened. */}
            {citation.excerpt ? <blockquote>{citation.excerpt}</blockquote> : null}
          </div>
        </div>
      ) : (
        <div className="citation-source-body">
          <FilePreviewer language={language} preview={preview} highlight={highlight} />
        </div>
      )}
    </div>
  );
}
