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
import { FilesTreeContextMenu, type ContextMenuState } from "./FilesTreeContextMenu";

interface FilesContextPanelProps {
  focusPath?: string;
  resourcePreview?: WorkspaceFilePreview;
  language: AppLanguage;
  workspaceId: string;
  workspacePath: string;
}

type LoadState = "idle" | "loading" | "error";

/** Merge a page of nodes into an existing tree, deduplicating by path. */
function mergeTreeNodes(existing: WorkspaceFileNode[], incoming: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const byPath = new Map<string, WorkspaceFileNode>();
  const roots: WorkspaceFileNode[] = [];

  const ensureDir = (node: WorkspaceFileNode): WorkspaceFileNode => {
    const cached = byPath.get(node.path);
    if (cached) return cached;
    const merged: WorkspaceFileNode = { ...node, children: [...(node.children ?? [])] };
    byPath.set(node.path, merged);
    return merged;
  };

  // First pass: register all existing nodes.
  for (const node of existing) {
    const dir = ensureDir(node);
    dir.children = node.children ? [...node.children] : undefined;
    roots.push(dir);
  }

  // Second pass: merge incoming nodes into the tree.
  for (const node of incoming) {
    const cached = byPath.get(node.path);
    if (cached) {
      // Update metadata, keep existing children if incoming has none.
      if (node.children?.length) {
        cached.children = mergeTreeNodes(cached.children ?? [], node.children);
      }
      cached.hasChildren = node.hasChildren ?? cached.hasChildren;
      cached.gitStatus = node.gitStatus ?? cached.gitStatus;
      cached.truncated = node.truncated ?? cached.truncated;
    } else {
      // New node — find its parent directory in the tree.
      const parentRel = node.relativePath.includes("/")
        ? node.relativePath.slice(0, node.relativePath.lastIndexOf("/"))
        : "";
      if (parentRel) {
        const parentAbs = node.path.slice(0, node.path.length - node.name.length - 1);
        const parent = byPath.get(parentAbs);
        if (parent) {
          parent.children = [...(parent.children ?? []), node];
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
      byPath.set(node.path, node);
    }
  }

  // Sort roots for consistent ordering.
  roots.sort((a, b) =>
    (a.type === "directory" && b.type !== "directory" ? -1
      : a.type !== "directory" && b.type === "directory" ? 1 : 0)
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return roots;
}

/** Collect all directory paths in a tree (for auto-expand during search). */
function collectDirectoryPaths(nodes: WorkspaceFileNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.type !== "directory") continue;
    paths.add(node.path);
    for (const childPath of collectDirectoryPaths(node.children ?? [])) {
      paths.add(childPath);
    }
  }
  return paths;
}

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
  const [truncated, setTruncated] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [loadMoreState, setLoadMoreState] = useState<LoadState>("idle");
  const previewRequestPathRef = useRef<string | null>(null);
  const focusRefreshPathRef = useRef<string | null>(null);
  const treePaneRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startX: number; startTreeWidth: number } | null>(null);
  const [treeWidth, setTreeWidth] = useState(260);

  const startSplitDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDragRef.current = { startX: event.clientX, startTreeWidth: treeWidth };
  }, [treeWidth]);

  const moveSplitDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag) return;
    const nextWidth = Math.max(160, Math.min(520, drag.startTreeWidth - (event.clientX - drag.startX)));
    setTreeWidth(nextWidth);
  }, []);

  const endSplitDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return;
    splitDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  // Expanded paths are managed here (not in FilesTree) so they persist across
  // refreshes and file-watch events.  Reset only when the workspace changes.
  const expandedPathsRef = useRef<Set<string>>(new Set());
  // Per-directory lazy-loading state: track which directories have been
  // fetched, are currently loading, or failed — so we only fetch once and
  // can show inline loading/error indicators.
  const dirLoadedRef = useRef<Set<string>>(new Set());
  const dirLoadingRef = useRef<Set<string>>(new Set());
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [, forceExpandRender] = useState(0);

  /** Find a node by its absolute path anywhere in the tree. */
  const findNodeByPath = useCallback((nodes: WorkspaceFileNode[], path: string): WorkspaceFileNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findNodeByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }, []);

  /** Replace a node's children in the tree (immutably) by path. */
  const replaceNodeChildren = useCallback((nodes: WorkspaceFileNode[], path: string, children: WorkspaceFileNode[] | undefined): WorkspaceFileNode[] => {
    return nodes.map((node) => {
      if (node.path === path) {
        return { ...node, children, hasChildren: children ? children.length > 0 : node.hasChildren };
      }
      if (node.children) {
        return { ...node, children: replaceNodeChildren(node.children, path, children) };
      }
      return node;
    });
  }, []);

  /** Lazy-load a directory's direct children from the backend. */
  const loadDirectoryChildren = useCallback(async (node: WorkspaceFileNode): Promise<void> => {
    // Skip if already loaded or currently loading.
    if (dirLoadedRef.current.has(node.path) || dirLoadingRef.current.has(node.path)) return;
    dirLoadingRef.current.add(node.path);
    setDirErrors((prev) => { const next = { ...prev }; delete next[node.path]; return next; });
    forceExpandRender((n) => n + 1);
    try {
      const result = await desktopApi.listWorkspaceFiles({
        workspacePath,
        workspaceId,
        directoryPath: node.path,
        maxDepth: 1,
        maxEntries: 500,
      });
      dirLoadedRef.current.add(node.path);
      dirLoadingRef.current.delete(node.path);
      // Merge children into the tree.
      setNodes((current) => replaceNodeChildren(current, node.path, result.nodes));
      forceExpandRender((n) => n + 1);
    } catch (caught) {
      dirLoadingRef.current.delete(node.path);
      const msg = caught instanceof Error ? caught.message : String(caught);
      setDirErrors((prev) => ({ ...prev, [node.path]: msg }));
      forceExpandRender((n) => n + 1);
    }
  }, [replaceNodeChildren, workspaceId, workspacePath]);

  const toggleExpanded = useCallback((node: WorkspaceFileNode) => {
    const current = expandedPathsRef.current;
    const next = new Set(current);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
      // Trigger lazy load on first expansion (only if not already loaded/loading).
      if (!dirLoadedRef.current.has(node.path) && !dirLoadingRef.current.has(node.path)) {
        void loadDirectoryChildren(node);
      }
    }
    expandedPathsRef.current = next;
    forceExpandRender((n) => n + 1);
  }, [loadDirectoryChildren]);

  const systemOpenLabel = selectedNode?.type === "directory"
    ? (zh ? "打开文件夹" : "Open folder")
    : (zh ? "用系统应用打开" : "Open with system app");
  const selectedRuntimeResource = selectedNode?.path.startsWith("artifact://") === true;

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoadState("loading");
    setError(null);
    // Clear per-directory cache so expansions re-fetch after refresh.
    dirLoadedRef.current = new Set();
    dirLoadingRef.current = new Set();
    setDirErrors({});
    try {
      const isSearch = query.trim().length > 0;
      const [nextOverview, fileTree] = await Promise.all([
        desktopApi.getWorkspaceContextOverview(workspacePath, workspaceId),
        desktopApi.listWorkspaceFiles({
          workspacePath,
          workspaceId,
          query: isSearch ? query : undefined,
          // Lazy loading: initial load fetches only root's direct children.
          // Search mode uses deeper traversal to find matches across the tree.
          maxDepth: isSearch ? 8 : 1,
          maxEntries: isSearch ? 900 : 500,
        }),
      ]);
      setOverview(nextOverview);
      // When searching, auto-expand all directory paths so matches are visible.
      if (isSearch) {
        expandedPathsRef.current = collectDirectoryPaths(fileTree.nodes);
        // In search mode, all directories are considered "loaded" since the
        // deep traversal already populated their children.
        dirLoadedRef.current = collectDirectoryPaths(fileTree.nodes);
      } else {
        // In browse mode, mark root-level directories as "loaded" since
        // maxDepth:1 already fetched their direct children.
        for (const node of fileTree.nodes) {
          if (node.type === "directory" && node.children?.length) {
            dirLoadedRef.current.add(node.path);
          }
        }
      }
      setNodes(fileTree.nodes);
      setNextOffset(fileTree.nextOffset ?? null);
      setTruncated(fileTree.truncated);
      setLoadState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [query, workspaceId, workspacePath]);

  const loadMore = useCallback(async () => {
    if (!workspacePath || nextOffset === null || loadMoreState === "loading") return;
    // loadMore is only used in search mode (deep traversal with pagination).
    // In browse mode, each directory is loaded independently via loadDirectoryChildren.
    const isSearch = query.trim().length > 0;
    if (!isSearch) return;
    setLoadMoreState("loading");
    try {
      const page = await desktopApi.listWorkspaceFiles({ workspacePath, workspaceId, query, maxDepth: 8, maxEntries: 900, offset: nextOffset });
      setNodes((current) => mergeTreeNodes(current, page.nodes));
      setNextOffset(page.nextOffset ?? null);
      setTruncated(page.truncated);
      setLoadMoreState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadMoreState("error");
    }
  }, [loadMoreState, nextOffset, query, workspaceId, workspacePath]);

  // Infinite scroll: auto-load more entries when the user scrolls near the bottom.
  const handleTreeScroll = useCallback(() => {
    const el = treePaneRef.current;
    if (!el || nextOffset === null || loadMoreState === "loading") return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 80) {
      void loadMore();
    }
  }, [loadMore, loadMoreState, nextOffset]);

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

  // Reset state when the workspace changes.
  useEffect(() => {
    setSelectedNode(null);
    setPreview(null);
    setError(null);
    expandedPathsRef.current = new Set();
    dirLoadedRef.current = new Set();
    dirLoadingRef.current = new Set();
    setDirErrors({});
    forceExpandRender((n) => n + 1);
  }, [workspaceId, workspacePath]);

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

  const handleContextAction = useCallback(async (actionId: string, node: WorkspaceFileNode) => {
    setContextMenu(null);
    try {
      switch (actionId) {
        case "copy-path":
          await desktopApi.copyTextToClipboard(node.path);
          break;
        case "copy-relative-path":
          await desktopApi.copyTextToClipboard(node.relativePath);
          break;
        case "copy-name":
          await desktopApi.copyTextToClipboard(node.name);
          break;
        case "open-in-explorer": {
          // For directories, open the directory itself; for files, open the parent.
          const targetPath = node.type === "directory"
            ? node.path
            : node.path.slice(0, node.path.length - node.name.length - 1);
          const openResult = await desktopApi.openPath(targetPath);
          if (openResult) setError(openResult);
          break;
        }
        case "open-with-system": {
          const openResult = await desktopApi.openPath(node.path);
          if (openResult) setError(openResult);
          break;
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

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

      <div
        className="files-context-body"
        style={{ "--files-tree-width": `${treeWidth}px` } as React.CSSProperties}
      >
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

        <div
          className="files-context-splitter"
          role="separator"
          aria-label={zh ? "调整预览区和文件树宽度" : "Resize preview and file tree"}
          aria-orientation="vertical"
          onPointerDown={startSplitDrag}
          onPointerMove={moveSplitDrag}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
        />

        <aside className="files-context-tree-pane" aria-label="Workspace file tree">
          {nodes.length === 0 ? (
            <p className="files-context-empty">
              {loadState === "loading"
                ? zh ? "正在读取文件..." : "Loading files..."
                : zh ? "没有可显示的文件。" : "No files to show."}
            </p>
          ) : (
            <div className="files-context-tree-scroll" ref={treePaneRef} onScroll={handleTreeScroll}>
              <FilesTree
                expandedPaths={expandedPathsRef.current}
                nodes={nodes}
                selectedPath={selectedNode?.path}
                loadingDirs={dirLoadingRef.current}
                dirErrors={dirErrors}
                onSelect={(node) => void selectNode(node)}
                onToggleExpanded={toggleExpanded}
                onContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
              />
              {loadMoreState === "loading" ? (
                <div className="files-context-tree-loading-more">
                  {zh ? "加载中..." : "Loading..."}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
      {contextMenu ? (
        <FilesTreeContextMenu
          state={contextMenu}
          zh={zh}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      ) : null}
    </section>
  );

  function collectFileNodes(node: WorkspaceFileNode): WorkspaceFileNode[] {
    if (node.type === "file") return [node];
    return (node.children ?? []).flatMap((child) => collectFileNodes(child));
  }
}
