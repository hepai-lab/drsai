import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Rows3,
  Rows4,
  SquareArrowOutUpRight,
  RefreshCw,
} from "lucide-react";
import type {
  ChatAttachment,
  WorkspaceFileNode,
  WorkspaceFilePreview,
} from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";
import type { AgentFileTraceEvent } from "./AgentFileActivityPanel";
import { FilePreview } from "./FilePreview";

interface FilesContextPanelProps {
  basket: ChatAttachment[];
  fileTraceEvents: AgentFileTraceEvent[];
  language: AppLanguage;
  scopeId: string;
  workspacePath: string;
  workspaceTrusted: boolean;
  onBasketChange: (attachments: ChatAttachment[]) => void;
  onFileTraceChange: (events: AgentFileTraceEvent[]) => void;
  onInsertPath: (path: string) => void;
}

type LoadState = "idle" | "loading" | "error";

export function FilesContextPanel({
  basket,
  fileTraceEvents,
  language,
  scopeId,
  workspacePath,
  workspaceTrusted,
  onBasketChange,
  onFileTraceChange,
  onInsertPath,
}: FilesContextPanelProps): React.JSX.Element {
  void scopeId;
  void onBasketChange;
  void onFileTraceChange;
  void onInsertPath;
  const zh = language === "zh";
  const [selectedNode, setSelectedNode] = useState<WorkspaceFileNode | null>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [systemOpenIconUrl, setSystemOpenIconUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const previewRequestPathRef = useRef<string | null>(null);
  const lastAutoPreviewPathRef = useRef<string | null>(null);

  const systemOpenLabel = selectedNode?.type === "directory"
    ? "Open folder"
    : "Open with system app";

  const previewPath = useCallback(async (path: string, name?: string): Promise<void> => {
    if (!workspacePath || !path) return;
    previewRequestPathRef.current = path;
    setSelectedNode({
      name: name || path.split(/[\\/]/).pop() || path,
      path,
      relativePath: toRelativePath(workspacePath, path),
      type: "file",
    });
    setError(null);
    setPreview(null);
    setPreviewState("loading");
    try {
      const nextPreview = await desktopApi.previewWorkspaceFile({
        workspacePath,
        path,
        maxBytes: 220_000,
      });
      if (previewRequestPathRef.current !== path) return;
      setPreview(nextPreview);
      setPreviewState("idle");
    } catch (caught) {
      if (previewRequestPathRef.current !== path) return;
      setPreview(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      setPreviewState("error");
    }
  }, [workspacePath]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!selectedNode?.path) return;
    await previewPath(selectedNode.path, selectedNode.name);
  }, [previewPath, selectedNode?.name, selectedNode?.path]);

  useEffect(() => {
    setSelectedNode(null);
    setPreview(null);
    setPreviewState("idle");
    setError(null);
    lastAutoPreviewPathRef.current = null;
  }, [workspacePath]);

  // Auto-preview the latest agent/chat file path when the tree is hidden.
  useEffect(() => {
    const candidate =
      fileTraceEvents.find((event) => Boolean(event.path)) ??
      basket.find((item) => item.kind === "file" && Boolean(item.path));
    const path = candidate?.path;
    if (!path || path === lastAutoPreviewPathRef.current) return;
    lastAutoPreviewPathRef.current = path;
    void previewPath(path, "name" in candidate ? candidate.name : undefined);
  }, [basket, fileTraceEvents, previewPath]);

  useEffect(() => {
    let cancelled = false;
    setSystemOpenIconUrl(null);
    if (!selectedNode) return () => {
      cancelled = true;
    };

    void desktopApi.getFileIcon(selectedNode.path)
      .then((result) => {
        if (!cancelled && result.path === selectedNode.path) {
          setSystemOpenIconUrl(result.dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setSystemOpenIconUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  async function previewWithMode(mode: "head" | "tail" | "outline"): Promise<void> {
    if (!selectedNode || selectedNode.type !== "file") return;
    previewRequestPathRef.current = selectedNode.path;
    setError(null);
    setPreview(null);
    setPreviewState("loading");
    try {
      const nextPreview = await desktopApi.previewWorkspaceFile({
        workspacePath,
        path: selectedNode.path,
        maxBytes: 220_000,
        mode,
      });
      if (previewRequestPathRef.current !== selectedNode.path) return;
      setPreview(nextPreview);
      setPreviewState("idle");
    } catch (caught) {
      if (previewRequestPathRef.current !== selectedNode.path) return;
      setPreview(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      setPreviewState("error");
    }
  }

  async function openSelectedWithSystem(): Promise<void> {
    if (!selectedNode) return;
    const result = await desktopApi.openPath(selectedNode.path);
    if (result) setError(result);
  }

  return (
    <section className="files-context-panel files-preview-only" aria-label="File preview">
      <header className="files-context-header">
        <div className="files-context-title">
          <FileText size={16} />
          <div>
            <strong>{selectedNode?.name || (zh ? "文件预览" : "File preview")}</strong>
            <span>
              {selectedNode?.relativePath ||
                (zh
                  ? "聊天或 Agent 打开文件后在此预览"
                  : "Files opened in chat or by the agent appear here")}
              {!workspaceTrusted ? (zh ? " · 只读" : " · read only") : ""}
            </span>
          </div>
        </div>
        <div className="files-context-toolbar">
          <button type="button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh preview" disabled={!selectedNode}>
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={() => void openSelectedWithSystem()}
            disabled={!selectedNode}
            title={systemOpenLabel}
            aria-label={systemOpenLabel}
          >
            {systemOpenIconUrl ? (
              <img className="files-system-open-icon" src={systemOpenIconUrl} alt="" />
            ) : (
              <SquareArrowOutUpRight size={14} />
            )}
          </button>
          <button
            type="button"
            onClick={() => void previewWithMode("head")}
            disabled={!selectedNode || selectedNode.type !== "file"}
            title="Preview file head"
            aria-label="Preview file head"
          >
            <Rows3 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void previewWithMode("tail")}
            disabled={!selectedNode || selectedNode.type !== "file"}
            title="Preview file tail"
            aria-label="Preview file tail"
          >
            <Rows4 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void previewWithMode("outline")}
            disabled={!selectedNode || selectedNode.type !== "file"}
            title="Preview outline"
            aria-label="Preview outline"
          >
            <FileText size={14} />
          </button>
        </div>
      </header>

      {error ? <p className="files-context-error">{error}</p> : null}

      <div className="files-context-body files-context-body-preview-only">
        <main className="files-context-preview" aria-label="File preview">
          {previewState === "loading" ? (
            <div className="files-preview-empty">
              <FileText size={24} />
              <h3>{zh ? "读取中" : "Loading"}</h3>
              <p>{zh ? "正在加载文件预览。" : "Loading file preview."}</p>
            </div>
          ) : previewState === "error" ? (
            <div className="files-preview-empty">
              <FileText size={24} />
              <h3>{zh ? "预览失败" : "Preview failed"}</h3>
              <p>{error || (zh ? "无法读取该文件。" : "Could not read this file.")}</p>
            </div>
          ) : preview || selectedNode ? (
            <FilePreview language={language} preview={preview} />
          ) : (
            <div className="files-preview-empty">
              <FileText size={24} />
              <h3>{zh ? "文件预览" : "File preview"}</h3>
              <p>
                {zh
                  ? "在聊天中打开文件，或等 Agent 读写文件后，内容会显示在这里。"
                  : "Open a file in chat, or wait for the agent to read/write a file."}
              </p>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function toRelativePath(workspacePath: string, absolutePath: string): string {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normalize(workspacePath).toLowerCase();
  const full = normalize(absolutePath);
  if (full.toLowerCase().startsWith(`${root}/`)) {
    return full.slice(root.length + 1);
  }
  return absolutePath;
}
