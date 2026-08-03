import { useEffect, useState } from "react";
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
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  WorkspaceFileNode,
  WorkspacePreviewKind,
} from "@shared/desktopApi";

export function FilesTree({
  autoExpand = false,
  nodes,
  selectedForContext,
  selectedPath,
  onSelect,
  onToggleContext,
}: {
  autoExpand?: boolean;
  nodes: WorkspaceFileNode[];
  selectedForContext?: Set<string>;
  selectedPath?: string;
  onSelect: (node: WorkspaceFileNode) => void;
  onToggleContext?: (node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedPaths(autoExpand ? collectDirectoryPaths(nodes) : new Set());
  }, [autoExpand, nodes]);

  function toggleExpanded(node: WorkspaceFileNode): void {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }

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
          onSelect={onSelect}
          onToggleExpanded={toggleExpanded}
          onToggleContext={onToggleContext}
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
  onSelect,
  onToggleExpanded,
  onToggleContext,
}: {
  depth: number;
  expandedPaths: Set<string>;
  node: WorkspaceFileNode;
  selectedForContext?: Set<string>;
  selectedPath?: string;
  onSelect: (node: WorkspaceFileNode) => void;
  onToggleExpanded: (node: WorkspaceFileNode) => void;
  onToggleContext?: (node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  const Icon = node.type === "directory" ? Folder : getPreviewIcon(node.previewKind);
  const gitStatus = node.gitStatus && node.gitStatus !== "clean" ? node.gitStatus : null;
  const hasChildren = Boolean(node.children?.length);
  const expanded = node.type === "directory" && expandedPaths.has(node.path);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const showContextToggle = Boolean(onToggleContext);

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
        className={`files-tree-row ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        onClick={handleRowClick}
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
            <Chevron size={14} className="files-tree-chevron" />
          </span>
        ) : (
          <span className="files-tree-spacer" />
        )}
        <Icon size={15} className={`files-type-icon ${node.previewKind ?? "folder"}`} />
        <span className="files-tree-name">{node.name}</span>
        {gitStatus ? <span className={`files-git-dot ${gitStatus}`} /> : null}
      </button>
      {expanded ? node.children?.map((child) => (
        <FilesTreeRow
          key={child.path}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          node={child}
          selectedForContext={selectedForContext}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggleExpanded={onToggleExpanded}
          onToggleContext={onToggleContext}
        />
      )) : null}
    </div>
  );
}

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
