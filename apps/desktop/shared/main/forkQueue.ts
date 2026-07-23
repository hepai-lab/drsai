import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  DesktopForkConflictDraftWriteRequest,
  DesktopForkConflictDraftWriteResult,
  DesktopForkQueueAgentAssignment,
  DesktopForkQueueDispatchRequest,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalRequest,
  DesktopForkQueueStatus,
  DesktopThread,
} from "../api/desktopApi";
import { listThreads, updateThread } from "./threads";
import { getWorkspaceGitDiff, previewWorkspaceFile } from "./workspaceContext";
import { writeWorkspaceFile } from "./workspaceFileMutations";

const MAX_QUEUE_SIZE = 12;
const MAX_DRAFT_CHARS = 500_000;

export interface ForkQueueDispatchDependencies {
  assertWorkspaceAllowed(path: string): Promise<void>;
  startRun(request: Record<string, unknown>): Promise<{ requestId: string; runId: string }>;
  now?: () => Date;
}

export function normalizeForkQueueStartRequest(raw: unknown): DesktopForkQueueStartApprovalRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const values = (raw as { threadIds?: unknown }).threadIds;
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_QUEUE_SIZE) return null;
  const threadIds = values.map((value) => typeof value === "string" ? value.trim() : "");
  if (threadIds.some((value) => !value || value.length > 160) || new Set(threadIds).size !== values.length) return null;
  return { threadIds };
}

