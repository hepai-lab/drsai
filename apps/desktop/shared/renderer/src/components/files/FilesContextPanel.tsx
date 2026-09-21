import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
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
import { loadWorkspacePreview } from "../../workspacePreview";
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
  onFocusPathConsumed?: () => void;
  onClearResourcePreview?: () => void;
}

type LoadState = "idle" | "loading" | "error";

const FILES_TREE_DEFAULT_WIDTH = 260;
const FILES_TREE_MIN_WIDTH = 160;
const FILES_TREE_COLLAPSE_WIDTH = 120;
const FILES_TREE_MAX_RATIO = 0.78;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalized = normalizeWorkspaceArtifactPath(path);
  const root = normalizeWorkspaceArtifactPath(workspacePath);
  if (!root) return normalized;
  const rootPrefix = `${root}/`.toLowerCase();
  if (normalized.toLowerCase().startsWith(rootPrefix)) {
    return normalized.slice(root.length + 1);
  }
  if (normalized.toLowerCase() === root.toLowerCase()) return "";
  return normalized;
}

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
  onFocusPathConsumed,
  onClearResourcePreview,
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
  const [treeWidth, setTreeWidth] = useState(FILES_TREE_DEFAULT_WIDTH);
  const [treePaneCollapsed, setTreePaneCollapsed] = useState(false);
  const [treeResizing, setTreeResizing] = useState(false);
  const previewRequestPathRef = useRef<string | null>(null);
  const focusRefreshPathRef = useRef<string | null>(null);
  const appliedFocusPathRef = useRef<string | null>(null);
  const revealingFocusPathRef = useRef<string | null>(null);
  const treePaneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const treeWidthBeforeCollapseRef = useRef(FILES_TREE_DEFAULT_WIDTH);
  const nodesRef = useRef<WorkspaceFileNode[]>([]);
  nodesRef.current = nodes;

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
  const loadDirectoryChildren = useCallback(async (node: WorkspaceFileNode): Promise<WorkspaceFileNode[]> => {
    if (dirLoadedRef.current.has(node.path)) {
      return findNodeByPath(nodesRef.current, node.path)?.children ?? node.children ?? [];
    }
    // Wait out an in-flight load for the same directory (e.g. focus walk + click).
    if (dirLoadingRef.current.has(node.path)) {
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        if (dirLoadedRef.current.has(node.path)) {
          return findNodeByPath(nodesRef.current, node.path)?.children ?? node.children ?? [];
        }
        if (!dirLoadingRef.current.has(node.path)) break;
      }
    }
    if (dirLoadedRef.current.has(node.path)) {
      return findNodeByPath(nodesRef.current, node.path)?.children ?? node.children ?? [];
    }
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
      setNodes((current) => {
        const next = replaceNodeChildren(current, node.path, result.nodes);
        nodesRef.current = next;
        return next;
      });
      forceExpandRender((n) => n + 1);
      return result.nodes;
    } catch (caught) {
      dirLoadingRef.current.delete(node.path);
      const msg = caught instanceof Error ? caught.message : String(caught);
      setDirErrors((prev) => ({ ...prev, [node.path]: msg }));
      forceExpandRender((n) => n + 1);
      return [];
    }
  }, [findNodeByPath, replaceNodeChildren, workspaceId, workspacePath]);

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

  /** Expand + lazy-load ancestors so a nested artifact path becomes visible in the tree. */
  const revealPathInTree = useCallback(async (path: string): Promise<WorkspaceFileNode | null> => {
    const relative = toWorkspaceRelativePath(path, workspacePath);
    const segments = normalizeWorkspaceArtifactPath(relative).split("/").filter(Boolean);
    let level = nodesRef.current;

    for (let index = 0; index < Math.max(0, segments.length - 1); index += 1) {
      const segment = segments[index];
      const dir = level.find((node) =>
        node.type === "directory"
        && normalizeWorkspaceArtifactPath(node.name).toLowerCase() === segment.toLowerCase()
      );
      if (!dir) break;
      expandedPathsRef.current = new Set(expandedPathsRef.current).add(dir.path);
      forceExpandRender((n) => n + 1);
      const children = await loadDirectoryChildren(dir);
      level = children.length
        ? children
        : (findNodeByPath(nodesRef.current, dir.path)?.children ?? []);
    }

    const found = findWorkspaceNodeByArtifactPath(nodesRef.current, path)
      ?? findWorkspaceNodeByArtifactPath(nodesRef.current, relative);
    if (!found) return null;

    // Ensure every ancestor directory stays expanded after the node is found.
    const foundRel = normalizeWorkspaceArtifactPath(found.relativePath || relative);
    const ancestorSegs = foundRel.split("/").filter(Boolean).slice(0, -1);
    let walk = nodesRef.current;
    for (const segment of ancestorSegs) {
      const dir = walk.find((node) =>
        node.type === "directory"
        && normalizeWorkspaceArtifactPath(node.name).toLowerCase() === segment.toLowerCase()
      );
      if (!dir) break;
      expandedPathsRef.current = new Set(expandedPathsRef.current).add(dir.path);
      walk = dir.children ?? [];
    }
    forceExpandRender((n) => n + 1);
    return found;
  }, [findNodeByPath, loadDirectoryChildren, workspacePath]);

  function scrollSelectedTreeRowIntoView(): void {
    window.requestAnimationFrame(() => {
      treePaneRef.current?.querySelector<HTMLElement>(".files-tree-row.selected")?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
  }

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
    if (!focusPath) {
      appliedFocusPathRef.current = null;
      revealingFocusPathRef.current = null;
      return;
    }
    // One-shot: apply each external focus request once, then let the user
    // browse freely without being yanked back to the artifact.
    if (appliedFocusPathRef.current === focusPath) return;

    let cancelled = false;
    revealingFocusPathRef.current = focusPath;
    setTreePaneCollapsed(false);
    setUnavailableFocusPath(null);

    void (async () => {
      // Wait for the initial tree page before walking nested directories.
      for (let i = 0; i < 40 && nodesRef.current.length === 0; i += 1) {
        if (cancelled) return;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (cancelled) return;

      async function applyTarget(target: WorkspaceFileNode): Promise<void> {
        appliedFocusPathRef.current = focusPath!;
        revealingFocusPathRef.current = null;
        focusRefreshPathRef.current = null;
        setUnavailableFocusPath(null);
        previewRequestPathRef.current = target.path;
        setSelectedNode(target);
        setError(null);
        const previewMatchesTarget = Boolean(
          resourcePreview
          && (
            normalizeWorkspaceArtifactPath(resourcePreview.path) === normalizeWorkspaceArtifactPath(target.path)
            || normalizeWorkspaceArtifactPath(resourcePreview.relativePath) === normalizeWorkspaceArtifactPath(target.relativePath)
            || normalizeWorkspaceArtifactPath(resourcePreview.relativePath) === normalizeWorkspaceArtifactPath(focusPath!)
          ),
        );
        if (previewMatchesTarget && resourcePreview) {
          setPreview(resourcePreview);
          setPreviewState("idle");
        } else if (target.type === "file") {
          void selectNode(target);
        } else {
          setPreview(null);
          setPreviewState("idle");
        }
        scrollSelectedTreeRowIntoView();
        window.setTimeout(() => scrollSelectedTreeRowIntoView(), 80);
        onFocusPathConsumed?.();
      }

      const target = await revealPathInTree(focusPath);
      if (cancelled) return;
      if (target) {
        await applyTarget(target);
        return;
      }

      // One deep lookup can still help when the file was just written.
      if (focusRefreshPathRef.current === focusPath) {
        revealingFocusPathRef.current = null;
        setUnavailableFocusPath(focusPath);
        return;
      }
      focusRefreshPathRef.current = focusPath;
      try {
        const leaf = normalizeWorkspaceArtifactPath(focusPath).split("/").filter(Boolean).at(-1);
        const deep = await desktopApi.listWorkspaceFiles({
          workspacePath,
          workspaceId,
          query: leaf,
          maxDepth: 8,
          maxEntries: 900,
        });
        if (cancelled) return;
        setNodes((current) => {
          const next = mergeTreeNodes(current, deep.nodes);
          nodesRef.current = next;
          return next;
        });
        expandedPathsRef.current = new Set([
          ...expandedPathsRef.current,
          ...collectDirectoryPaths(deep.nodes),
        ]);
        dirLoadedRef.current = new Set([
          ...dirLoadedRef.current,
          ...collectDirectoryPaths(deep.nodes),
        ]);
        forceExpandRender((n) => n + 1);
        const retry = await revealPathInTree(focusPath);
        if (cancelled) return;
        if (!retry) {
          revealingFocusPathRef.current = null;
          setUnavailableFocusPath(focusPath);
          return;
        }
        await applyTarget(retry);
      } catch {
        if (!cancelled) {
          revealingFocusPathRef.current = null;
          setUnavailableFocusPath(focusPath);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusPath, onFocusPathConsumed, resourcePreview, revealPathInTree, workspaceId, workspacePath]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = desktopApi.onWorkspaceFileChanges((event) => {
      if (event.workspacePath !== workspacePath) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    });
    return () => { unsubscribe(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [refresh, workspacePath]);

  // Reset state when the workspace changes so the tree does not keep showing
  // the previous workspace while the new listing loads.
  useEffect(() => {
    appliedFocusPathRef.current = null;
    focusRefreshPathRef.current = null;
    revealingFocusPathRef.current = null;
    previewRequestPathRef.current = null;
    setSelectedNode(null);
    setPreview(null);
    setPreviewState("idle");
    setOverview(null);
    setNodes([]);
    setNextOffset(null);
    setTruncated(false);
    setLoadState("loading");
    setError(null);
    setUnavailableFocusPath(null);
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
      const nextPreview = await loadWorkspacePreview(
        {
          workspacePath,
          workspaceId,
          path: node.path,
          // Images need the full file; gateway/text defaults (~220KB) truncate
          // JPEG/PNG payloads and only the top of the picture decodes.
          maxBytes: node.previewKind === "image" ? 8_000_000 : 220_000,
        },
        // The user picked this file on purpose, and the tree is refreshed by a
        // watcher: never answer from the `missing` cache, a restored file would
        // keep reading as deleted. A `missing` preview still renders as such.
        { cacheMissing: false },
      );
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
      const nextPreview = await loadWorkspacePreview(
        {
          workspacePath,
          workspaceId,
          path: selectedNode.path,
          maxBytes: selectedNode.previewKind === "image" ? 8_000_000 : 220_000,
          mode,
        },
        { cacheMissing: false },
      );
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

  function toggleTreePane(): void {
    setTreePaneCollapsed((collapsed) => {
      if (!collapsed) {
        treeWidthBeforeCollapseRef.current = treeWidth;
        return true;
      }
      setTreeWidth(clamp(treeWidthBeforeCollapseRef.current, FILES_TREE_MIN_WIDTH, 720));
      return false;
    });
  }

  function startTreePaneResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const body = bodyRef.current;
    const handle = event.currentTarget;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    if (rect.width <= 0) return;
    const maxWidth = Math.max(FILES_TREE_MIN_WIDTH, Math.floor(rect.width * FILES_TREE_MAX_RATIO));
    const startWidth = treeWidth;
    let collapseRequested = false;
    setTreeResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("is-panel-resizing");
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Some hosts reject capture; window listeners below still help.
    }

    function handlePointerMove(moveEvent: PointerEvent): void {
      const nextWidth = rect.right - moveEvent.clientX;
      if (nextWidth < FILES_TREE_COLLAPSE_WIDTH) {
        if (!collapseRequested) {
          collapseRequested = true;
          treeWidthBeforeCollapseRef.current = startWidth;
          setTreePaneCollapsed(true);
        }
        return;
      }
      if (collapseRequested) {
        collapseRequested = false;
        setTreePaneCollapsed(false);
      }
      setTreeWidth(clamp(nextWidth, FILES_TREE_MIN_WIDTH, maxWidth));
    }

    function cleanup(): void {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.body.classList.remove("is-panel-resizing");
      setTreeResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      try {
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore release errors after the handle unmounts.
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
  }

  const treeToggleLabel = treePaneCollapsed
    ? (zh ? "展开文件树" : "Show file tree")
    : (zh ? "收起文件树" : "Hide file tree");

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
          <button
            type="button"
            onClick={() => void refresh()}
            title="Refresh"
            aria-label="Refresh files"
            disabled={loadState === "loading"}
          >
            <RefreshCw size={14} className={loadState === "loading" ? "files-context-spin" : undefined} />
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
          <button
            type="button"
            onClick={toggleTreePane}
            title={treeToggleLabel}
            aria-label={treeToggleLabel}
            aria-pressed={!treePaneCollapsed}
          >
            {treePaneCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
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
        ref={bodyRef}
        className={`files-context-body${treePaneCollapsed ? " tree-collapsed" : ""}${treeResizing ? " is-resizing" : ""}`}
        style={treePaneCollapsed ? undefined : { "--files-tree-width": `${treeWidth}px` } as React.CSSProperties}
      >
        <main className="files-context-preview" aria-label="File preview" aria-busy={previewState === "loading"}>
          {!selectedNode ? (
            <div className="files-context-empty-state">
              <FileText size={24} />
              <h3>{zh ? "选择文件以预览" : "Select a file to preview"}</h3>
              <p>{zh ? "从右侧文件树选择文件或文件夹。" : "Pick a file or folder from the tree."}</p>
            </div>
          ) : previewState === "loading" ? (
            <div className="files-context-empty-state files-context-loading-state" role="status">
              <Loader2 size={24} className="files-context-spin" aria-hidden />
              <h3>{zh ? "正在切换文件..." : "Switching file..."}</h3>
              <p>{selectedNode.name}</p>
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

        {!treePaneCollapsed ? (
          <>
            <div
              className="files-context-splitter"
              role="separator"
              aria-label={zh ? "调整预览区和文件树宽度" : "Resize preview and file tree"}
              aria-orientation="vertical"
              aria-valuenow={Math.round(treeWidth)}
              aria-valuemin={FILES_TREE_MIN_WIDTH}
              title={zh ? "拖拽调整文件树宽度" : "Drag to resize file tree"}
              onPointerDown={startTreePaneResize}
            />

            <aside
              className={`files-context-tree-pane${loadState === "loading" ? " is-loading" : ""}`}
              aria-label="Workspace file tree"
              aria-busy={loadState === "loading"}
            >
              {loadState === "loading" && nodes.length === 0 ? (
                <div className="files-context-tree-loading" role="status">
                  <Loader2 size={18} className="files-context-spin" aria-hidden />
                  <span>{zh ? "正在切换工作区..." : "Switching workspace..."}</span>
                </div>
              ) : nodes.length === 0 ? (
                <p className="files-context-empty">
                  {zh ? "没有可显示的文件。" : "No files to show."}
                </p>
              ) : (
                <div className="files-context-tree-scroll" ref={treePaneRef} onScroll={handleTreeScroll}>
                  <FilesTree
                    expandedPaths={expandedPathsRef.current}
                    nodes={nodes}
                    selectedPath={selectedNode?.path}
                    loadingDirs={dirLoadingRef.current}
                    dirErrors={dirErrors}
                    onSelect={(node) => {
                      onClearResourcePreview?.();
                      void selectNode(node);
                    }}
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
              {loadState === "loading" && nodes.length > 0 ? (
                <div className="files-context-tree-loading-overlay" role="status">
                  <Loader2 size={16} className="files-context-spin" aria-hidden />
                  <span>{zh ? "正在刷新文件树..." : "Refreshing file tree..."}</span>
                </div>
              ) : null}
            </aside>
          </>
        ) : null}
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
