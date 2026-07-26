import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { IpcMain } from "electron";
import type { DesktopForkLifecycleApprovalRequest, DesktopForkQueueStartApprovalResult, DesktopShellCommandApprovalRequest, DesktopThread } from "../../../../shared/api";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import { executeForkLifecycleAction } from "../../../../shared/main/forkLifecycle";
import { dispatchForkQueue, executeForkConflictDraftWrite, normalizeForkQueueStartRequest, updateForkQueueThreads, validateForkConflictDraft } from "../../../../shared/main/forkQueue";
import { executeLocalGitCommit, gitCommitApprovalIdempotencyKey, normalizeGitCommitApprovalRequest } from "../../../../shared/main/gitCommit";
import { importMcpContext } from "../../../../shared/main/mcpContext";
import { cancelMcpActiveSession, closeMcpReusableSession, listMcpActiveSessions, listMcpReusableSessions, listMcpSessionAudits, listMcpToolExecutionAudits } from "../../../../shared/main/mcpLiveBridge";
import { startAgentRun } from "../../../../shared/main/agentRuns";
import { listThreads, updateThread } from "../../../../shared/main/threads";
import { listRuntimeWorktrees } from "../../../../shared/main/worktrees";
import { writeTerminalSession } from "../terminal";
import type { MacosServiceContainer } from "../serviceContainer";

export interface MacosTrustIpcDependencies {
  requestMcpEnumeration(raw: unknown): Promise<unknown>;
  requestMcpExecution(raw: unknown): Promise<unknown>;
}

