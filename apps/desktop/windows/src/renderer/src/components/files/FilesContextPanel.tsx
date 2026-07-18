import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  FileText,
  Folder,
  GitCompare,
  History,
  ListPlus,
  Network,
  Presentation,
  Rows3,
  Rows4,
  SquareArrowOutUpRight,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type {
  ChatAttachment,
  DesktopFailureKind,
  ManagerPresentationGenerateResult,
  ManagerPresentationAudience,
  ManagerPresentationProgressEvent,
  WorkspaceContextOverview,
  WorkspaceCheckpoint,
  WorkspaceCheckpointPreviewResult,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFileWriteResult,
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
import {
  buildManagerPresentationTask,
  isPresentationPdfPreview,
} from "./presentationPdfAction";
import { RepoMapPanel } from "./RepoMapPanel";

interface FilesContextPanelProps {
  basket: ChatAttachment[];
  fileTraceEvents: AgentFileTraceEvent[];
  focusPath?: string;
  language: AppLanguage;
  scopeId: string;
  workspaceId: string;
  workspacePath: string;
  workspaceTrusted: boolean;
  onBasketChange: (attachments: ChatAttachment[]) => void;
  onFileTraceChange: (events: AgentFileTraceEvent[]) => void;
  onInsertPath: (path: string) => void;
  onPrepareTask: (task: string) => void;
}

type LoadState = "idle" | "loading" | "error";

export function FilesContextPanel({
  basket,
  fileTraceEvents,
  focusPath,
  language,
  scopeId,
  workspaceId,
  workspacePath,
  workspaceTrusted,
  onBasketChange,
  onFileTraceChange,
  onInsertPath,
  onPrepareTask,
}: FilesContextPanelProps): React.JSX.Element {
  const zh = language === "zh";
  const [overview, setOverview] = useState<WorkspaceContextOverview | null>(null);
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<WorkspaceFileNode | null>(null);
  const [selectedForContext, setSelectedForContext] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [safeEdit, setSafeEdit] = useState<{
    path: string;
    baseHash: string;
    draft: string;
    state: "editing" | "saving" | "conflict" | "saved" | "failed";
    message: string;
    conflict?: WorkspaceFileWriteResult;
    manualChoice: boolean;
  } | null>(null);
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
  const [managerPresentationProgress, setManagerPresentationProgress] =
    useState<ManagerPresentationProgressEvent | null>(null);
  const [managerPresentationResult, setManagerPresentationResult] =
    useState<ManagerPresentationGenerateResult | null>(null);
  const [audienceResults, setAudienceResults] = useState<Partial<Record<ManagerPresentationAudience, ManagerPresentationGenerateResult>>>({});
  const [managerPresentationRequirementText, setManagerPresentationRequirementText] = useState("");
  const [managerPresentationRequirements, setManagerPresentationRequirements] = useState<string[]>([]);
  const [managerPresentationRequirementStatus, setManagerPresentationRequirementStatus] = useState<{
    accepted: boolean;
    scope: "current_unfinished_stages" | "regenerate_required";
    message: string;
  } | null>(null);
  const [sourcePageReview, setSourcePageReview] = useState<{
    page: number;
    state: "opening" | "opened" | "error";
    message: string;
    viewerUrl?: string;
  } | null>(null);
  const previewRequestPathRef = useRef<string | null>(null);
  const managerPresentationRequestRef = useRef<string | null>(null);
  const managerPresentationCancelRequestedRef = useRef<string | null>(null);

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
  const canCreateManagerPresentation = selectedNode?.type === "file"
    && isPresentationPdfPreview(preview);
  const managerPresentationActive = managerPresentationProgress !== null
    && !["completed", "failed", "cancelled", "interrupted"].includes(managerPresentationProgress.phase);
  const audienceComparison = compareAudienceResults(audienceResults.non_expert_managers, audienceResults.technical_experts);

  const loadWorkspaceCheckpoints = useCallback(async () => {
    if (!workspacePath) return;
    try {
      setWorkspaceCheckpoints(await desktopApi.listWorkspaceCheckpoints(workspacePath, workspaceId));
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [workspaceId, workspacePath]);

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
      void loadWorkspaceCheckpoints();
      setLoadState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoadState("error");
    }
  }, [loadWorkspaceCheckpoints, query, workspaceId, workspacePath]);

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
    if (!focusPath || !nodes.length || selectedNode?.path === focusPath) return;
    const target = findNodeByPath(nodes, focusPath);
    if (target) void selectNode(target);
  }, [focusPath, nodes, selectedNode?.path]);

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
    setSelectedForContext(new Set());
    setPreview(null);
    setSafeEdit(null);
    setDiffPreview(null);
    setContextSnapshots([]);
    setWorkspaceCheckpoints([]);
    setCheckpointPreview(null);
    setCheckpointMessage("");
  }, [workspaceId, workspacePath]);

  useEffect(() => desktopApi.onManagerPresentationProgress((progress) => {
    if (progress.requestId !== managerPresentationRequestRef.current) return;
    setManagerPresentationProgress(progress);
  }), []);

  useEffect(() => {
    if (!selectedNode || !canCreateManagerPresentation) return;
    let stale = false;
    const sourcePath = selectedNode.path;
    void desktopApi.getManagerPresentationRecovery({ workspacePath, sourcePath })
      .then((recovery) => {
        if (stale || !recovery) return;
        managerPresentationRequestRef.current = recovery.requestId;
        managerPresentationCancelRequestedRef.current = null;
        setManagerPresentationResult(null);
        setManagerPresentationProgress({
          requestId: recovery.requestId,
          phase: recovery.phase,
          progress: recovery.progress,
          message: recovery.message,
          outputPath: recovery.outputPath,
          activeStage: recovery.activeStage,
          stageArtifacts: recovery.stageArtifacts,
        });
        setManagerPresentationRequirements(recovery.requirements ?? []);
      })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [canCreateManagerPresentation, selectedNode, workspacePath]);

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
    setManagerPresentationResult((current) => current?.sourcePath === node.path ? current : null);
    setAudienceResults((current) => Object.fromEntries(Object.entries(current).filter(([, result]) => result?.sourcePath === node.path)) as Partial<Record<ManagerPresentationAudience, ManagerPresentationGenerateResult>>);
    setManagerPresentationProgress((current) => managerPresentationResult?.sourcePath === node.path ? current : null);
    setSourcePageReview(null);
    setDiffPreview(null);
    setSafeEdit(null);
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
        ? `该目录包含 ${fileCount} 个文件，交给智能体的文件清单会被截断。确认加入？`
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
      workspaceId,
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
      workspaceId,
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

  function beginSafeEdit(): void {
    if (!preview?.fileHash || preview.content === undefined || preview.truncated) return;
    setSafeEdit({ path: preview.path, baseHash: preview.fileHash, draft: preview.content, state: "editing", message: zh ? "保存前会确认文件仍与刚才读取的版本一致。" : "Before saving, the app will confirm the file still matches the version you read.", manualChoice: false });
  }

  async function applySafeEdit(mode: "save" | "overwrite" | "save_as"): Promise<void> {
    if (!safeEdit) return;
    const expectedHash = mode === "overwrite" ? safeEdit.conflict?.currentHash || safeEdit.baseHash : safeEdit.baseHash;
    setSafeEdit((current) => current ? { ...current, state: "saving", message: mode === "save_as" ? (zh ? "正在把我的版本另存为新文件…" : "Saving my version to a new file…") : (zh ? "正在核对文件是否被外部修改…" : "Checking for external changes…") } : current);
    try {
      const result = await desktopApi.writeWorkspaceFile({
        workspacePath,
        workspaceId,
        path: safeEdit.path,
        content: safeEdit.draft,
        expectedHash,
        mode,
        suggestedName: `${safeEdit.path.split(/[\\/]/).pop()?.replace(/(\.[^.]+)$/, "-my-version$1") || "my-version.txt"}`,
      });
      if (result.status === "conflict") {
        setSafeEdit((current) => current ? { ...current, state: "conflict", conflict: result, manualChoice: false, message: zh ? "检测到外部修改，已停止保存；外部内容没有被覆盖。" : "External changes detected. Save stopped and the external content was not overwritten." } : current);
        return;
      }
      if (result.status === "canceled") {
        setSafeEdit((current) => current ? { ...current, state: "editing", message: zh ? "已取消另存，外部文件保持不变。" : "Save as canceled; the external file is unchanged." } : current);
        return;
      }
      if (mode === "save_as") {
        setSafeEdit((current) => current ? { ...current, state: "saved", message: zh ? `我的版本已另存为：${result.destinationPath}` : `My version was saved as: ${result.destinationPath}` } : current);
        return;
      }
      const nextPreview = await desktopApi.previewWorkspaceFile({ workspacePath, workspaceId, path: safeEdit.path, maxBytes: 220_000 });
      setPreview(nextPreview);
      setSafeEdit((current) => current ? { ...current, baseHash: nextPreview.fileHash || result.savedHash || current.baseHash, draft: nextPreview.content ?? current.draft, state: "saved", conflict: undefined, manualChoice: false, message: mode === "overwrite" ? (zh ? "已按你的明确选择覆盖，并完成最新哈希校验。" : "Overwritten by your explicit choice after a fresh hash check.") : (zh ? "保存成功，写入前未发现外部修改。" : "Saved; no external change was found before writing.") } : current);
    } catch (caught) {
      setSafeEdit((current) => current ? { ...current, state: "failed", message: caught instanceof Error ? caught.message : String(caught) } : current);
    }
  }

  async function reloadExternalVersion(): Promise<void> {
    if (!safeEdit) return;
    try {
      const nextPreview = await desktopApi.previewWorkspaceFile({ workspacePath, workspaceId, path: safeEdit.path, maxBytes: 220_000 });
      setPreview(nextPreview);
      setSafeEdit({ path: nextPreview.path, baseHash: nextPreview.fileHash || "", draft: nextPreview.content || "", state: "editing", message: zh ? "已重新读取外部版本，可以在最新内容上继续编辑。" : "Reloaded the external version; you can continue from the latest content.", manualChoice: false });
    } catch (caught) {
      setSafeEdit((current) => current ? { ...current, state: "failed", message: caught instanceof Error ? caught.message : String(caught) } : current);
    }
  }

  async function openSelectedWithSystem(): Promise<void> {
    if (!selectedNode) return;
    const result = await desktopApi.openPath(selectedNode.path);
    if (result) setError(result);
  }

  function commitAttachments(attachments: ChatAttachment[]): boolean {
    if (!confirmUntrustedContextShare()) return false;
    const nextBasket = [...basket, ...attachments];
    onBasketChange(nextBasket);
    recordTrace(attachments);
    recordSnapshot(nextBasket);
    return true;
  }

  function prepareManagerPresentation(): void {
    if (!selectedNode || !canCreateManagerPresentation) return;
    if (!selectedInBasket && !commitAttachments([createFileAttachment(selectedNode, preview)])) return;
    onPrepareTask(buildManagerPresentationTask(language));
  }

  async function createManagerPresentation(
    mode: "resume" | "restart" = "resume",
    audience: ManagerPresentationAudience = "non_expert_managers",
  ): Promise<void> {
    if (!selectedNode || !canCreateManagerPresentation) return;
    if (!selectedInBasket && !commitAttachments([createFileAttachment(selectedNode, preview)])) return;
    const interrupted = managerPresentationProgress?.phase === "interrupted"
      && managerPresentationRequestRef.current === managerPresentationProgress.requestId;
    if (mode === "restart" && interrupted && managerPresentationProgress) {
      const decision = await desktopApi.resolveManagerPresentationRecovery({
        requestId: managerPresentationProgress.requestId,
        workspacePath,
        sourcePath: selectedNode.path,
        decision: "restart",
      });
      if (!decision.accepted) {
        setError(zh ? "未能结束上次中断的任务，请刷新后重试。" : "Could not close the interrupted task. Refresh and try again.");
        return;
      }
      managerPresentationRequestRef.current = null;
      setManagerPresentationProgress(null);
    }
    const recovering = mode === "resume" && interrupted;
    const requestId = recovering ? managerPresentationProgress.requestId : crypto.randomUUID();
    managerPresentationRequestRef.current = requestId;
    managerPresentationCancelRequestedRef.current = null;
    setManagerPresentationResult(null);
    setManagerPresentationRequirementStatus(null);
    setSourcePageReview(null);
    setManagerPresentationProgress({
      requestId,
      phase: "analyzing",
      progress: 1,
      message: recovering
        ? zh ? "正在从上次安全检查点恢复 PPT 生成任务。" : "Resuming the presentation from its last safe checkpoint."
        : zh ? "正在启动管理者版 PPT 生成任务。" : "Starting manager presentation generation.",
    });
    try {
      const result = await desktopApi.generateManagerPresentation({
        requestId,
        workspacePath,
        sourcePath: selectedNode.path,
        audience,
        requirements: recovering ? managerPresentationRequirements : [],
      });
      if (managerPresentationRequestRef.current !== requestId) return;
      setManagerPresentationResult(result);
      setAudienceResults((current) => ({ ...current, [result.audience]: result }));
      const artifactEvent: AgentFileTraceEvent = {
        action: "agent_artifact",
        at: new Date().toISOString(),
        hash: `pptx-${result.slideCount}-${Math.round(result.speakerNotesCoverage * 100)}`,
        name: result.outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? result.outputPath,
        path: result.outputPath,
        scopeId,
        snapshotId: `presentation-${requestId.slice(0, 8)}`,
        source: "manager presentation generator",
      };
      onFileTraceChange([artifactEvent, ...fileTraceEvents]);
      await refresh();
    } catch (caught) {
      if (managerPresentationRequestRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      if (managerPresentationCancelRequestedRef.current === requestId) {
        setManagerPresentationProgress((current) => current?.requestId === requestId && current.phase === "cancelled"
          ? current
          : { requestId, phase: "cancelled", progress: 100, message: zh ? "已取消生成；未保留未完成的 PPT 文件。" : "Generation cancelled; no incomplete PPT was kept." });
        return;
      }
      setError(message);
      setManagerPresentationProgress((current) => current?.requestId === requestId && current.phase === "failed"
        ? current
        : { requestId, phase: "failed", progress: 100, message });
    }
  }

  async function abandonInterruptedManagerPresentation(): Promise<void> {
    if (!selectedNode || managerPresentationProgress?.phase !== "interrupted") return;
    const requestId = managerPresentationProgress.requestId;
    const decision = await desktopApi.resolveManagerPresentationRecovery({
      requestId,
      workspacePath,
      sourcePath: selectedNode.path,
      decision: "abandon",
    });
    if (!decision.accepted) {
      setError(zh ? "未能放弃上次中断的任务，请刷新后重试。" : "Could not abandon the interrupted task. Refresh and try again.");
      return;
    }
    managerPresentationRequestRef.current = null;
    setManagerPresentationProgress(null);
    setManagerPresentationRequirementStatus(null);
    setError("");
  }

  async function cancelManagerPresentation(): Promise<void> {
    const requestId = managerPresentationRequestRef.current;
    if (!requestId || !managerPresentationActive) return;
    managerPresentationCancelRequestedRef.current = requestId;
    setManagerPresentationProgress((current) => current?.requestId === requestId
      ? { ...current, phase: "cancelling", message: zh ? "正在安全取消并清理未完成文件…" : "Cancelling safely and cleaning incomplete files…" }
      : current);
    try {
      const result = await desktopApi.cancelManagerPresentation({ requestId });
      if (!result.accepted) {
        managerPresentationCancelRequestedRef.current = null;
        setError(zh ? "任务已经结束，无法再取消。" : "The task has already finished and cannot be cancelled.");
      }
    } catch (caught) {
      managerPresentationCancelRequestedRef.current = null;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function pauseManagerPresentation(): Promise<void> {
    const requestId = managerPresentationRequestRef.current;
    if (!requestId || !managerPresentationActive) return;
    setManagerPresentationProgress((current) => current?.requestId === requestId
      ? { ...current, phase: "pausing", message: zh ? "正在到达安全暂停点…" : "Pausing at a safe checkpoint…" }
      : current);
    try {
      const result = await desktopApi.pauseManagerPresentation({ requestId });
      if (!result.accepted) setError(zh ? "任务当前无法暂停。" : "The task cannot be paused right now.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function resumeManagerPresentation(): Promise<void> {
    const requestId = managerPresentationRequestRef.current;
    if (!requestId || managerPresentationProgress?.phase !== "paused") return;
    setManagerPresentationProgress((current) => current?.requestId === requestId
      ? { ...current, phase: "resuming", message: zh ? "正在从安全检查点继续生成…" : "Resuming from the safe checkpoint…" }
      : current);
    try {
      const result = await desktopApi.resumeManagerPresentation({ requestId });
      if (!result.accepted) setError(zh ? "任务当前无法继续。" : "The task cannot be resumed right now.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function updateManagerPresentationRequirement(): Promise<void> {
    const requestId = managerPresentationRequestRef.current;
    const text = managerPresentationRequirementText.trim();
    if (!requestId || !text) return;
    try {
      const result = await desktopApi.updateManagerPresentationRequirement({ requestId, text });
      setManagerPresentationRequirementStatus({
        accepted: result.accepted,
        scope: result.scope,
        message: result.message,
      });
      setManagerPresentationRequirements(result.requirements);
      if (result.accepted) setManagerPresentationRequirementText("");
    } catch (caught) {
      setManagerPresentationRequirementStatus({
        accepted: false,
        scope: "regenerate_required",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  async function openSourcePage(page: number): Promise<void> {
    const sourcePath = managerPresentationResult?.sourcePath ?? selectedNode?.path;
    if (!sourcePath) return;
    setSourcePageReview({
      page,
      state: "opening",
      message: zh ? `正在打开原 PDF 第 ${page} 页。` : `Opening source PDF page ${page}.`,
    });
    try {
      const result = await desktopApi.openPdfPage({
        path: sourcePath,
        page,
      });
      setSourcePageReview({
        page: result.page,
        state: "opened",
        message: zh ? `已在原 PDF 中打开第 ${result.page} 页。` : `Opened source PDF page ${result.page}.`,
        viewerUrl: result.viewerUrl,
      });
    } catch (caught) {
      setSourcePageReview({
        page,
        state: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
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
        ? "该工作区尚未信任。确认要把这些文件材料交给智能体？"
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
        workspaceId,
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

  async function restoreRollbackCheckpoint(checkpoint: WorkspaceCheckpoint, includePaths?: string[]): Promise<void> {
    setCheckpointMessage("");
    try {
      const result = await desktopApi.restoreWorkspaceCheckpoint({
        workspacePath,
        workspaceId,
        checkpointId: checkpoint.id,
        operationId: `user-version-restore-${crypto.randomUUID()}`,
        ...(includePaths ? { includePaths } : {}),
      });
      setCheckpointMessage(includePaths
        ? (zh
          ? `仅撤销 ${includePaths.map((path) => path.split(/[\\/]/).pop()).join("、")}；其他修改保持不变。${result.approvalQueued ? "正在等待批准。" : ""}`
          : `Undo only ${includePaths.join(", ")}; other changes stay unchanged.${result.approvalQueued ? " Waiting for approval." : ""}`)
        : result.message);
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
        workspaceId,
        checkpointId: checkpoint.id,
      });
      setWorkspaceCheckpoints((current) =>
        current.map((item) => item.id === accepted.id ? accepted : item),
      );
      setCheckpointMessage(zh ? "已接受本次智能体变更。" : "Agent changes accepted.");
    } catch (caught) {
      setCheckpointMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function previewRollbackCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
    setCheckpointMessage("");
    try {
      const nextPreview = await desktopApi.previewWorkspaceCheckpoint({
        workspacePath,
        workspaceId,
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

  async function openCheckpointVersion(checkpoint: WorkspaceCheckpoint): Promise<void> {
    const entry = checkpoint.entries.find((item) => item.stored && item.versionPath);
    if (!entry?.versionPath) {
      setCheckpointMessage(zh ? "这个版本没有可打开的文件副本。" : "This version has no openable file copy.");
      return;
    }
    const openError = await desktopApi.openPath(entry.versionPath);
    setCheckpointMessage(openError
      ? (zh ? `无法打开旧版：${openError}` : `Could not open version: ${openError}`)
      : (zh ? `已打开 ${entry.relativePath} 的这个版本。` : `Opened this version of ${entry.relativePath}.`));
  }

  const managerBusinessProgress = managerPresentationProgress
    ? getManagerBusinessProgress(managerPresentationProgress, language)
    : null;

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
            title={zh ? "交给智能体使用" : "Attach to agent context"}
            aria-label={zh ? "交给智能体使用" : "Attach to agent context"}
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
          {canCreateManagerPresentation ? (
            <section className="presentation-pdf-action" aria-label={zh ? "演示报告操作" : "Presentation report actions"}>
              <div>
                <Presentation size={18} />
                <span>
                  <strong>{zh ? "这是一份演示型 PDF" : "This is a presentation-style PDF"}</strong>
                  <small>{zh ? "可转换为面向管理者的可编辑演示文稿，并保留讲稿与来源页码。" : "Turn it into an editable manager deck with speaker notes and source pages."}</small>
                </span>
              </div>
              {preview?.presentationStory ? (
                <section
                  className="presentation-storyline"
                  data-quality-status={preview.presentationStory.quality.status}
                  data-testid="presentation-storyline"
                >
                  <header>
                    <span>
                      <strong>{preview.presentationStory.title}</strong>
                      <small>{zh ? "已经按原演示顺序整理，并保留每项来源页码。" : "Organized in source order with a page reference for every item."}</small>
                    </span>
                    <b data-testid="presentation-story-quality">
                      {preview.presentationStory.quality.status === "passed"
                        ? zh ? "故事线检查已通过" : "Storyline check passed"
                        : zh ? "故事线检查未通过" : "Storyline check failed"}
                    </b>
                  </header>
                  <div className="presentation-storyline-grid">
                    <article data-testid="presentation-story-sections">
                      <h4>{zh ? "报告怎么展开" : "Storyline"}</h4>
                      <ol>
                        {preview.presentationStory.storySections.map((item) => (
                          <li key={`story:${item.page}:${item.text}`}>
                            <span>{item.text}</span>
                            <button type="button" data-story-page={item.page} onClick={() => void openSourcePage(item.page)}>p.{item.page}</button>
                          </li>
                        ))}
                      </ol>
                    </article>
                    <article data-testid="presentation-story-numbers">
                      <h4>{zh ? "关键数据" : "Key numbers"}</h4>
                      <ul>
                        {selectPresentationKeyNumbers(preview.presentationStory.numericHighlights).map((item) => (
                          <li key={`number:${item.page}:${item.text}`}>
                            <span>{item.text}</span>
                            <button type="button" data-number-page={item.page} onClick={() => void openSourcePage(item.page)}>p.{item.page}</button>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>
                  <details data-testid="presentation-story-summary">
                    <summary>{zh ? `查看总结与自动核对（${preview.presentationStory.summaryPoints.length} 项）` : `Summary and checks (${preview.presentationStory.summaryPoints.length})`}</summary>
                    <ul>
                      {preview.presentationStory.summaryPoints.map((item) => <li key={`summary:${item.page}:${item.text}`}>{item.text} <button type="button" onClick={() => void openSourcePage(item.page)}>p.{item.page}</button></li>)}
                    </ul>
                    <p>{preview.presentationStory.quality.checks.join(" · ")}</p>
                  </details>
                  {!managerPresentationResult && sourcePageReview ? (
                    <p className={`presentation-source-review-status ${sourcePageReview.state}`} data-testid="story-source-page-status" data-opened-page={sourcePageReview.state === "opened" ? sourcePageReview.page : undefined}>{sourcePageReview.message}</p>
                  ) : null}
                </section>
              ) : null}
              <div className="presentation-pdf-action-controls">
                <button
                  type="button"
                  data-testid="generate-manager-presentation"
                  disabled={managerPresentationActive}
                  onClick={() => void createManagerPresentation()}
                >
                  {managerPresentationActive
                    ? `${managerPresentationProgress.progress}%`
                    : managerPresentationProgress?.phase === "interrupted"
                      ? zh ? "继续未完成任务" : "Resume unfinished task"
                    : managerPresentationProgress && ["failed", "cancelled"].includes(managerPresentationProgress.phase)
                      ? zh ? "重试生成" : "Retry generation"
                      : zh ? "生成管理者版 PPT" : "Create manager PPT"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  data-testid="generate-technical-presentation"
                  disabled={managerPresentationActive}
                  onClick={() => void createManagerPresentation("resume", "technical_experts")}
                >
                  {zh ? "生成技术专家版 PPT" : "Create technical PPT"}
                </button>
                {managerPresentationActive ? (
                  <button
                    type="button"
                    className="secondary"
                    data-testid={managerPresentationProgress?.phase === "paused"
                      ? "resume-manager-presentation"
                      : "pause-manager-presentation"}
                    disabled={["pausing", "resuming", "cancelling"].includes(managerPresentationProgress?.phase || "")}
                    onClick={() => managerPresentationProgress?.phase === "paused"
                      ? void resumeManagerPresentation()
                      : void pauseManagerPresentation()}
                  >
                    {managerPresentationProgress?.phase === "paused"
                      ? zh ? "继续生成" : "Resume"
                      : managerPresentationProgress?.phase === "pausing"
                        ? zh ? "正在暂停…" : "Pausing…"
                        : zh ? "暂停生成" : "Pause"}
                  </button>
                ) : null}
                {managerPresentationActive ? (
                  <button
                    type="button"
                    className="secondary danger"
                    data-testid="cancel-manager-presentation"
                    disabled={managerPresentationProgress?.phase === "cancelling"}
                    onClick={() => void cancelManagerPresentation()}
                  >
                    {managerPresentationProgress?.phase === "cancelling"
                      ? zh ? "正在取消…" : "Cancelling…"
                      : zh ? "取消生成" : "Cancel"}
                  </button>
                ) : null}
                {managerPresentationProgress?.phase === "interrupted" ? (
                  <button
                    type="button"
                    className="secondary"
                    data-testid="restart-manager-presentation"
                    onClick={() => void createManagerPresentation("restart")}
                  >
                    {zh ? "重新开始" : "Start over"}
                  </button>
                ) : null}
                {managerPresentationProgress?.phase === "interrupted" ? (
                  <button
                    type="button"
                    className="secondary danger"
                    data-testid="abandon-manager-presentation"
                    onClick={() => void abandonInterruptedManagerPresentation()}
                  >
                    {zh ? "放弃任务" : "Abandon task"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  data-testid="prepare-manager-presentation-task"
                  onClick={prepareManagerPresentation}
                >
                  {zh ? "编辑生成要求" : "Edit requirements"}
                </button>
              </div>
              {managerPresentationActive ? (
                <div className="presentation-live-requirement" data-testid="manager-presentation-live-requirement">
                  <label htmlFor="manager-presentation-requirement">
                    {zh ? "运行中补充要求" : "Add a requirement while running"}
                  </label>
                  <div>
                    <input
                      id="manager-presentation-requirement"
                      data-testid="manager-presentation-requirement-input"
                      value={managerPresentationRequirementText}
                      maxLength={240}
                      placeholder={zh ? "例如：重点强调 4.8 和 9.6 Tbps 带宽需求" : "Example: emphasize the 4.8 and 9.6 Tbps bandwidth requirements"}
                      onChange={(event) => setManagerPresentationRequirementText(event.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary"
                      data-testid="submit-manager-presentation-requirement"
                      disabled={!managerPresentationRequirementText.trim()}
                      onClick={() => void updateManagerPresentationRequirement()}
                    >
                      {zh ? "应用到当前任务" : "Apply to current task"}
                    </button>
                  </div>
                  <small>{managerPresentationProgress?.activeStage === "validating"
                    ? zh ? "当前已进入验收；新要求需要重新执行规划和生成阶段。" : "Validation has started; a new requirement needs planning and generation to run again."
                    : zh ? "将应用到当前任务尚未完成的规划、生成和验收阶段。" : "Applies to unfinished planning, generation, and validation stages in this task."}</small>
                </div>
              ) : null}
              {managerPresentationRequirementStatus ? (
                <p
                  className={`presentation-live-requirement-status ${managerPresentationRequirementStatus.accepted ? "accepted" : "rejected"}`}
                  data-scope={managerPresentationRequirementStatus.scope}
                  data-testid="manager-presentation-requirement-status"
                  role="status"
                >
                  {managerPresentationRequirementStatus.message}
                </p>
              ) : null}
              {managerPresentationProgress ? (
                <div
                  className={`presentation-pdf-progress ${managerPresentationProgress.phase}`}
                  data-phase={managerPresentationProgress.phase}
                  data-active-stage={managerPresentationProgress.activeStage}
                  data-progress={managerPresentationProgress.progress}
                  data-request-id={managerPresentationProgress.requestId}
                  data-output-path={managerPresentationProgress.outputPath}
                  data-testid="manager-presentation-progress"
                  role="status"
                  aria-live="polite"
                >
                  {managerBusinessProgress ? (
                    <section
                      className="manager-business-progress"
                      data-business-stage={managerBusinessProgress.id}
                      data-source-phase={managerPresentationProgress.phase}
                      data-testid="manager-business-progress"
                      aria-label={zh ? "当前业务进度" : "Current business progress"}
                    >
                      <header>
                        <strong>{managerBusinessProgress.title}</strong>
                        <span>{managerPresentationProgress.progress}%</span>
                      </header>
                      <p data-testid="manager-business-progress-message">{managerPresentationProgress.message}</p>
                      <small><strong>{zh ? "接下来：" : "Next: "}</strong>{managerBusinessProgress.nextAction}</small>
                      <ol aria-label={zh ? "任务阶段" : "Task stages"}>
                        {managerBusinessProgress.stages.map((stage) => (
                          <li
                            data-stage={stage.id}
                            data-state={stage.state}
                            key={stage.id}
                            aria-current={stage.state === "current" ? "step" : undefined}
                          >
                            <span aria-hidden="true">{stage.state === "done" ? "✓" : stage.state === "current" ? "▶" : "○"}</span>
                            {stage.label}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                  {managerPresentationProgress.stageArtifacts?.length ? (
                    <section
                      className="presentation-stage-artifacts"
                      data-testid="manager-presentation-stage-artifacts"
                      aria-label={zh ? "临时阶段成果" : "Temporary stage results"}
                    >
                      <header>
                        <strong>{zh ? "可查看的阶段成果" : "Viewable stage results"}</strong>
                        <span>{zh ? "临时快照 · 最终成果会单独生成，不会覆盖" : "Temporary snapshots · final output is created separately"}</span>
                      </header>
                      {managerPresentationProgress.stageArtifacts.map((artifact) => (
                        <article
                          key={artifact.id}
                          data-immutable={artifact.immutable}
                          data-path={artifact.path}
                          data-stage={artifact.stage}
                          data-task-elapsed-ms={artifact.taskElapsedMs}
                          data-temporary={artifact.temporary}
                        >
                          <div>
                            <strong>{artifact.label}</strong>
                            <span className="presentation-stage-temporary">{zh ? "临时结果" : "Temporary"}</span>
                          </div>
                          <p>{artifact.summary}</p>
                          <button type="button" onClick={() => void desktopApi.openPath(artifact.path)}>
                            <SquareArrowOutUpRight aria-hidden="true" size={13} />
                            {zh ? "打开快照" : "Open snapshot"}
                          </button>
                        </article>
                      ))}
                    </section>
                  ) : null}
                  {managerPresentationProgress.failureRecovery ? (
                    <div
                      className="presentation-failure-recovery"
                      data-kind={managerPresentationProgress.failureRecovery.kind}
                      data-escalation={managerPresentationProgress.failureRecovery.escalationLevel}
                      data-exhausted={managerPresentationProgress.failureRecovery.exhausted}
                      data-affected-object={managerPresentationProgress.failureRecovery.affectedObject}
                      data-recovery-action={managerPresentationProgress.failureRecovery.recoveryAction}
                      data-testid="manager-presentation-failure-recovery"
                    >
                      <strong>{managerPresentationProgress.failureRecovery.reason}</strong>
                      <span><strong>{zh ? "错误类别：" : "Category: "}</strong>{failureKindLabel(managerPresentationProgress.failureRecovery.kind, zh)}</span>
                      <span><strong>{zh ? "受影响对象：" : "Affected object: "}</strong>{managerPresentationProgress.failureRecovery.affectedObject}</span>
                      <span>
                        {zh ? "已尝试" : "Attempts"}: {managerPresentationProgress.failureRecovery.attempts}/{managerPresentationProgress.failureRecovery.retryLimit}
                      </span>
                      <span>{managerPresentationProgress.failureRecovery.suggestedAction}</span>
                      <button type="button" data-testid="manager-presentation-recovery-action" onClick={() => void createManagerPresentation()}>
                        {zh ? "重试" : "Retry"}
                      </button>
                    </div>
                  ) : null}
                  <progress max={100} value={managerPresentationProgress.progress} />
                  {Object.keys(audienceResults).length > 0 ? (
                    <section className="presentation-audience-results" data-testid="presentation-audience-results">
                      {(["non_expert_managers", "technical_experts"] as const).map((audience) => {
                        const result = audienceResults[audience];
                        if (!result) return null;
                        return (
                          <article
                            key={audience}
                            data-acronyms={result.audienceProfile.acronymOccurrences}
                            data-audience={audience}
                            data-content-hash={result.audienceProfile.contentHash}
                            data-facts={result.audienceProfile.goldenFactIds.join(",")}
                            data-impact-signals={result.audienceProfile.impactDecisionSignals}
                            data-output-path={result.outputPath}
                            data-technical-signals={result.audienceProfile.technicalDetailSignals}
                          >
                            <strong>{audience === "technical_experts" ? (zh ? "技术专家版" : "Technical") : (zh ? "非专业管理者版" : "Manager")}</strong>
                            <span>{result.slideCount} {zh ? "页" : "slides"} · {Math.round(result.sourcePageCoverage * 100)}% {zh ? "来源覆盖" : "sources"}</span>
                            <button type="button" onClick={() => void desktopApi.openPath(result.outputPath)}>{zh ? "打开" : "Open"}</button>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}
                  {audienceComparison ? (
                    <section className="presentation-audience-comparison" data-status={audienceComparison.passed ? "passed" : "failed"} data-testid="presentation-audience-comparison">
                      <strong>{audienceComparison.passed ? (zh ? "双版本自动核对已通过" : "Audience comparison passed") : (zh ? "双版本自动核对未通过" : "Audience comparison failed")}</strong>
                      <ul>
                        <li>{zh ? `核心事实 ${audienceComparison.sharedFacts}/5 完全一致` : `${audienceComparison.sharedFacts}/5 core facts match`}</li>
                        <li>{zh ? `管理者版影响/决策信号 ${audienceComparison.managerImpact}` : `Manager impact signals: ${audienceComparison.managerImpact}`}</li>
                        <li>{zh ? `技术版技术细节信号 ${audienceComparison.technicalDetails}` : `Technical detail signals: ${audienceComparison.technicalDetails}`}</li>
                        <li>{zh ? `两版内容哈希不同：${audienceComparison.contentDistinct ? "是" : "否"}` : `Content differs: ${audienceComparison.contentDistinct ? "yes" : "no"}`}</li>
                      </ul>
                    </section>
                  ) : null}
                  {managerPresentationResult ? (
                    <span
                      className="presentation-pdf-result"
                      data-output-path={managerPresentationResult.outputPath}
                      data-testid="manager-presentation-result"
                    >
                      {zh
                        ? `${managerPresentationResult.slideCount} 页 · 讲稿 ${Math.round(managerPresentationResult.speakerNotesCoverage * 100)}% · 来源 ${Math.round(managerPresentationResult.sourcePageCoverage * 100)}%`
                        : `${managerPresentationResult.slideCount} slides · notes ${Math.round(managerPresentationResult.speakerNotesCoverage * 100)}% · sources ${Math.round(managerPresentationResult.sourcePageCoverage * 100)}%`}
                      <button
                        type="button"
                        title={managerPresentationResult.outputPath}
                        onClick={() => void desktopApi.openPath(managerPresentationResult.outputPath)}
                      >
                        {zh ? "打开 PPT" : "Open PPT"}
                      </button>
                      {managerPresentationResult.appliedRequirements.length > 0 ? (
                        <small data-testid="manager-presentation-applied-requirements">
                          {zh ? "已应用补充要求：" : "Applied requirements: "}
                          {managerPresentationResult.appliedRequirements.join("；")}
                        </small>
                      ) : null}
                    </span>
                  ) : null}
                  {managerPresentationResult ? (
                    <section
                      className="presentation-key-conclusions"
                      data-testid="presentation-key-conclusions"
                      data-traceability-rate={managerPresentationResult.conclusionTraceabilityRate}
                      data-status={managerPresentationResult.conclusionTraceabilityRate === 1 ? "passed" : "failed"}
                      aria-label={zh ? "关键结论与原始依据" : "Key conclusions and original evidence"}
                    >
                      <div className="presentation-source-review-heading">
                        <strong>{zh ? "关键结论与原始依据" : "Key conclusions and evidence"}</strong>
                        <small>
                          {zh
                            ? `可追溯 ${managerPresentationResult.keyConclusions.filter((item) => item.verified).length}/${managerPresentationResult.keyConclusions.length} · 点击页码回到原文`
                            : `${managerPresentationResult.keyConclusions.filter((item) => item.verified).length}/${managerPresentationResult.keyConclusions.length} traceable · open the source page`}
                        </small>
                      </div>
                      <div className="presentation-key-conclusion-list">
                        {managerPresentationResult.keyConclusions.map((item) => (
                          <article
                            key={item.id}
                            data-testid="presentation-key-conclusion"
                            data-conclusion-id={item.id}
                            data-evidence-text={item.evidenceText}
                            data-page={item.page}
                            data-source-path={item.sourcePath}
                            data-verified={item.verified ? "true" : "false"}
                          >
                            <div>
                              <strong>{item.conclusion}</strong>
                              <small>{item.evidenceText || (zh ? "没有找到可核对的原文" : "No verifiable source excerpt found")}</small>
                              <span
                                className={`presentation-trust-card ${item.trust.status}`}
                                data-testid="presentation-trust-card"
                                data-trust-status={item.trust.status}
                                data-trust-label={item.trust.label}
                                data-trust-icon={item.trust.icon}
                                data-trust-rule={item.trust.evidenceRule}
                                data-trust-rule-satisfied={String(item.trust.ruleSatisfied)}
                                role="group"
                                aria-label={`${item.trust.label}。${item.trust.definition}。建议动作：${item.trust.recommendedAction}`}
                              >
                                <strong><span aria-hidden="true">{item.trust.icon === "check" ? "✓" : item.trust.icon === "question" ? "?" : item.trust.icon === "warning" ? "!" : item.trust.icon === "compare" ? "⇄" : "≈"}</span> {item.trust.label}</strong>
                                <small>{item.trust.definition}</small>
                                <small>{zh ? "建议：" : "Next: "}{item.trust.recommendedAction}</small>
                              </span>
                              {item.citations.map((citation) => (
                                <span
                                  className="presentation-citation"
                                  key={citation.id}
                                  data-testid="presentation-citation"
                                  data-citation-title={citation.title}
                                  data-citation-authors={citation.authors.join(";")}
                                  data-citation-locator={citation.locator}
                                  data-citation-relation={citation.relation}
                                  data-citation-score={citation.supportScore}
                                >
                                  {citation.title} · {citation.authors.join("、")} · {citation.locator} · {citation.relation === "supports" ? (zh ? "支持结论" : "supports") : citation.relation}
                                </span>
                              ))}
                              {item.numericEvidence.map((numeric) => (
                                <span
                                  className={`presentation-numeric-evidence ${numeric.status}`}
                                  key={numeric.id}
                                  data-testid="presentation-numeric-evidence"
                                  data-numeric-id={numeric.id}
                                  data-display-value={numeric.displayValue}
                                  data-reported-value={numeric.reportedValue}
                                  data-recalculated-value={numeric.recalculatedValue}
                                  data-numeric-unit={numeric.unit}
                                  data-numeric-kind={numeric.kind}
                                  data-numeric-status={numeric.status}
                                  data-numeric-formula={numeric.formula}
                                  data-numeric-locator={numeric.locator}
                                  data-source-values={JSON.stringify(numeric.sourceValues)}
                                >
                                  <strong>{numeric.label}：{numeric.displayValue}</strong>
                                  <small>{numeric.formula} · {numeric.status === "verified" ? (zh ? "复算一致" : "recalculated") : (zh ? "无法验证，已明确标记" : "unverifiable, explicitly flagged")}</small>
                                </span>
                              ))}
                              {item.uncertainty ? (
                                <span
                                  className={`presentation-uncertainty ${item.uncertainty.status}`}
                                  data-testid="presentation-uncertainty"
                                  data-uncertainty-status={item.uncertainty.status}
                                  data-requires-qualification={item.uncertainty.requiresQualification ? "true" : "false"}
                                  data-claim-count={item.uncertainty.claims.length}
                                  data-qualifying-language={item.uncertainty.qualifyingLanguage.join(";")}
                                >
                                  <strong>{item.uncertainty.status === "source_conflict" ? (zh ? "来源冲突" : "Source conflict") : item.uncertainty.status === "insufficient_data" ? (zh ? "数据不足" : "Insufficient data") : (zh ? "推测" : "Inference")}：{item.uncertainty.label}</strong>
                                  <small>{item.uncertainty.explanation}</small>
                                  <small>{zh ? "建议：" : "Next: "}{item.uncertainty.recommendedAction}</small>
                                </span>
                              ) : null}
                            </div>
                            <span className="presentation-key-conclusion-actions">
                              <em>{item.verified ? (zh ? "原文已核对" : "Verified") : (zh ? "待核对" : "Unverified")}</em>
                              <button
                                type="button"
                                data-conclusion-source-page={item.page}
                                aria-label={zh ? `查看这条结论的原 PDF 第 ${item.page} 页依据` : `Open evidence for this conclusion on PDF page ${item.page}`}
                                onClick={() => void openSourcePage(item.page)}
                              >
                                p.{item.page}
                              </button>
                            </span>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {managerPresentationResult ? (
                    <section
                      className="presentation-source-review"
                      data-testid="manager-presentation-sources"
                      aria-label={zh ? "演示文稿来源复核" : "Presentation source review"}
                    >
                      <div className="presentation-source-review-heading">
                        <strong>{zh ? "核对原始依据" : "Review original evidence"}</strong>
                        <small>{zh ? "点击页码，在原 PDF 对应页中复核。" : "Open the matching page in the original PDF."}</small>
                      </div>
                      <div className="presentation-source-review-list">
                        {managerPresentationResult.sourceLinks
                          .filter((link) => link.role !== "cover" && link.role !== "sources")
                          .map((link) => (
                            <div className="presentation-source-review-row" key={`${link.slide}:${link.role}`}>
                              <span title={link.title}>{zh ? `第 ${link.slide} 页` : `Slide ${link.slide}`} · {link.title}</span>
                              <span className="presentation-source-page-links">
                                {link.sourcePages.map((page) => (
                                  <button
                                    type="button"
                                    key={`${link.slide}:${page}`}
                                    data-source-page={page}
                                    aria-label={zh ? `打开原 PDF 第 ${page} 页` : `Open source PDF page ${page}`}
                                    onClick={() => void openSourcePage(page)}
                                  >
                                    p.{page}
                                  </button>
                                ))}
                              </span>
                            </div>
                          ))}
                      </div>
                      {sourcePageReview ? (
                        <p
                          className={`presentation-source-review-status ${sourcePageReview.state}`}
                          data-testid="source-page-review-status"
                          data-source-page={sourcePageReview.page}
                          data-opened-page={sourcePageReview.state === "opened" ? sourcePageReview.page : undefined}
                          data-viewer-url={sourcePageReview.viewerUrl}
                          role="status"
                          aria-live="polite"
                        >
                          {sourcePageReview.message}
                        </p>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
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
              <>
                <FilePreview language={language} preview={preview} />
                {preview?.fileHash && preview.content !== undefined && !preview.truncated && ["text", "code", "markdown", "html", "json", "config", "structured", "table"].includes(preview.kind) ? (
                  <section className="files-safe-edit" data-testid="safe-file-edit" data-edit-state={safeEdit?.state || "closed"}>
                    {!safeEdit ? (
                      <button type="button" data-testid="safe-file-edit-open" onClick={beginSafeEdit}>{zh ? "编辑并安全保存" : "Edit with conflict protection"}</button>
                    ) : (
                      <>
                        <header><strong>{zh ? "安全编辑" : "Protected edit"}</strong><small>{zh ? "如果文件被其他程序修改，保存会自动停止。" : "Saving stops automatically if another program changed the file."}</small></header>
                        <textarea data-testid="safe-file-edit-draft" aria-label={zh ? "待保存内容" : "Draft content"} value={safeEdit.draft} onChange={(event) => setSafeEdit((current) => current ? { ...current, draft: event.target.value, state: "editing" } : current)} rows={10} />
                        <div className="files-safe-edit-actions">
                          <button type="button" data-testid="safe-file-edit-save" disabled={safeEdit.state === "saving"} onClick={() => void applySafeEdit("save")}>{zh ? "保存修改" : "Save changes"}</button>
                          <button type="button" onClick={() => setSafeEdit(null)}>{zh ? "关闭编辑" : "Close editor"}</button>
                        </div>
                        <p role="status" data-testid="safe-file-edit-status" data-state={safeEdit.state}>{safeEdit.message}</p>
                        {safeEdit.state === "conflict" && safeEdit.conflict ? (
                          <section className="files-external-conflict" data-testid="external-file-conflict" data-expected-hash={safeEdit.conflict.expectedHash} data-current-hash={safeEdit.conflict.currentHash}>
                            <header><AlertTriangle size={16} /><div><strong>{zh ? "文件已被其他程序修改" : "Another program changed this file"}</strong><small>{zh ? "为避免丢失外部内容，本次写入已停止。" : "This write was stopped so the external content is not lost."}</small></div></header>
                            <dl><div><dt>{zh ? "读取时版本" : "Version read"}</dt><dd>{safeEdit.conflict.expectedHash.slice(0, 20)}…</dd></div><div><dt>{zh ? "当前外部版本" : "Current external version"}</dt><dd>{safeEdit.conflict.currentHash.slice(0, 20)}…</dd></div></dl>
                            <div className="files-external-conflict-actions">
                              <button type="button" data-testid="external-conflict-reload" onClick={() => void reloadExternalVersion()}>{zh ? "重新读取" : "Reload"}</button>
                              <button type="button" data-testid="external-conflict-save-as" onClick={() => void applySafeEdit("save_as")}>{zh ? "另存为我的版本" : "Save as my version"}</button>
                              <button type="button" data-testid="external-conflict-manual" onClick={() => setSafeEdit((current) => current ? { ...current, manualChoice: true } : current)}>{zh ? "人工选择" : "Choose manually"}</button>
                            </div>
                            {safeEdit.manualChoice ? (
                              <section className="files-external-manual-choice" data-testid="external-conflict-manual-choice">
                                <strong>{zh ? "选择最终保留方式" : "Choose what to keep"}</strong>
                                <p>{zh ? "保留外部版本会重新载入最新内容；明确覆盖只会在当前哈希仍未变化时执行。" : "Keeping the external version reloads it; overwrite runs only if its latest hash still matches."}</p>
                                <button type="button" data-testid="external-conflict-keep-external" onClick={() => void reloadExternalVersion()}>{zh ? "保留外部版本" : "Keep external version"}</button>
                                <button type="button" data-testid="external-conflict-overwrite" onClick={() => void applySafeEdit("overwrite")}>{zh ? "明确覆盖外部版本" : "Explicitly overwrite external version"}</button>
                              </section>
                            ) : null}
                          </section>
                        ) : null}
                      </>
                    )}
                  </section>
                ) : null}
              </>
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
          {nextOffset !== null ? <button type="button" className="files-context-load-more" onClick={() => void loadMore()}>{zh ? "加载更多" : "Load more"}</button> : null}
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
            <section className="files-checkpoint-panel" aria-label={zh ? "智能体变更审阅" : "Agent change set review"}>
              <div className="files-checkpoint-header">
                <div>
                  <strong>{zh ? "智能体变更待审阅" : "Agent changes awaiting review"}</strong>
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
            onRestore={(checkpoint, includePaths) => void restoreRollbackCheckpoint(checkpoint, includePaths)}
            onOpenVersion={(checkpoint) => void openCheckpointVersion(checkpoint)}
            onContinueQuestion={(checkpoint) => onPrepareTask(zh
              ? `继续询问版本 V${checkpoint.versionNumber || "?"}（${checkpoint.objectLabel || checkpoint.label}，${checkpoint.versionPhase === "before" ? "修改前" : "修改后"}）：请结合该版本的修改原因“${checkpoint.changeReason || "自动记录成果变化"}”回答：`
              : `Continue asking about version V${checkpoint.versionNumber || "?"} (${checkpoint.objectLabel || checkpoint.label}, ${checkpoint.versionPhase === "before" ? "before" : "after"}): Use its change reason “${checkpoint.changeReason || "automatic result change"}” to answer: `)}
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
          title={zh ? "智能体操作记录" : "Agent Trace"}
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

function failureKindLabel(kind: DesktopFailureKind, zh: boolean): string {
  const labels: Record<DesktopFailureKind, [string, string]> = {
    external_service: ["服务异常", "Service unavailable"],
    disk_full: ["磁盘空间不足", "Disk full"],
    permission_denied: ["权限不足", "Permission denied"],
    file_busy: ["文件被占用", "File in use"],
    model_timeout: ["模型超时", "Model timeout"],
    network: ["网络异常", "Network error"],
    unexpected: ["未预期错误", "Unexpected error"],
  };
  return labels[kind][zh ? 0 : 1];
}

type ManagerBusinessStageId = "understand_material" | "organize_story" | "create_deck" | "check_result" | "ready";

function compareAudienceResults(
  manager?: ManagerPresentationGenerateResult,
  technical?: ManagerPresentationGenerateResult,
): { passed: boolean; sharedFacts: number; managerImpact: number; technicalDetails: number; contentDistinct: boolean } | null {
  if (!manager || !technical) return null;
  const managerFacts = [...manager.audienceProfile.goldenFactIds].sort();
  const technicalFacts = [...technical.audienceProfile.goldenFactIds].sort();
  const sharedFacts = managerFacts.filter((fact) => technicalFacts.includes(fact)).length;
  const factsIdentical = managerFacts.length === 5 && JSON.stringify(managerFacts) === JSON.stringify(technicalFacts);
  const contentDistinct = manager.audienceProfile.contentHash !== technical.audienceProfile.contentHash;
  const audienceDifference = manager.audienceProfile.impactDecisionSignals > technical.audienceProfile.impactDecisionSignals
    && technical.audienceProfile.technicalDetailSignals > manager.audienceProfile.technicalDetailSignals
    && technical.audienceProfile.acronymOccurrences > manager.audienceProfile.acronymOccurrences;
  return {
    passed: factsIdentical && contentDistinct && audienceDifference,
    sharedFacts,
    managerImpact: manager.audienceProfile.impactDecisionSignals,
    technicalDetails: technical.audienceProfile.technicalDetailSignals,
    contentDistinct,
  };
}

function selectPresentationKeyNumbers(
  items: Array<{ text: string; page: number }>,
): Array<{ text: string; page: number }> {
  const score = (text: string): number =>
    Number(/to be confirmed|uncertain|待确认/i.test(text)) * 8
    + Number(/HL-LHC/i.test(text)) * 5
    + Number(/factor|times?/i.test(text)) * 4
    + Number(/Tbps|Gbps|PB|GB\/s/i.test(text)) * 3
    + Number(/%/.test(text)) * 3
    + Number(/20\d{2}/.test(text));
  return items
    .map((item, index) => ({ item, index, score: score(item.text) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 8)
    .map(({ item }) => item);
}

function getManagerBusinessProgress(
  progress: ManagerPresentationProgressEvent,
  language: AppLanguage,
): {
  id: ManagerBusinessStageId;
  title: string;
  nextAction: string;
  stages: Array<{ id: Exclude<ManagerBusinessStageId, "ready">; label: string; state: "done" | "current" | "upcoming" }>;
} {
  const zh = language === "zh";
  const effectivePhase = ["pausing", "paused", "resuming", "cancelling", "cancelled", "failed", "interrupted"].includes(progress.phase)
    ? progress.activeStage ?? "analyzing"
    : progress.phase;
  const id: ManagerBusinessStageId = progress.phase === "completed"
    ? "ready"
    : effectivePhase === "planning"
      ? "organize_story"
      : effectivePhase === "generating"
        ? "create_deck"
        : effectivePhase === "validating"
          ? "check_result"
          : "understand_material";
  const copy: Record<ManagerBusinessStageId, { title: string; nextAction: string }> = {
    understand_material: {
      title: zh ? "正在理解材料" : "Understanding the material",
      nextAction: zh ? "提炼重点并组织管理者故事线。" : "Extract the key points and organize the management story.",
    },
    organize_story: {
      title: zh ? "正在组织重点" : "Organizing the key points",
      nextAction: zh ? "按照故事线制作可编辑演示文稿。" : "Create an editable deck from the story.",
    },
    create_deck: {
      title: zh ? "正在制作演示文稿" : "Creating the presentation",
      nextAction: zh ? "检查页数、讲稿、来源和文件结构。" : "Check pages, notes, sources, and file structure.",
    },
    check_result: {
      title: zh ? "正在检查成果" : "Checking the result",
      nextAction: zh ? "检查通过后提供可打开的最终成果。" : "Provide the final result after checks pass.",
    },
    ready: {
      title: zh ? "成果已就绪" : "Result ready",
      nextAction: zh ? "打开成果并查看完成摘要。" : "Open the result and review the completion summary.",
    },
  };
  const stageDefinitions: Array<{ id: Exclude<ManagerBusinessStageId, "ready">; label: string }> = [
    { id: "understand_material", label: zh ? "理解材料" : "Understand material" },
    { id: "organize_story", label: zh ? "组织重点" : "Organize key points" },
    { id: "create_deck", label: zh ? "制作演示文稿" : "Create presentation" },
    { id: "check_result", label: zh ? "检查成果" : "Check result" },
  ];
  const currentRank = id === "ready" ? stageDefinitions.length : stageDefinitions.findIndex((stage) => stage.id === id);
  return {
    id,
    ...copy[id],
    stages: stageDefinitions.map((stage, index) => ({
      ...stage,
      state: index < currentRank ? "done" : index === currentRank ? "current" : "upcoming",
    })),
  };
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
  onOpenVersion,
  onContinueQuestion,
}: {
  checkpoints: WorkspaceCheckpoint[];
  language: AppLanguage;
  message: string;
  preview: WorkspaceCheckpointPreviewResult | null;
  onCreate: () => void;
  onPreview: (checkpoint: WorkspaceCheckpoint) => void;
  onRefresh: () => void;
  onRestore: (checkpoint: WorkspaceCheckpoint, includePaths?: string[]) => void;
  onOpenVersion: (checkpoint: WorkspaceCheckpoint) => void;
  onContinueQuestion: (checkpoint: WorkspaceCheckpoint) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const entryLabel = (path: string): string => {
    if (/\.provenance\.json$/i.test(path)) return zh ? "来源记录" : "source record";
    if (/\.pptx$/i.test(path)) return zh ? "演示文稿" : "presentation";
    return path.split(/[\\/]/).pop() || path;
  };
  const versions = checkpoints.filter((checkpoint) => checkpoint.automatic && checkpoint.versionGroupId);
  const rollbackPoints = checkpoints.filter((checkpoint) => !checkpoint.automatic);
  return (
    <section className="files-checkpoint-panel" aria-label={zh ? "自动版本历史" : "Automatic version history"} data-testid="workspace-version-history">
      <div className="files-checkpoint-header">
        <div>
          <span>
            <History size={13} />
            {zh ? "版本历史" : "Version history"}
          </span>
          <small>
            {zh ? "每次实质修改都会自动保存修改前后版本，无需手动操作。" : "Versions before and after material changes are saved automatically."}
          </small>
        </div>
        <div className="files-checkpoint-actions">
          <button type="button" onClick={onRefresh} data-testid="refresh-version-history">
            {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>
      {message ? <p className="files-checkpoint-message" data-testid="version-action-message" data-version-opened={message.startsWith(zh ? "已打开" : "Opened this version")}>{message}</p> : null}
      {versions.length === 0 ? (
        <p className="files-checkpoint-empty">
          {zh ? "还没有自动版本。完成一次成果生成或修改后，修改前后版本会出现在这里。" : "No automatic versions yet. Before and after versions appear after a result is generated or changed."}
        </p>
      ) : (
        <ol className="files-checkpoint-list" data-testid="automatic-version-list">
          {versions.slice(0, 8).map((checkpoint) => {
            const beforeVersion = checkpoint.versionPhase === "after"
              ? versions.find((item) => item.versionGroupId === checkpoint.versionGroupId && item.versionPhase === "before")
              : undefined;
            return <li key={checkpoint.id} data-version-phase={checkpoint.versionPhase} data-version-group={checkpoint.versionGroupId} data-version-number={checkpoint.versionNumber}>
              <div>
                <strong>{checkpoint.versionPhase === "before" ? (zh ? "修改前" : "Before change") : (zh ? "修改后" : "After change")} · {checkpoint.objectLabel || checkpoint.label}</strong>
                <small>
                  V{checkpoint.versionNumber || "?"} · {new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.storedFileCount}/{checkpoint.changedFileCount} {zh ? "个文件已保存" : "files saved"}
                </small>
                <p>{zh ? "修改原因" : "Reason"}：{checkpoint.changeReason || (zh ? "自动记录成果变化" : "Automatic result change")}</p>
                {checkpoint.lastRestoreMode === "partial" && checkpoint.lastRestoredPaths?.length ? (
                  <p data-testid="partial-restore-status">
                    {zh ? "最近局部撤销" : "Latest partial undo"}：{checkpoint.lastRestoredPaths.map(entryLabel).join("、")}
                    {zh ? "；其他修改保持不变" : "; other changes stayed unchanged"}
                  </p>
                ) : null}
              </div>
              <div className="files-checkpoint-row-actions">
                <button type="button" onClick={() => onPreview(checkpoint)} data-testid="compare-version">
                  {zh ? "比较当前版本" : "Compare with current"}
                </button>
                <button type="button" onClick={() => onOpenVersion(checkpoint)} disabled={!checkpoint.entries.some((entry) => entry.stored && entry.versionPath)} data-testid="open-version">
                  {zh ? "打开此版" : "Open version"}
                </button>
                <button type="button" onClick={() => onRestore(checkpoint)} data-testid="restore-version">
                  {zh ? "恢复此版" : "Restore version"}
                </button>
                <button type="button" onClick={() => onContinueQuestion(checkpoint)} data-testid="continue-version-question">
                  {zh ? "继续询问此版" : "Ask about this version"}
                </button>
                {beforeVersion ? (
                  <>
                    {beforeVersion.entries.map((entry) => (
                      <button
                        type="button"
                        key={`partial-${entry.relativePath}`}
                        onClick={() => onRestore(beforeVersion, [entry.relativePath])}
                        data-testid="restore-version-entry"
                        data-restore-path={entry.relativePath}
                      >
                        {zh ? `仅撤销${entryLabel(entry.relativePath)}` : `Undo only ${entryLabel(entry.relativePath)}`}
                      </button>
                    ))}
                    <button type="button" onClick={() => onRestore(beforeVersion)} data-testid="restore-version-group">
                      {zh ? "整体回到修改前" : "Undo the whole change"}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          })}
        </ol>
      )}
      <details className="files-checkpoint-technical">
        <summary>{zh ? `安全回滚点（${rollbackPoints.length}）` : `Safety rollback points (${rollbackPoints.length})`}</summary>
        <button type="button" onClick={onCreate}>{zh ? "手动创建安全点" : "Create safety point"}</button>
      </details>
      {preview ? (
        <div className="files-checkpoint-preview" aria-label={zh ? "版本差异" : "Version difference"} data-testid="version-diff-preview" data-changed-entry-count={preview.changedEntryCount} data-total-entry-count={preview.totalEntries}>
          <div className="files-checkpoint-preview-header">
            <strong>{zh ? "与当前版本的差异" : "Difference from current version"}</strong>
            <small>
              {preview.changedEntryCount} {zh ? "项变化" : "changed"} / {preview.totalEntries}
              {preview.truncated ? (zh ? " · 内容已截断" : " · truncated") : ""}
            </small>
          </div>
          <ol>
            {preview.entries.map((entry) => (
              <li key={`${preview.checkpointId}:${entry.relativePath}`} data-checkpoint-id={preview.checkpointId} data-version-path={entry.relativePath}>
                <div>
                  <strong>{entry.relativePath}</strong>
                  <small>
                    {formatVersionChange(entry.change, zh)} · {formatVersionFileStatus(entry.checkpointStatus, zh)}
                    {entry.currentSize != null ? (zh ? ` · 当前 ${entry.currentSize} 字节` : ` · current ${entry.currentSize} bytes`) : ""}
                  </small>
                  <p>{entry.change === "unchanged" ? (zh ? "与当前版本一致" : "Matches current version") : (zh ? "与当前版本不同" : "Differs from current version")}</p>
                </div>
                <details>
                  <summary>{zh ? "查看修改前后内容" : "View before and after content"}</summary>
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

function formatVersionChange(change: WorkspaceCheckpointPreviewResult["entries"][number]["change"], zh: boolean): string {
  const labels = zh
    ? { added: "新增", modified: "已修改", deleted: "已删除", unchanged: "无变化", skipped: "未纳入版本" }
    : { added: "Added", modified: "Modified", deleted: "Deleted", unchanged: "Unchanged", skipped: "Not included" };
  return labels[change];
}

function formatVersionFileStatus(status: WorkspaceCheckpointPreviewResult["entries"][number]["checkpointStatus"], zh: boolean): string {
  if (zh) return status === "untracked" ? "生成成果" : status === "deleted" ? "当时不存在" : "已保存成果";
  return status === "untracked" ? "Generated result" : status === "deleted" ? "Absent at that time" : "Saved result";
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
