import {
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileType2,
  Folder,
  Loader2,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  WorkspaceFileNode,
  WorkspacePreviewKind,
} from "@shared/desktopApi";

export function FilesTree({
  expandedPaths,
  nodes,
  selectedForContext,
  selectedPath,
  loadingDirs,
  dirErrors,
  onSelect,
  onToggleExpanded,
  onToggleContext,
  onContextMenu,
}: {
  expandedPaths: Set<string>;
  nodes: WorkspaceFileNode[];
  selectedForContext?: Set<string>;
  selectedPath?: string;
  loadingDirs?: Set<string>;
  dirErrors?: Record<string, string>;
  onSelect: (node: WorkspaceFileNode) => void;
  onToggleExpanded: (node: WorkspaceFileNode) => void;
  onToggleContext?: (node: WorkspaceFileNode) => void;
  onContextMenu?: (node: WorkspaceFileNode, x: number, y: number) => void;
}): React.JSX.Element {
  return (
    <div className="files-context-tree">
      {nodes.map((node) => (
        <FilesTreeRow
          key={node.path}
          depth={0}
          expandedPaths={expandedPaths}
          node={node}
          selectedForContext={selectedForContext}
          selectedPath={selectedPath}
          loadingDirs={loadingDirs}
          dirErrors={dirErrors}
          onSelect={onSelect}
          onToggleExpanded={onToggleExpanded}
          onToggleContext={onToggleContext}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function FilesTreeRow({
  depth,
  expandedPaths,
  node,
  selectedForContext,
  selectedPath,
  loadingDirs,
  dirErrors,
  onSelect,
  onToggleExpanded,
  onToggleContext,
  onContextMenu,
}: {
  depth: number;
  expandedPaths: Set<string>;
  node: WorkspaceFileNode;
  selectedForContext?: Set<string>;
  selectedPath?: string;
  loadingDirs?: Set<string>;
  dirErrors?: Record<string, string>;
  onSelect: (node: WorkspaceFileNode) => void;
  onToggleExpanded: (node: WorkspaceFileNode) => void;
  onToggleContext?: (node: WorkspaceFileNode) => void;
  onContextMenu?: (node: WorkspaceFileNode, x: number, y: number) => void;
}): React.JSX.Element {
  const Icon = node.type === "directory" ? Folder : getPreviewIcon(node.previewKind);
  const gitStatus = node.gitStatus && node.gitStatus !== "clean" ? node.gitStatus : null;
  // Use hasChildren when available; fall back to children?.length for older
  // data sources that don't provide the flag.
  const hasChildren = node.hasChildren ?? Boolean(node.children?.length);
  const expanded = node.type === "directory" && expandedPaths.has(node.path);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const showContextToggle = Boolean(onToggleContext);
  const isLoading = loadingDirs?.has(node.path) ?? false;
  const dirError = dirErrors?.[node.path];
  // Show inline states when a directory is expanded:
  // - loading spinner if children are being fetched
  // - error message if fetch failed
  // - empty hint if expanded with no children (and not loading)
  const showLoading = expanded && isLoading;
  const showError = expanded && !isLoading && Boolean(dirError);
  const showEmpty = expanded && !isLoading && !dirError && (!node.children || node.children.length === 0);

  function handleRowClick(): void {
    onSelect(node);
    if (node.type === "directory" && hasChildren) {
      onToggleExpanded(node);
    }
  }

  return (
    <div className="files-tree-branch">
      <button
        type="button"
        className={`files-tree-row ${pathsMatch(selectedPath, node.path) || pathsMatch(selectedPath, node.relativePath) ? "selected" : ""}`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        onClick={handleRowClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.(node, e.clientX, e.clientY);
        }}
        title={node.relativePath}
      >
        {showContextToggle ? (
          <input
            type="checkbox"
            checked={selectedForContext?.has(node.path) ?? false}
            onChange={(event) => {
              event.stopPropagation();
              onToggleContext?.(node);
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${node.name} for context`}
          />
        ) : null}
        {node.type === "directory" ? (
          <span
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className="files-tree-toggle"
            aria-hidden="true"
          >
            {hasChildren ? <Chevron size={14} className="files-tree-chevron" /> : <span className="files-tree-spacer" />}
          </span>
        ) : (
          <span className="files-tree-spacer" />
        )}
        <Icon size={14} className={`files-type-icon ${node.previewKind ?? "folder"}`} />
        <span className="files-tree-name">{node.name}</span>
        {gitStatus ? <span className={`files-git-dot ${gitStatus}`} /> : null}
        {node.truncated ? <span className="files-tree-truncated" title="Not fully loaded" /> : null}
      </button>
      {expanded ? (
        <>
          {showLoading ? (
            <div className="files-tree-dir-status" style={{ paddingLeft: `${10 + (depth + 1) * 16}px` }}>
              <Loader2 size={12} className="files-tree-spinner" />
              <span>Loading...</span>
            </div>
          ) : null}
          {showError ? (
            <div className="files-tree-dir-status files-tree-dir-error" style={{ paddingLeft: `${10 + (depth + 1) * 16}px` }}>
              <span>{dirError}</span>
            </div>
          ) : null}
          {showEmpty ? (
            <div className="files-tree-dir-status files-tree-dir-empty" style={{ paddingLeft: `${10 + (depth + 1) * 16}px` }}>
              <span>Empty</span>
            </div>
          ) : null}
          {node.children?.map((child) => (
            <FilesTreeRow
              key={child.path}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              node={child}
              selectedForContext={selectedForContext}
              selectedPath={selectedPath}
              loadingDirs={loadingDirs}
              dirErrors={dirErrors}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
              onToggleContext={onToggleContext}
              onContextMenu={onContextMenu}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function normalizeTreePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
}

function pathsMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return normalizeTreePath(left) === normalizeTreePath(right);
}

function getPreviewIcon(kind?: WorkspacePreviewKind): LucideIcon {
  if (kind === "code") return Code2;
  if (kind === "html") return FileCode2;
  if (kind === "json") return FileJson;
  if (kind === "table") return Table2;
  if (kind === "image") return FileImage;
  if (kind === "structured" || kind === "config") return Database;
  if (kind === "office" || kind === "pdf") return FileType2;
  if (kind === "media") return FileAudio;
  if (kind === "markdown" || kind === "text") return FileText;
  return File;
}