export function registerMacosTrustIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace" | "approvals">,
  dependencies: MacosTrustIpcDependencies,
): void {
  const roots = () => services.workspace.allowedRoots();
  const assertWorkspace = async (path: unknown): Promise<void> => { assertAllowedDesktopPath(path, await roots(), { directory: true }); };
  const assertManagedFork = async (thread: DesktopThread): Promise<void> => {
    const fork = thread.fork; if (!fork?.worktreeId || !fork.sourceWorkspaceId || !fork.workspaceId) throw new Error("Fork thread is missing Runtime ownership identifiers.");
    await assertWorkspace(fork.sourceWorkspacePath);
    const owned = (await listRuntimeWorktrees({ workspacePath: fork.sourceWorkspacePath, workspaceId: fork.sourceWorkspaceId })).find((item) => item.worktreeId === fork.worktreeId && item.workspaceId === fork.workspaceId && item.sourceWorkspaceId === fork.sourceWorkspaceId && item.status === "active");
    if (!owned || await realpath(owned.canonicalPath) !== await realpath(fork.worktreePath)) throw new Error("Fork worktree is not an active Runtime-managed path.");
  };

  ipcMain.handle("desktop:propose-approval", (_event, request) => services.approvals.propose(request));
  ipcMain.handle("desktop:pending-approvals", () => services.approvals.list());
  ipcMain.handle("desktop:decide-approval", (_event, request) => services.approvals.decide(request));
  ipcMain.handle("desktop:shell-command-approval", (event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Shell command approval request must be an object.");
    const request = rawRequest as DesktopShellCommandApprovalRequest;
    if (typeof request.terminalSessionId !== "string" || !request.terminalSessionId.trim() || request.terminalSessionId.length > 200 || typeof request.commandId !== "string" || !request.commandId.trim() || request.commandId.length > 200 || typeof request.command !== "string" || !request.command.trim() || request.command.length > 4_000 || typeof request.invocation !== "string" || !request.invocation.trim() || request.invocation.length > 16_000) throw new Error("Shell command approval request is incomplete or exceeds its limit.");
    return services.approvals.propose({ source: "shell", actionKind: "shell.command", title: "Run shell command", detail: request.command.trim(), target: request.terminalSessionId.trim(), risk: request.risk, idempotencyKey: `terminal:${request.terminalSessionId.trim()}:${request.commandId.trim()}` }, async () => writeTerminalSession(event, request.terminalSessionId.trim(), request.invocation));
  });
  ipcMain.handle("desktop:git-commit-approval", async (_event, rawRequest) => {
    const request = normalizeGitCommitApprovalRequest(rawRequest); const allowed = await roots();
    assertAllowedDesktopPath(request.workspacePath, allowed, { directory: true });
    return services.approvals.propose({ source: "git", actionKind: "git.commit", title: "Create git commit", detail: request.body ? `git commit -m ${request.message}\n\n${request.body}` : `git commit -m ${request.message}`, target: request.workspacePath, risk: "high", checklist: request.checklist, idempotencyKey: gitCommitApprovalIdempotencyKey(request) }, (approval) => executeLocalGitCommit(request, allowed, approval.id));
  });
  ipcMain.handle("desktop:fork-lifecycle-approval", async (_event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Fork lifecycle approval request must be an object.");
    const request = rawRequest as Partial<DesktopForkLifecycleApprovalRequest>;
    if (typeof request.threadId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(request.threadId) || (request.action !== "merge_back" && request.action !== "discard")) throw new Error("Fork lifecycle approval request is incomplete.");
    const thread = (await listThreads()).find((item) => item.id === request.threadId);
    if (!thread?.fork || thread.fork.lifecycleStatus === "closed") throw new Error("Fork lifecycle approval requires an open fork thread.");
    await assertManagedFork(thread); const action = request.action;
    return services.approvals.propose({ source: "fork", actionKind: "fork.lifecycle", title: `Review fork ${action === "merge_back" ? "merge back" : "discard"}`, detail: `${action === "merge_back" ? "Merge the fork branch into its source workspace." : "Remove the managed worktree while retaining unmerged work."}\nBranch: ${thread.fork.branch}\nSource: ${thread.fork.sourceWorkspacePath}\nWorktree: ${thread.fork.worktreePath}`, target: thread.fork.worktreePath, risk: "high", idempotencyKey: `fork-lifecycle:${thread.id}:${action}:${thread.fork.lifecycleStatus}` }, async () => {
      const current = (await listThreads()).find((item) => item.id === thread.id); if (!current?.fork || current.fork.lifecycleStatus === "closed") return false;
      const pending = await updateThread({ id: current.id, fork: { ...current.fork, lifecycleStatus: action === "merge_back" ? "merge_pending" : "cleanup_pending", lifecycleUpdatedAt: new Date().toISOString(), lifecycleMessage: "Approved lifecycle action is running." } });
      const result = await executeForkLifecycleAction(pending.fork!, action); await updateThread({ id: current.id, fork: { ...pending.fork!, ...result } }); return true;
    });
  });
  ipcMain.handle("desktop:fork-queue-start-approval", async (_event, rawRequest): Promise<DesktopForkQueueStartApprovalResult> => {
    const request = normalizeForkQueueStartRequest(rawRequest); if (!request) return { queued: false, threads: [], allowed: false, blocked: true, reason: "Fork queue start approval request is incomplete." };
    const all = await listThreads(); const threads = request.threadIds.map((id) => all.find((thread) => thread.id === id)).filter((thread): thread is NonNullable<typeof thread> => Boolean(thread?.fork));
    if (threads.length !== request.threadIds.length) return { queued: false, threads, allowed: false, blocked: true, reason: "Fork queue start approval requires existing fork threads." };
    if (threads.some((thread) => thread.fork?.lifecycleStatus === "closed")) return { queued: false, threads, allowed: false, blocked: true, reason: "Closed fork threads cannot be queued for agent dispatch." };
    const source = threads[0]!.fork!.sourceWorkspacePath; const allowed = await roots(); assertAllowedDesktopPath(source, allowed, { directory: true });
    if (threads.some((thread) => thread.fork!.sourceWorkspacePath !== source)) return { queued: false, threads, allowed: false, blocked: true, reason: "A fork queue must use one source workspace." };
    for (const thread of threads) await assertManagedFork(thread);
    const proposal = await services.approvals.propose({ source: "fork", actionKind: "fork.queue_start", title: `Start fork queue (${threads.length})`, detail: ["Approve marking these isolated fork subtasks ready for explicit Agent dispatch.", ...threads.map((thread, index) => `${index + 1}. ${thread.title}\nBranch: ${thread.fork!.branch}\nWorktree: ${thread.fork!.worktreePath}`)].join("\n\n"), target: source, risk: "high", idempotencyKey: `fork-queue-start:${request.threadIds.join(":")}` }, async () => { await updateForkQueueThreads(request.threadIds, "ready", "Fork queue start approved; subtasks are ready for explicit Agent dispatch."); return true; }, async (approved) => { if (!approved) await updateForkQueueThreads(request.threadIds, "blocked", "Fork queue start was rejected in Approval Center."); });
    if (proposal.blocked || !proposal.allowed) return { queued: false, threads, allowed: proposal.allowed, blocked: proposal.blocked, reason: proposal.reason };
    if (proposal.queued && proposal.approval) { const waiting = await updateForkQueueThreads(request.threadIds, "waiting_approval", `Queue start is waiting in Approval Center: ${proposal.approval.title}.`, { approvalId: proposal.approval.id }); return { queued: true, approval: proposal.approval, threads: waiting, allowed: true, blocked: false, reason: proposal.reason }; }
    return { queued: false, threads: await updateForkQueueThreads(request.threadIds, "ready", "Fork queue start was already approved; subtasks are ready for explicit Agent dispatch."), allowed: true, blocked: false, reason: "Fork queue is ready for explicit Agent dispatch." };
  });
  ipcMain.handle("desktop:fork-queue-dispatch", (event, request) => dispatchForkQueue(request, { assertWorkspaceAllowed: assertWorkspace, assertForkAllowed: assertManagedFork, startRun: (runRequest) => startAgentRun(event.sender, runRequest) }));
  ipcMain.handle("desktop:fork-conflict-draft-write", async (_event, rawRequest) => {
    const request = await validateForkConflictDraft(rawRequest, assertWorkspace); const stableKey = createHash("sha256").update(`${request.threadId}\0${request.workspacePath}\0${request.path}\0${request.expectedDiffHash}\0${request.draft}`).digest("hex");
    const proposal = await services.approvals.propose({ source: "workspace", actionKind: "workspace.revert", title: "Write resolved conflict draft", detail: `Write the reviewed resolved draft atomically into the source workspace without staging it.\nThread: ${request.threadId}\nFile: ${request.path}\nReviewed diff hash: ${request.expectedDiffHash}`, target: request.path, risk: "medium", idempotencyKey: `fork-conflict-draft:${stableKey}` }, async () => { await executeForkConflictDraftWrite(request); return true; });
    const approvalId = proposal.approval?.id; if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    return proposal.queued ? { threadId: request.threadId, workspacePath: request.workspacePath, path: request.path, written: false, approvalId, approvalQueued: true, message: "Resolved draft write-back is waiting in Approval Center." } : { threadId: request.threadId, workspacePath: request.workspacePath, path: request.path, written: true, approvalQueued: false, message: "This idempotent conflict draft was already written." };
  });
  ipcMain.handle("desktop:mcp-context-import", async (_event, request) => { await assertWorkspace(request?.workspacePath); return importMcpContext(request); });
  ipcMain.handle("desktop:mcp-live-enumerate", (_event, request) => dependencies.requestMcpEnumeration(request));
  ipcMain.handle("desktop:mcp-tool-execution-approval", (_event, request) => dependencies.requestMcpExecution(request));
  ipcMain.handle("desktop:mcp-execution-audits", async (_event, request) => { await assertWorkspace(request?.workspacePath); return listMcpToolExecutionAudits(request); });
  ipcMain.handle("desktop:mcp-session-audits", async (_event, request) => { await assertWorkspace(request?.workspacePath); return listMcpSessionAudits(request); });
  ipcMain.handle("desktop:mcp-active-sessions", async (_event, request) => { await assertWorkspace(request?.workspacePath); return listMcpActiveSessions(request); });
  ipcMain.handle("desktop:mcp-reusable-sessions", async (_event, request) => { await assertWorkspace(request?.workspacePath); return listMcpReusableSessions(request); });
  ipcMain.handle("desktop:mcp-reusable-session-close", async (_event, request) => { await assertWorkspace(request?.workspacePath); return closeMcpReusableSession(request); });
  ipcMain.handle("desktop:mcp-session-cancel", async (_event, request) => { await assertWorkspace(request?.workspacePath); return cancelMcpActiveSession(request); });
}