export function normalizeForkQueueDispatchRequest(raw: unknown): DesktopForkQueueDispatchRequest | null {
  const start = normalizeForkQueueStartRequest(raw);
  if (!start || !raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  return {
    threadIds: start.threadIds,
    selectedAgentId: cleanText(source.selectedAgentId, 120),
    selectedAgentName: cleanText(source.selectedAgentName, 160),
    model: cleanText(source.model, 160),
    threadAgentAssignments: normalizeAssignments(source.threadAgentAssignments, start.threadIds),
  };
}

export async function updateForkQueueThreads(
  threadIds: string[],
  queueStatus: DesktopForkQueueStatus,
  queueMessage: string,
  options: { approvalId?: string; now?: Date } = {},
): Promise<DesktopThread[]> {
  const all = await listThreads();
  const updated: DesktopThread[] = [];
  for (const threadId of threadIds) {
    const thread = all.find((candidate) => candidate.id === threadId);
    if (!thread?.fork) continue;
    updated.push(await updateThread({
      id: thread.id,
      status: queueStatus === "running" ? "running" : thread.status,
      fork: {
        ...thread.fork,
        queueStatus,
        queueMessage,
        queueUpdatedAt: (options.now ?? new Date()).toISOString(),
        ...(options.approvalId ? { queueApprovalId: options.approvalId } : {}),
      },
    }));
  }
  return updated;
}

export async function dispatchForkQueue(
  raw: unknown,
  dependencies: ForkQueueDispatchDependencies,
): Promise<DesktopForkQueueDispatchResult> {
  const request = normalizeForkQueueDispatchRequest(raw);
  if (!request) return blockedDispatch([], [], "Fork queue dispatch request is incomplete.");
  const all = await listThreads();
  const threads = request.threadIds.map((id) => all.find((thread) => thread.id === id)).filter((thread): thread is DesktopThread => Boolean(thread?.fork));
  if (threads.length !== request.threadIds.length) return blockedDispatch(threads, request.threadIds, "Fork queue dispatch requires existing fork threads.");
  const notReady = threads.filter((thread) => thread.fork?.queueStatus !== "ready");
  if (notReady.length) {
    const blocked = await updateForkQueueThreads(notReady.map((thread) => thread.id), "blocked", "Fork queue dispatch was blocked because the queue is not approved and ready.");
    return blockedDispatch(blocked, notReady.map((thread) => thread.id), "Only approved ready fork queue threads can be dispatched.");
  }

  const startedRuns: DesktopForkQueueDispatchResult["startedRuns"] = [];
  const blockedThreadIds: string[] = [];
  const updatedThreads: DesktopThread[] = [];
  for (const thread of threads) {
    const fork = thread.fork!;
    try {
      await dependencies.assertWorkspaceAllowed(fork.sourceWorkspacePath);
      const assignment = resolveAssignment(thread, request);
      const [running] = await updateForkQueueThreads([thread.id], "running", assignment.agentName
        ? `Fork queue subtask is running in its isolated worktree. Assigned agent: ${assignment.agentName}.`
        : "Fork queue subtask is running in its isolated worktree.", { now: dependencies.now?.() });
      if (running) updatedThreads.push(running);
      const started = await dependencies.startRun({
        threadId: thread.id,
        sessionId: thread.id,
        runId: `fork-queue-${(dependencies.now?.() ?? new Date()).getTime()}-${thread.id}`,
        task: buildDispatchTask(thread, assignment),
        workspacePath: fork.worktreePath,
        model: request.model,
        metadata: {
          runtime_mode: { name: "fork", intent: thread.title, activated_by: "fork_queue_dispatch" },
          fork_queue_dispatch: true,
          fork_queue_group_id: fork.queueGroupId,
          fork_queue_index: fork.queueIndex,
          fork_queue_size: fork.queueSize,
          selected_agent_id: assignment.agentId,
          selected_agent_name: assignment.agentName,
          source_workspace_path: fork.sourceWorkspacePath,
          isolated_worktree_path: fork.worktreePath,
        },
      });
      startedRuns.push({ threadId: thread.id, requestId: started.requestId, runId: started.runId });
    } catch (error) {
      blockedThreadIds.push(thread.id);
      const blocked = await updateForkQueueThreads([thread.id], "blocked", `Fork queue dispatch failed to start: ${safeError(error)}`);
      for (const finalThread of blocked) {
        const staleIndex = updatedThreads.findIndex((candidate) => candidate.id === finalThread.id);
        if (staleIndex >= 0) updatedThreads[staleIndex] = finalThread;
        else updatedThreads.push(finalThread);
      }
    }
  }
  return { startedRuns, threads: updatedThreads, blockedThreadIds, reason: startedRuns.length ? `Dispatched ${startedRuns.length} fork queue subtask${startedRuns.length === 1 ? "" : "s"}.` : "No fork queue subtasks were dispatched." };
}

export function normalizeForkConflictDraftRequest(raw: unknown): DesktopForkConflictDraftWriteRequest {
  if (!raw || typeof raw !== "object") throw new Error("Fork conflict draft write request is invalid.");
  const value = raw as Record<string, unknown>;
  const threadId = cleanText(value.threadId, 160);
  const workspacePath = cleanText(value.workspacePath, 2_048);
  const path = cleanText(value.path, 2_048);
  const expectedDiffHash = cleanText(value.expectedDiffHash, 80);
  if (!threadId || !workspacePath || !path || !expectedDiffHash || typeof value.draft !== "string") throw new Error("Fork conflict draft write request is incomplete.");
  if (value.draft.length > MAX_DRAFT_CHARS) throw new Error("Resolved draft is too large for inline write-back.");
  if (value.draft.includes("\0")) throw new Error("Resolved draft contains invalid null bytes.");
  if (!/^sha256:[a-f0-9]{64}$/i.test(expectedDiffHash)) throw new Error("Reviewed diff hash is invalid.");
  return { threadId, workspacePath, path, draft: value.draft, expectedDiffHash };
}

export async function validateForkConflictDraft(
  raw: unknown,
  assertWorkspaceAllowed: (path: string) => Promise<void>,
): Promise<DesktopForkConflictDraftWriteRequest> {
  const request = normalizeForkConflictDraftRequest(raw);
  const thread = (await listThreads()).find((candidate) => candidate.id === request.threadId);
  if (!thread?.fork) throw new Error("Fork conflict draft target thread no longer exists.");
  if (thread.fork.lifecycleStatus !== "merge_pending") throw new Error("Fork conflict draft write-back is only available during merge recovery.");
  const [sourceRoot, requestedRoot] = await Promise.all([realpath(resolve(thread.fork.sourceWorkspacePath)), realpath(resolve(request.workspacePath))]);
  if (normalizePath(sourceRoot) !== normalizePath(requestedRoot)) throw new Error("Fork conflict draft workspace does not match the source workspace.");
  await assertWorkspaceAllowed(requestedRoot);
  const candidate = isAbsolute(request.path) ? resolve(request.path) : resolve(requestedRoot, request.path);
  const lexicalPath = relative(requestedRoot, candidate);
  if (!lexicalPath || lexicalPath.startsWith("..") || isAbsolute(lexicalPath)) throw new Error("Fork conflict draft path escapes the source workspace.");
  let target: string;
  try { target = await realpath(candidate); }
  catch { throw new Error("Fork conflict draft write-back requires an existing source file."); }
  const safePath = relative(requestedRoot, target);
  if (!safePath || safePath.startsWith("..") || isAbsolute(safePath)) throw new Error("Fork conflict draft path escapes the source workspace.");
  const normalized = { ...request, workspacePath: requestedRoot, path: safePath.replace(/\\/g, "/") };
  await assertReviewedDiff(normalized, "review");
  return normalized;
}

export async function executeForkConflictDraftWrite(request: DesktopForkConflictDraftWriteRequest): Promise<DesktopForkConflictDraftWriteResult> {
  await assertReviewedDiff(request, "approval");
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, maxBytes: 8_000 });
  if (!preview.fileHash) throw new Error("Conflict draft target does not provide a verifiable file hash.");
  const result = await writeWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, content: request.draft, expectedHash: preview.fileHash, mode: "save" });
  if (result.status !== "saved") throw new Error("Conflict draft target changed before the atomic write completed.");
  return { threadId: request.threadId, workspacePath: request.workspacePath, path: request.path, written: true, message: "Resolved draft was written atomically. Review the new diff before staging." };
}

