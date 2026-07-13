import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  FileText,
  Folder,
  GitCompare,
  History,
  ListPlus,
  Network,
  Rows3,
  Rows4,
  SquareArrowOutUpRight,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type {
  ChatAttachment,
  WorkspaceContextOverview,
  WorkspaceCheckpoint,
  WorkspaceCheckpointPreviewResult,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceGitDiffResult,
} from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";
import {
  AgentFileActivityPanel,
  createTraceEventsFromAttachments,
  type AgentFileTraceEvent,
} from "./AgentFileActivityPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ContextBasket } from "./ContextBasket";
import {
  ContextSnapshotPanel,
  createContextSnapshot,
  type ContextSnapshot,
} from "./ContextSnapshotPanel";
import { DirectoryContextPreview } from "./DirectoryContextPreview";
import { FilePreview } from "./FilePreview";
import { FileConflictPanel } from "./FileConflictPanel";
import { FilesTree } from "./FilesTree";
import { GitDiffPreview } from "./GitDiffPreview";
import { InstructionChainPreview } from "./InstructionChainPreview";
import { PatchReviewPanel } from "./PatchReviewPanel";
import { RepoMapPanel } from "./RepoMapPanel";

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
  const zh = language === "zh";
  const [overview, setOverview] = useState<WorkspaceContextOverview | null>(null);
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<WorkspaceFileNode | null>(null);
  const [selectedForContext, setSelectedForContext] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [diffPreview, setDiffPreview] = useState<WorkspaceGitDiffResult | null>(null);
  const [contextSnapshots, setContextSnapshots] = useState<ContextSnapshot[]>([]);
  const [workspaceCheckpoints, setWorkspaceCheckpoints] = useState<WorkspaceCheckpoint[]>([]);
  const [checkpointPreview, setCheckpointPreview] =
    useState<WorkspaceCheckpointPreviewResult | null>(null);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [systemOpenIconUrl, setSystemOpenIconUrl] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const previewRequestPathRef = useRef<string | null>(null);

  const selectedInBasket = selectedNode
    ? basket.some((item) => item.path === selectedNode.path)
    : false;
  const selectedContextNodes = Array.from(selectedForContext)
    .map((path) => findNodeByPath(nodes, path))
    .filter(Boolean) as WorkspaceFileNode[];
  const changedCount = overview?.stats.changedFileCount ?? 0;
  const instructionCount = overview?.stats.instructionCount ?? 0;
  const pendingAgentCheckpoint = workspaceCheckpoints.find(
    (checkpoint) => checkpoint.kind === "agent_run_baseline" && checkpoint.reviewStatus === "pending",
  );
  const systemOpenLabel = selectedNode?.type === "directory"
    ? "Open folder"
    : "Open with system app";

  const loadWorkspaceCheckpoints = useCallback(async () => {
    if (!workspacePath) return;
    try {
      setWorkspaceCheckpoints(await desktopApi.listWorkspaceCheckpoints(workspacePath));
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [workspacePath]);

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
      void loadWorkspaceCheckpoints();
      setLoadState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [loadWorkspaceCheckpoints, query, workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedNode(null);
    setSelectedForContext(new Set());
    setPreview(null);
    setDiffPreview(null);
    setContextSnapshots([]);
    setWorkspaceCheckpoints([]);
    setCheckpointPreview(null);
    setCheckpointMessage("");
  }, [workspacePath]);

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
    setDiffPreview(null);
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

  function addSelectedFile(): void {
    if (!selectedNode || selectedNode.type !== "file" || selectedInBasket) return;
    commitAttachments([createFileAttachment(selectedNode, preview)]);
  }

  function toggleContextSelection(node: WorkspaceFileNode): void {
    setSelectedForContext((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }

  function attachSelectedContextNodes(): void {
    const attachments = selectedContextNodes
      .filter((node) => !basket.some((item) => item.path === node.path))
      .map((node) =>
        node.type === "directory"
          ? createDirectoryAttachment(node, workspacePath)
          : createFileAttachment(node, preview?.path === node.path ? preview : null),
      );
    if (attachments.length === 0) return;
    commitAttachments(attachments);
  }

  function attachSelectedDirectory(): void {
    if (!selectedNode || selectedNode.type !== "directory") return;
    if (!confirmUntrustedContextShare()) return;
    const files = collectFileNodes(selectedNode);
    if (files.length > 200 && !confirmLargeDirectoryContext(files.length)) return;
    const attachment = createDirectoryAttachment(selectedNode, workspacePath);
    const nextBasket = [...basket.filter((item) => item.path !== selectedNode.path), attachment];
    onBasketChange(nextBasket);
    recordTrace([attachment]);
    recordSnapshot(nextBasket);
  }

  function confirmLargeDirectoryContext(fileCount: number): boolean {
    return window.confirm(
      zh
        ? `该目录包含 ${fileCount} 个文件，发送给 Agent 的 manifest 会被截断。确认加入？`
        : `This folder contains ${fileCount} files and the agent manifest will be truncated. Attach it?`,
    );
  }

  async function attachSelectedDiff(): Promise<void> {
    if (!selectedNode) return;
    if (!confirmUntrustedContextShare()) return;
    await loadDiff(false);
  }

  async function attachSelectedStagedDiff(): Promise<void> {
    if (!selectedNode) return;
    if (!confirmUntrustedContextShare()) return;
    await loadDiff(true);
  }

  async function attachWorkspaceDiff(): Promise<void> {
    if (!confirmUntrustedContextShare()) return;
    const diff = await desktopApi.getWorkspaceGitDiff({
      workspacePath,
      maxChars: 80_000,
      staged: false,
    });
    setDiffPreview(diff);
    if (!diff.diff.trim()) return;
    const attachment = createDiffAttachment(diff, workspacePath);
    const nextBasket = [
      ...basket.filter((item) => item.name !== attachment.name),
      attachment,
    ];
    onBasketChange(nextBasket);
    recordTrace([attachment]);
    recordSnapshot(nextBasket, diff);
  }

  async function loadDiff(staged: boolean): Promise<void> {
    if (!selectedNode) return;
    const diff = await desktopApi.getWorkspaceGitDiff({
      workspacePath,
      path: selectedNode.relativePath,
      maxChars: 60_000,
      staged,
    });
    setDiffPreview(diff);
    if (!diff.diff.trim()) return;
    const attachment = createDiffAttachment(diff, workspacePath);
    const nextBasket = [
      ...basket.filter((item) => item.name !== attachment.name),
      attachment,
    ];
    onBasketChange(nextBasket);
    recordTrace([attachment]);
    recordSnapshot(nextBasket, diff);
  }

  async function previewWithMode(mode: "head" | "tail" | "outline"): Promise<void> {
    if (!selectedNode || selectedNode.type !== "file") return;
    previewRequestPathRef.current = selectedNode.path;
    setDiffPreview(null);
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

  function commitAttachments(attachments: ChatAttachment[]): void {
    if (!confirmUntrustedContextShare()) return;
    const nextBasket = [...basket, ...attachments];
    onBasketChange(nextBasket);
    recordTrace(attachments);
    recordSnapshot(nextBasket);
  }

  function recordTrace(attachments: ChatAttachment[]): void {
    onFileTraceChange([
      ...createTraceEventsFromAttachments(attachments, scopeId),
      ...fileTraceEvents,
    ]);
  }

  function handleBasketChange(nextBasket: ChatAttachment[]): void {
    const added = nextBasket.filter(
      (next) => !basket.some((current) => current.path === next.path && current.name === next.name),
    );
    if (added.length > 0 && !confirmUntrustedContextShare()) return;
    onBasketChange(nextBasket);
    if (added.length > 0) {
      recordTrace(added);
      recordSnapshot(nextBasket);
    }
  }

  function confirmUntrustedContextShare(): boolean {
    if (workspaceTrusted) return true;
    return window.confirm(
      zh
        ? "该 workspace 尚未信任。确认要把这些文件上下文发送给 Agent？"
        : "This workspace is not trusted. Attach this file context to the agent anyway?",
    );
  }

  function recordSnapshot(
    nextBasket: ChatAttachment[],
    diff: WorkspaceGitDiffResult | null = diffPreview,
  ): void {
    setContextSnapshots((current) => [
      createContextSnapshot({
        attachments: nextBasket,
        diff,
        instructions: overview?.instructions ?? [],
        scopeId,
      }),
      ...current,
    ]);
  }

  async function createRollbackCheckpoint(): Promise<void> {
    setCheckpointMessage("");
    setCheckpointPreview(null);
    try {
      const checkpoint = await desktopApi.createWorkspaceCheckpoint({
        workspacePath,
        label: `Before workspace change review ${new Date().toLocaleString()}`,
      });
      setWorkspaceCheckpoints((current) => [
        checkpoint,
        ...current.filter((item) => item.id !== checkpoint.id),
      ]);
      setCheckpointMessage(
        `Checkpoint saved: ${checkpoint.storedFileCount}/${checkpoint.changedFileCount} files stored.`,
      );
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function restoreRollbackCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
    setCheckpointMessage("");
    try {
      const result = await desktopApi.restoreWorkspaceCheckpoint({
        workspacePath,
        checkpointId: checkpoint.id,
      });
      setCheckpointMessage(result.message);
      if (result.restored) {
        setDiffPreview(null);
        await refresh();
      }
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function acceptAgentChangeSet(checkpoint: WorkspaceCheckpoint): Promise<void> {
    try {
      const accepted = await desktopApi.acceptWorkspaceCheckpoint({
        workspacePath,
        checkpointId: checkpoint.id,
      });
      setWorkspaceCheckpoints((current) =>
        current.map((item) => item.id === accepted.id ? accepted : item),
      );
      setCheckpointMessage(zh ? "已接受本次 Agent 变更。" : "Agent changes accepted.");
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function previewRollbackCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
    setCheckpointMessage("");
    try {
      const nextPreview = await desktopApi.previewWorkspaceCheckpoint({
        workspacePath,
        checkpointId: checkpoint.id,
        maxFiles: 20,
        maxCharsPerFile: 3000,
      });
      setCheckpointPreview(nextPreview);
      setCheckpointMessage(nextPreview.message);
    } catch (caught) {
      setCheckpointPreview(null);
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="files-context-panel" aria-label="Files context">
      <header className="files-context-header">
        <div className="files-context-title">
          <FileText size={16} />
          <div>
            <strong>{selectedNode?.name || (zh ? "文件" : "Files")}</strong>
            <span>
              {overview?.git?.branch || "workspace"} · {changedCount} changed · {instructionCount} instructions
              {!workspaceTrusted ? " · read only" : ""}
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
            onClick={() => selectedNode && onInsertPath(selectedNode.path)}
            disabled={!selectedNode}
            title={zh ? "插入路径" : "Insert path"}
            aria-label={zh ? "插入路径" : "Insert path"}
          >
            <Folder size={14} />
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
          <button
            type="button"
            onClick={selectedContextNodes.length > 0 ? attachSelectedContextNodes : addSelectedFile}
            disabled={
              selectedContextNodes.length === 0 &&
              (!selectedNode || selectedNode.type !== "file" || selectedInBasket)
            }
            title={zh ? "加入 Agent 上下文" : "Attach to agent context"}
            aria-label={zh ? "加入 Agent 上下文" : "Attach to agent context"}
          >
            <ListPlus size={14} />
          </button>
          <button
            type="button"
            onClick={() => void attachSelectedDiff()}
            disabled={!selectedNode || selectedNode.gitStatus === "clean"}
            title={zh ? "加入 diff" : "Attach diff"}
            aria-label={zh ? "加入 diff" : "Attach diff"}
          >
            <GitCompare size={14} />
          </button>
          <button
            type="button"
            onClick={() => void attachWorkspaceDiff()}
            disabled={changedCount === 0}
            title={zh ? "加入工作区 diff" : "Attach workspace diff"}
            aria-label={zh ? "加入工作区 diff" : "Attach workspace diff"}
          >
            <GitCompare size={14} />
            <span className="files-toolbar-mini-label">W</span>
          </button>
          <button
            type="button"
            onClick={() => void attachSelectedStagedDiff()}
            disabled={!selectedNode || selectedNode.gitStatus === "clean"}
            title="Attach staged diff"
            aria-label="Attach staged diff"
          >
            <GitCompare size={14} />
            <span className="files-toolbar-mini-label">S</span>
          </button>
        </div>
      </header>

      {error ? <p className="files-context-error">{error}</p> : null}

      <div className="files-context-body">
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
          ) : (
            diffPreview ? (
              <GitDiffPreview diff={diffPreview} language={language} />
            ) : selectedNode?.type === "directory" ? (
              <DirectoryContextPreview
                files={collectFileNodes(selectedNode)}
                language={language}
                node={selectedNode}
                onAttach={attachSelectedDirectory}
              />
            ) : (
              <FilePreview language={language} preview={preview} />
            )
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
              selectedForContext={selectedForContext}
              selectedPath={selectedNode?.path}
              onSelect={(node) => void selectNode(node)}
              onToggleContext={toggleContextSelection}
            />
          )}
        </aside>
      </div>

      <div className="files-context-groups" aria-label="Files context controls">
        <FilesSectionGroup
          defaultOpen
          icon={<ShieldCheck size={13} />}
          summary={`${basket.length} context · ${instructionCount} instructions`}
          title={zh ? "上下文准备" : "Context Prep"}
        >
          <ContextBasket
            attachments={basket}
            language={language}
            onChange={handleBasketChange}
          />

          <InstructionChainPreview
            attachments={basket}
            instructions={overview?.instructions ?? []}
            language={language}
            onChange={handleBasketChange}
          />
        </FilesSectionGroup>

        <FilesSectionGroup
          defaultOpen
          icon={<GitCompare size={13} />}
          summary={`${changedCount} changed · ${diffPreview ? "diff loaded" : "no diff"}`}
          title={zh ? "变更审阅" : "Change Review"}
        >
          {pendingAgentCheckpoint ? (
            <section className="files-checkpoint-panel" aria-label={zh ? "Agent 变更集审阅" : "Agent change set review"}>
              <div className="files-checkpoint-header">
                <div>
                  <strong>{zh ? "Agent 变更待审阅" : "Agent changes awaiting review"}</strong>
                  <small>{pendingAgentCheckpoint.label}</small>
                </div>
                <div className="files-checkpoint-actions">
                  <button type="button" onClick={() => void acceptAgentChangeSet(pendingAgentCheckpoint)}>
                    {zh ? "接受本次变更" : "Accept changes"}
                  </button>
                  <button type="button" onClick={() => void restoreRollbackCheckpoint(pendingAgentCheckpoint)}>
                    {zh ? "拒绝并恢复运行前" : "Reject and restore"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <PatchReviewPanel
            diff={diffPreview}
            language={language}
            onReverted={() => {
              setDiffPreview(null);
              void refresh();
            }}
          />

          <WorkspaceCheckpointPanel
            checkpoints={workspaceCheckpoints}
            language={language}
            message={checkpointMessage}
            preview={checkpointPreview}
            onCreate={() => void createRollbackCheckpoint()}
            onPreview={(checkpoint) => void previewRollbackCheckpoint(checkpoint)}
            onRefresh={() => void loadWorkspaceCheckpoints()}
            onRestore={(checkpoint) => void restoreRollbackCheckpoint(checkpoint)}
          />

          <ArtifactsPanel
            events={fileTraceEvents}
            language={language}
            nodes={nodes}
            onOpen={(node) => void desktopApi.openPath(node.path)}
            onPreview={(node) => void selectNode(node)}
          />
        </FilesSectionGroup>

        <FilesSectionGroup
          icon={<Activity size={13} />}
          summary={`${fileTraceEvents.length} events · ${contextSnapshots.length} snapshots`}
          title={zh ? "Agent 痕迹" : "Agent Trace"}
        >
          <AgentFileActivityPanel
            currentAttachments={basket}
            events={fileTraceEvents}
            language={language}
            scopeId={scopeId}
          />

          <FileConflictPanel events={fileTraceEvents} language={language} />

          <ContextSnapshotPanel
            currentAttachments={basket}
            language={language}
            snapshots={contextSnapshots}
          />
        </FilesSectionGroup>

        <FilesSectionGroup
          icon={<Network size={13} />}
          summary={zh ? "依赖 / symbol / 热点" : "deps / symbols / hotspots"}
          title={zh ? "Repo 洞察" : "Repo Insight"}
        >
          <RepoMapPanel language={language} nodes={nodes} preview={preview} />
        </FilesSectionGroup>
      </div>
    </section>
  );
}

function FilesSectionGroup({
  children,
  defaultOpen = false,
  icon,
  summary,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  icon: ReactNode;
  summary: string;
  title: string;
}): React.JSX.Element {
  return (
    <details className="files-section-group" open={defaultOpen}>
      <summary>
        <span>
          {icon}
          <strong>{title}</strong>
        </span>
        <small>{summary}</small>
      </summary>
      <div className="files-section-group-body">
        {children}
      </div>
    </details>
  );
}

function WorkspaceCheckpointPanel({
  checkpoints,
  language,
  message,
  preview,
  onCreate,
  onPreview,
  onRefresh,
  onRestore,
}: {
  checkpoints: WorkspaceCheckpoint[];
  language: AppLanguage;
  message: string;
  preview: WorkspaceCheckpointPreviewResult | null;
  onCreate: () => void;
  onPreview: (checkpoint: WorkspaceCheckpoint) => void;
  onRefresh: () => void;
  onRestore: (checkpoint: WorkspaceCheckpoint) => void;
}): React.JSX.Element {
  void language;
  return (
    <section className="files-checkpoint-panel" aria-label="Rollback checkpoints">
      <div className="files-checkpoint-header">
        <div>
          <span>
            <History size={13} />
            Rollback Checkpoints
          </span>
          <small>
            Capture restorable snapshots of current changed files.
          </small>
        </div>
        <div className="files-checkpoint-actions">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" onClick={onCreate}>
            Create
          </button>
        </div>
      </div>
      {message ? <p className="files-checkpoint-message">{message}</p> : null}
      {checkpoints.length === 0 ? (
        <p className="files-checkpoint-empty">
          No checkpoints yet. Create one before risky agent edits so restore can be reviewed.
        </p>
      ) : (
        <ol className="files-checkpoint-list">
          {checkpoints.slice(0, 6).map((checkpoint) => (
            <li key={checkpoint.id}>
              <div>
                <strong>{checkpoint.label}</strong>
                <small>
                  {new Date(checkpoint.createdAt).toLocaleString()} - {checkpoint.storedFileCount}/{checkpoint.changedFileCount} stored
                  {checkpoint.skippedFileCount ? ` - ${checkpoint.skippedFileCount} skipped` : ""}
                </small>
              </div>
              <div className="files-checkpoint-row-actions">
                <button type="button" onClick={() => onPreview(checkpoint)}>
                  Preview diff
                </button>
                <button type="button" onClick={() => onRestore(checkpoint)}>
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {preview ? (
        <div className="files-checkpoint-preview" aria-label="Checkpoint diff preview">
          <div className="files-checkpoint-preview-header">
            <strong>Checkpoint diff preview</strong>
            <small>
              {preview.changedEntryCount} changed / {preview.totalEntries} entries
              {preview.truncated ? " - truncated" : ""}
            </small>
          </div>
          <ol>
            {preview.entries.map((entry) => (
              <li key={`${preview.checkpointId}:${entry.relativePath}`}>
                <div>
                  <strong>{entry.relativePath}</strong>
                  <small>
                    {entry.change} - checkpoint {entry.checkpointStatus}
                    {entry.currentSize != null ? ` - current ${entry.currentSize} bytes` : ""}
                  </small>
                  <p>{entry.message}</p>
                </div>
                <details>
                  <summary>Snippets</summary>
                  <div className="files-checkpoint-preview-snippets">
                    <pre>{entry.checkpointSnippet || "[no checkpoint text]"}</pre>
                    <pre>{entry.currentSnippet || "[no current text]"}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function createDiffAttachment(
  diff: WorkspaceGitDiffResult,
  workspacePath: string,
): ChatAttachment {
  const name = diff.path ? `Diff: ${diff.path}` : "Workspace Git diff";
  const displayName = diff.staged ? `Staged ${name}` : name;
  return {
    kind: "file",
    path: diff.path ? `${workspacePath}\\${diff.path.replace(/\//g, "\\")}` : workspacePath,
    name: displayName,
    visibleText: diff.diff,
    note: "Git diff attached from the Files context.",
  };
}

function createFileAttachment(
  node: WorkspaceFileNode,
  preview?: WorkspaceFilePreview | null,
): ChatAttachment {
  return {
    kind: "file",
    path: node.path,
    name: node.relativePath,
    note: `Selected from Files context. Preview kind: ${node.previewKind ?? "unknown"}.`,
    fileHash: preview?.fileHash,
  };
}

function createDirectoryAttachment(
  node: WorkspaceFileNode,
  workspacePath: string,
): ChatAttachment {
  const files = collectFileNodes(node);
  const manifest = files
    .slice(0, 200)
    .map((file) => `- ${file.relativePath} (${file.size ?? 0} bytes)`)
    .join("\n");
  return {
    kind: "folder",
    path: node.path,
    name: node.relativePath || node.name,
    visibleText: [
      `Folder context manifest for ${node.relativePath || node.name}`,
      `Workspace: ${workspacePath}`,
      `Files: ${files.length}`,
      manifest,
      files.length > 200 ? "[truncated]" : "",
    ]
      .filter(Boolean)
      .join("\n"),
    note: "Folder manifest selected from Files context. File contents are not attached implicitly.",
  };
}

function collectFileNodes(node: WorkspaceFileNode): WorkspaceFileNode[] {
  if (node.type === "file") return [node];
  return (node.children ?? []).flatMap((child) => collectFileNodes(child));
}

function findNodeByPath(
  nodes: WorkspaceFileNode[],
  path: string,
): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findNodeByPath(node.children ?? [], path);
    if (child) return child;
  }
  return null;
}
