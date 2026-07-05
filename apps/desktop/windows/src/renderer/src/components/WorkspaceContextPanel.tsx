import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Code2,
  Database,
  File,
  FileImage,
  FileJson,
  FileText,
  Folder,
  GitCompare,
  ListPlus,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ChatAttachment,
  WorkspaceContextOverview,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceGitDiffResult,
  WorkspacePreviewKind,
} from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

interface WorkspaceContextPanelProps {
  basket: ChatAttachment[];
  language: AppLanguage;
  workspacePath: string;
  workspaceTrusted: boolean;
  onBasketChange: (attachments: ChatAttachment[]) => void;
  onInsertPath: (path: string) => void;
  onPreviewFile: (preview: WorkspaceFilePreview | null) => void;
}

type LoadState = "idle" | "loading" | "error";

export function WorkspaceContextPanel({
  basket,
  language,
  workspacePath,
  workspaceTrusted,
  onBasketChange,
  onInsertPath,
  onPreviewFile,
}: WorkspaceContextPanelProps): React.JSX.Element {
  const zh = language === "zh";
  const [overview, setOverview] = useState<WorkspaceContextOverview | null>(null);
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<WorkspaceFileNode | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedInBasket = selectedNode
    ? basket.some((item) => item.path === selectedNode.path)
    : false;

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoadState("loading");
    setError(null);
    try {
      const [nextOverview, fileTree] = await Promise.all([
        desktopApi.getWorkspaceContextOverview(workspacePath),
        desktopApi.listWorkspaceFiles({
          workspacePath,
          query,
          maxDepth: query.trim() ? 8 : 5,
          maxEntries: 900,
        }),
      ]);
      setOverview(nextOverview);
      setNodes(fileTree.nodes);
      setLoadState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [query, workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedNode(null);
    onPreviewFile(null);
  }, [onPreviewFile, workspacePath]);

  async function selectNode(node: WorkspaceFileNode): Promise<void> {
    setSelectedNode(node);
    if (node.type !== "file") return;
    try {
      const preview = await desktopApi.previewWorkspaceFile({
        workspacePath,
        path: node.path,
        maxBytes: 220_000,
      });
      onPreviewFile(preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function addSelectedFile(): void {
    if (!selectedNode || selectedNode.type !== "file" || selectedInBasket) return;
    onBasketChange([
      ...basket,
      {
        kind: "file",
        path: selectedNode.path,
        name: selectedNode.relativePath,
        note: `Selected from Files panel. Preview kind: ${selectedNode.previewKind ?? "unknown"}.`,
      },
    ]);
  }

  async function attachSelectedDiff(): Promise<void> {
    if (!selectedNode) return;
    const diff = await desktopApi.getWorkspaceGitDiff({
      workspacePath,
      path: selectedNode.relativePath,
      maxChars: 60_000,
    });
    addDiffToBasket(diff, basket, workspacePath, onBasketChange);
  }

  const changedCount = overview?.stats.changedFileCount ?? 0;
  const instructionCount = overview?.stats.instructionCount ?? 0;

  return (
    <section className="files-sidebar-panel" aria-label="Workspace files">
      <div className="files-panel-actions">
        <button
          type="button"
          className="files-open-button"
          onClick={() => selectedNode && onInsertPath(selectedNode.path)}
          disabled={!selectedNode}
          title={zh ? "插入当前路径" : "Insert current path"}
        >
          <Folder size={15} />
          <span>{zh ? "打开" : "Open"}</span>
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className="files-icon-button"
          onClick={() => void refresh()}
          title={zh ? "刷新" : "Refresh"}
          aria-label={zh ? "刷新文件" : "Refresh files"}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <label className="files-filter">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={zh ? "筛选文件..." : "Filter files..."}
          aria-label={zh ? "筛选文件" : "Filter files"}
        />
      </label>

      <div className="files-tree-scroll">
        {error ? <p className="files-panel-error">{error}</p> : null}
        {nodes.length === 0 ? (
          <p className="files-panel-empty">
            {loadState === "loading"
              ? zh ? "正在读取文件..." : "Loading files..."
              : zh ? "没有可显示的文件。" : "No files to show."}
          </p>
        ) : (
          nodes.map((node) => (
            <FileTreeNode
              key={node.path}
              depth={0}
              node={node}
              selectedPath={selectedNode?.path}
              onSelect={(nextNode) => void selectNode(nextNode)}
            />
          ))
        )}
      </div>

      <footer className="files-panel-footer">
        <div className="files-context-summary">
          <span>{overview?.git?.branch || "workspace"}</span>
          <small>
            {changedCount} changed · {instructionCount} instructions
            {!workspaceTrusted ? " · read only" : ""}
          </small>
        </div>
        <div className="files-context-actions">
          <button
            type="button"
            onClick={addSelectedFile}
            disabled={!selectedNode || selectedNode.type !== "file" || selectedInBasket}
            title={zh ? "加入 Agent 上下文" : "Attach to agent context"}
          >
            <ListPlus size={14} />
            <span>{selectedInBasket ? "已加入" : "上下文"}</span>
          </button>
          <button
            type="button"
            onClick={() => void attachSelectedDiff()}
            disabled={!selectedNode || selectedNode.gitStatus === "clean"}
            title={zh ? "加入该文件 diff" : "Attach this file diff"}
          >
            <GitCompare size={14} />
            <span>Diff</span>
          </button>
        </div>
      </footer>
    </section>
  );
}

function FileTreeNode({
  depth,
  node,
  selectedPath,
  onSelect,
}: {
  depth: number;
  node: WorkspaceFileNode;
  selectedPath?: string;
  onSelect: (node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  const Icon = node.type === "directory" ? Folder : getPreviewIcon(node.previewKind);
  const gitStatus = node.gitStatus && node.gitStatus !== "clean" ? node.gitStatus : null;
  return (
    <div className="files-tree-branch">
      <button
        type="button"
        className={`files-tree-row ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 22}px` }}
        onClick={() => onSelect(node)}
        title={node.relativePath}
      >
        {node.type === "directory" ? (
          <ChevronRight size={15} className="files-tree-chevron" />
        ) : (
          <span className="files-tree-spacer" />
        )}
        <Icon size={16} className={`files-type-icon ${node.previewKind ?? "folder"}`} />
        <span className="files-tree-name">{node.name}</span>
        {gitStatus ? <span className={`files-git-dot ${gitStatus}`} /> : null}
      </button>
      {node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          depth={depth + 1}
          node={child}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function getPreviewIcon(kind?: WorkspacePreviewKind): LucideIcon {
  if (kind === "code") return Code2;
  if (kind === "json") return FileJson;
  if (kind === "table") return Table2;
  if (kind === "image") return FileImage;
  if (kind === "structured") return Database;
  if (kind === "markdown" || kind === "text") return FileText;
  return File;
}

function addDiffToBasket(
  diff: WorkspaceGitDiffResult,
  basket: ChatAttachment[],
  workspacePath: string,
  onBasketChange: (attachments: ChatAttachment[]) => void,
): void {
  if (!diff.diff.trim()) return;
  const name = diff.path ? `Diff: ${diff.path}` : "Workspace Git diff";
  onBasketChange([
    ...basket.filter((item) => item.name !== name),
    {
      kind: "file",
      path: diff.path ? `${workspacePath}\\${diff.path.replace(/\//g, "\\")}` : workspacePath,
      name,
      visibleText: diff.diff,
      note: "Git diff attached from the Files panel.",
    },
  ]);
}

export function WorkspaceFilePreviewPane({
  language,
  preview,
  workspaceName,
}: {
  language: AppLanguage;
  preview: WorkspaceFilePreview | null;
  workspaceName: string;
}): React.JSX.Element {
  const zh = language === "zh";
  if (!preview) {
    return (
      <div className="file-preview-empty">
        <FileText size={28} />
        <h2>{zh ? "选择一个文件" : "Select a file"}</h2>
        <p>{zh ? "从右侧 Files 面板打开文件预览。" : "Open a file from the Files panel."}</p>
      </div>
    );
  }
  return (
    <article className="file-preview-workspace">
      <header className="file-preview-header">
        <div className="file-preview-tabs">
          <span>{preview.name}</span>
        </div>
        <div className="file-preview-breadcrumb">
          <span>{workspaceName}</span>
          <ChevronRight size={14} />
          <strong>{preview.relativePath}</strong>
        </div>
      </header>
      <div className="file-preview-body">
        <FilePreviewContent preview={preview} />
      </div>
    </article>
  );
}

function FilePreviewContent({
  preview,
}: {
  preview: WorkspaceFilePreview;
}): React.JSX.Element {
  if (preview.kind === "image" && preview.dataUrl) {
    return (
      <div className="file-preview-image">
        <img src={preview.dataUrl} alt={preview.name} />
      </div>
    );
  }
  if (preview.kind === "table" && preview.columns && preview.rows) {
    return (
      <div className="file-preview-table">
        <table>
          <thead>
            <tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={`${preview.path}-${rowIndex}`}>
                {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (preview.content) {
    return preview.kind === "markdown" ? (
      <div className="file-preview-markdown">
        <pre>{preview.content}</pre>
      </div>
    ) : (
      <pre className="file-preview-code">{preview.content}</pre>
    );
  }
  return (
    <div className="file-preview-metadata">
      <File size={24} />
      <h2>{preview.name}</h2>
      <p>{preview.message || "Preview is metadata-only for this file type."}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{preview.kind}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(preview.size)}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