function normalizeAssignments(raw: unknown, ids: string[]): Record<string, DesktopForkQueueAgentAssignment> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const allowed = new Set(ids); const entries: Array<[string, DesktopForkQueueAgentAssignment]> = [];
  for (const [id, item] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(id) || !item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>; const agentId = cleanText(value.agentId, 120); const agentName = cleanText(value.agentName, 160);
    if (agentId || agentName) entries.push([id, { agentId, agentName }]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}
function cleanText(value: unknown, max: number): string | undefined { return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) || undefined : undefined; }
function resolveAssignment(thread: DesktopThread, request: DesktopForkQueueDispatchRequest): DesktopForkQueueAgentAssignment { const explicit = request.threadAgentAssignments?.[thread.id]; return { agentId: explicit?.agentId ?? thread.fork?.queueAgentId ?? request.selectedAgentId, agentName: explicit?.agentName ?? thread.fork?.queueAgentName ?? request.selectedAgentName }; }
function buildDispatchTask(thread: DesktopThread, assignment: DesktopForkQueueAgentAssignment): string { const fork = thread.fork!; return [`Subtask: ${thread.title}`, "Execute this approved fork queue subtask inside its isolated worktree.", fork.queueIndex && fork.queueSize ? `Queue position: ${fork.queueIndex}/${fork.queueSize}` : "", assignment.agentName ? `Assigned agent: ${assignment.agentName}` : "", fork.queueAgentHint && !assignment.agentName ? `Requested agent hint: ${fork.queueAgentHint}` : "", `Source workspace for review only: ${fork.sourceWorkspacePath}`, `Writable isolated worktree: ${fork.worktreePath}`, "Before coding, write a concise design plan in the agent run. Then implement, test, verify, and report completion or blockers."].filter(Boolean).join("\n"); }
function blockedDispatch(threads: DesktopThread[], blockedThreadIds: string[], reason: string): DesktopForkQueueDispatchResult { return { startedRuns: [], threads, blockedThreadIds, reason }; }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 240); }
function normalizePath(path: string): string { return process.platform === "win32" ? path.toLowerCase() : path; }
async function assertReviewedDiff(request: DesktopForkConflictDraftWriteRequest, phase: "review" | "approval"): Promise<void> { const diff = await getWorkspaceGitDiff({ workspacePath: request.workspacePath, path: request.path, maxChars: 300_000 }); if (diff.diffHash !== request.expectedDiffHash) throw new Error(`File diff changed since ${phase}; reload before writing the resolved draft.`); }
