import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  RefreshCw,
  Rows3,
  Rows4,
  Search,
  SquareArrowOutUpRight,
} from "lucide-react";
import type {
  WorkspaceContextOverview,
  WorkspaceFileNode,
  WorkspaceFilePreview,
} from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";
import { findWorkspaceNodeByArtifactPath, normalizeWorkspaceArtifactPath } from "./artifactWorkspaceLink";
import { DirectoryContextPreview } from "./DirectoryContextPreview";
import { FilePreview } from "./FilePreview";
import { FilesTree } from "./FilesTree";

interface FilesContextPanelProps {
  focusPath?: string;
  resourcePreview?: WorkspaceFilePreview;
  language: AppLanguage;
  workspaceId: string;
  workspacePath: string;
}

type LoadState = "idle" | "loading" | "error";

export function FilesContextPanel({
  focusPath,
  resourcePreview,
  language,
  workspaceId,
  workspacePath,
}: FilesContextPanelProps): React.JSX.Element {
  const zh = language === "zh";
  const [overview, setOverview] = useState<WorkspaceContextOverview | null>(null);
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<WorkspaceFileNode | null>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [systemOpenIconUrl, setSystemOpenIconUrl] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unavailableFocusPath, setUnavailableFocusPath] = useState<string | null>(null);
  const previewRequestPathRef = useRef<string | null>(null);
  const focusRefreshPathRef = useRef<string | null>(null);

  const systemOpenLabel = selectedNode?.type === "directory"
    ? "Open folder"
    : "Open with system app";
  const selectedRuntimeResource = selectedNode?.path.startsWith("artifact://") === true;

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoadState("loading");
    setError(null);
    try {
      const [nextOverview, fileTree] = await Promise.all([
        desktopApi.getWorkspaceContextOverview(workspacePath, workspaceId),
        desktopApi.listWorkspaceFiles({
          workspacePath,
          workspaceId,
          query,
          maxDepth: query.trim() ? 8 : 5,
          maxEntries: 900,
        }),
      ]);
      setOverview(nextOverview);
      setNodes(fileTree.nodes);
      setNextOffset(fileTree.nextOffset ?? null);
      setLoadState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [query, workspaceId, workspacePath]);

  const loadMore = useCallback(async () => {
    if (!workspacePath || nextOffset === null) return;
    const page = await desktopApi.listWorkspaceFiles({ workspacePath, workspaceId, query, maxDepth: query.trim() ? 8 : 5, maxEntries: 900, offset: nextOffset });
    setNodes((current) => [...current, ...page.nodes]);
    setNextOffset(page.nextOffset ?? null);
  }, [nextOffset, query, workspaceId, workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!focusPath || selectedNode?.path === focusPath || selectedNode?.relativePath === normalizeWorkspaceArtifactPath(focusPath)) return;
    const target = findWorkspaceNodeByArtifactPath(nodes, focusPath);
    if (target) {
      focusRefreshPathRef.current = null;
      setUnavailableFocusPath(null);
      void selectNode(target);
      return;
    }
    // Artifact events can arrive before the filesystem watcher refreshes the
    // tree. Refresh once for this focus request so clicking a result card is
    // deterministic rather than dependent on watcher timing.
    if (focusRefreshPathRef.current !== focusPath) {
      focusRefreshPathRef.current = focusPath;
      setUnavailableFocusPath(null);
      void refresh().then(() => setUnavailableFocusPath(focusPath));
    }
  }, [focusPath, nodes, refresh, selectedNode?.path, selectedNode?.relativePath]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = desktopApi.onWorkspaceFileChanges((event) => {
      if (event.workspacePath !== workspacePath) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    });
    return () => { unsubscribe(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [refresh, workspacePath]);

  useEffect(() => {
    setSelectedNode(null);
    setPreview(null);
    setError(null);
  }, [workspaceId, workspacePath]);

  // This must run after the Workspace-reset effect. A resource click commonly
  // mounts the Files panel and changes its active Workspace in the same render;
  // running this first allowed the reset to erase the just-opened P2 preview.
  useEffect(() => {
    if (!resourcePreview) return;
    setSelectedNode({
      name: resourcePreview.name,
      path: resourcePreview.path,
      relativePath: resourcePreview.relativePath,
      type: "file",
      size: resourcePreview.size,
      modifiedAt: resourcePreview.modifiedAt,
      previewKind: resourcePreview.kind,
    });
    setPreview(resourcePreview);
    setPreviewState("idle");
    setUnavailableFocusPath(null);
    setError(null);
  }, [resourcePreview, workspaceId, workspacePath]);

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

  async function selectNode(node: WorkspaceFileNode): Promise<void> {
    previewRequestPathRef.current = node.path;
    setSelectedNode(node);
    setError(null);
    if (node.type !== "file") {
      setPreview(null);
      setPreviewState("idle");
      return;
    }
    setPreview(null);
    setPreviewState("loading");
    try {
      const nextPreview = await desktopApi.previewWorkspaceFile({
        workspacePath,
        workspaceId,
        path: node.path,
        maxBytes: 220_000,
      });
      if (previewRequestPathRef.current !== node.path) return;
      setPreview(nextPreview);
      setPreviewState("idle");
    } catch (caught) {
      if (previewRequestPathRef.current !== node.path) return;
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

  async function previewWithMode(mode: "head" | "tail" | "outline"): Promise<void> {
    if (!selectedNode || selectedNode.type !== "file") return;
    previewRequestPathRef.current = selectedNode.path;
    setError(null);
    setPreview(null);
    setPreviewState("loading");
    try {
      const nextPreview = await desktopApi.previewWorkspaceFile({
        workspacePath,
        workspaceId,
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

  return (
    <section className="files-context-panel files-preview-only" aria-label="Files preview">
      <header className="files-context-header">
        <div className="files-context-title">
          <FileText size={16} />
          <div>
            <strong>{selectedNode?.name || (zh ? "文件" : "Files")}</strong>
            <span>
              {overview?.git?.branch || "workspace"}
            </span>
          </div>
        </div>
        <div className="files-context-toolbar">
          <label className="files-context-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={zh ? "筛选..." : "Filter..."}
              aria-label={zh ? "筛选文件" : "Filter files"}
            />
          </label>
          <button type="button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh files">
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={() => void openSelectedWithSystem()}
            disabled={!selectedNode || selectedRuntimeResource}
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
            disabled={!selectedNode || selectedNode.type !== "file" || selectedRuntimeResource}
            title="Preview file head"
            aria-label="Preview file head"
          >
            <Rows3 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void previewWithMode("tail")}
            disabled={!selectedNode || selectedNode.type !== "file" || selectedRuntimeResource}
            title="Preview file tail"
            aria-label="Preview file tail"
          >
            <Rows4 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void previewWithMode("outline")}
            disabled={!selectedNode || selectedNode.type !== "file" || selectedRuntimeResource}
            title="Preview outline"
            aria-label="Preview outline"
          >
            <FileText size={14} />
          </button>
        </div>
      </header>

      {error ? <p className="files-context-error">{error}</p> : null}
      {unavailableFocusPath === focusPath && !findWorkspaceNodeByArtifactPath(nodes, focusPath || "") ? (
        <p className="files-context-error" role="status" data-testid="artifact-unavailable">
          {zh ? "成果文件已移动、删除或暂时不可用。可刷新工作区后重试。" : "The result file was moved, deleted, or is temporarily unavailable. Refresh the workspace and try again."}
        </p>
      ) : null}

      <div className="files-context-body">
        <main className="files-context-preview" aria-label="File preview">
          {!selectedNode ? (
            <div className="files-context-empty-state">
              <FileText size={24} />
              <h3>{zh ? "选择文件以预览" : "Select a file to preview"}</h3>
              <p>{zh ? "从右侧文件树选择文件或文件夹。" : "Pick a file or folder from the tree."}</p>
            </div>
          ) : loadState === "loading" && !preview ? (
            <div className="files-context-empty-state">
              <FileText size={24} />
              <h3>{zh ? "正在加载预览..." : "Loading preview..."}</h3>
            </div>
          ) : error && !preview ? (
            <div className="files-context-empty-state">
              <FileText size={24} />
              <h3>{zh ? "预览失败" : "Preview failed"}</h3>
              <p>{error || (zh ? "无法读取该文件。" : "Could not read this file.")}</p>
            </div>
          ) : selectedNode.type === "directory" ? (
            <DirectoryContextPreview
              files={collectFileNodes(selectedNode)}
              language={language}
              node={selectedNode}
            />
          ) : (
            <FilePreview language={language} preview={preview} />
          )}
        </main>

        <aside className="files-context-tree-pane" aria-label="Workspace file tree">
          {nodes.length === 0 ? (
            <p className="files-context-empty">
              {loadState === "loading"
                ? zh ? "正在读取文件..." : "Loading files..."
                : zh ? "没有可显示的文件。" : "No files to show."}
            </p>
          ) : (
            <FilesTree
              autoExpand={Boolean(query.trim())}
              nodes={nodes}
              selectedPath={selectedNode?.path}
              onSelect={(node) => void selectNode(node)}
            />
          )}
          {nextOffset !== null ? <button type="button" className="files-context-load-more" onClick={() => void loadMore()}>{zh ? "加载更多" : "Load more"}</button> : null}
        </aside>
      </div>
    </section>
  );
}

function collectFileNodes(node: WorkspaceFileNode): WorkspaceFileNode[] {
  if (node.type === "file") return [node];
  return (node.children ?? []).flatMap((child) => collectFileNodes(child));
}
