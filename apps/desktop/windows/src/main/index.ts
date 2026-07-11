import { execFile } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "fs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { pathToFileURL } from "url";
import { is } from "@electron-toolkit/utils";
import { cancelInstall, startInstall } from "./install";
import {
  getGatewayStatus,
  shutdownGateway,
  startGateway,
  stopGateway,
} from "./gateway";
import { getDesktopHealth, getInstallStatus } from "./status";
import { bootstrapDesktop } from "./bootstrap";
import { DRSAI_HOME } from "./paths";
import { checkForUpdates, subscribeUpdateStatus } from "./updates";
import { abortChat, startChat } from "./chat";
import { abortAgentRun, startAgentRun } from "./agentRuns";
import { listAgents } from "./agents";
import {
  executeForkLifecycleAction,
  prepareForkWorktree,
} from "./forkWorktrees";
import { getMyDrSaiConfig, updateMyDrSaiConfig } from "./myDrSaiConfig";
import {
  assertExecutionAllowed,
  getDesktopExecutionPolicy,
} from "./executionPolicyGate";
import {
  createThread,
  getThreadSnapshot,
  listThreads,
  updateThread,
  updateThreadSnapshot,
} from "./threads";
import {
  addProjectMemory,
  clearProjectMemory,
  listProjectMemory,
  updateProjectMemory,
} from "./projectMemory";
import {
  deleteCustomCommand,
  listCustomCommands,
  upsertCustomCommand,
} from "./customCommands";
import {
  createProjectSkillDraft,
  installProjectSkillDraft,
  listProjectSkillDrafts,
  publishProjectSkillDraft,
} from "./projectSkills";
import {
  createWorkflowRunRecipe,
  getWorkflowTemplate,
  listWorkflowMarketplace,
  syncWorkflowMarketplace,
} from "./workflowMarketplace";
import {
  completeWorkflowRunStep,
  dispatchWorkflowRunStep,
  listWorkflowRuns,
  markWorkflowRunTerminalStepRunning,
  recoverWorkflowRunsAfterRestart,
  startWorkflowRun,
} from "./workflowRuns";
import {
  enqueueBackgroundTask,
  listBackgroundTasks,
  updateBackgroundTask,
  upsertBackgroundTaskForWorkflowRun,
} from "./backgroundTasks";
import {
  createScheduledTask,
  listScheduledTasks,
  runDueScheduledTasks,
  startScheduledTaskWorker,
  type ScheduledTaskWorkerHandle,
  updateScheduledTask,
} from "./scheduledTasks";
import {
  configureChannelAdapter,
  createChannelOutboundDraftApproval,
  executeChannelOutboundDelivery,
  importChannelContext,
  listChannelAdapters,
  listChannelInboundEvents,
  listChannelOutboundDeliveries,
  routeChannelInboundEvent,
  startChannelAdapterAuth,
  syncChannelSnapshots,
} from "./channelAdapters";
import { importMcpContext } from "./mcpContext";
import {
  createMcpEnumerationBlockedResult,
  createMcpEnumerationQueuedResult,
  createMcpToolExecutionApprovalResult,
  cancelMcpActiveSession,
  closeMcpReusableSession,
  enumerateMcpLiveServer,
  executeMcpToolAfterApproval,
  inspectMcpLiveServers,
  listMcpActiveSessions,
  listMcpReusableSessions,
  listMcpSessionAudits,
  listMcpToolExecutionAudits,
  recordCancelledMcpLiveEnumerationAudit,
  recordCancelledMcpToolExecutionAudit,
  recordRejectedMcpToolExecutionAudit,
} from "./mcpLiveBridge";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "./workspaces";
import { getIdeContext } from "./ideContext";
import {
  getWorkspaceContextOverview,
  getWorkspaceGitFileAtRef,
  getWorkspaceGitDiff,
  listWorkspaceFiles,
  previewWorkspaceFile,
  revertWorkspaceHunk,
  revertWorkspaceFile,
  stageWorkspaceFile,
  stageWorkspaceHunk,
  summarizeWorkspaceFolder,
} from "./workspaceContext";
import {
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  previewWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from "./workspaceCheckpoints";
import {
  writeVoiceTranscriptHandoff,
  startVoiceTranscription,
  cancelVoiceTranscription,
  getVoiceRuntimeStatus,
  cleanupExpiredVoiceTempFiles,
} from "./voice";
import { saveApiKeyAndDefaultModel } from "./settings";
import {
  cancelOidcLogin,
  cancelDesktopSsoLogin,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  requireAuthContext,
  startDesktopSsoLogin,
  startOidcLogin,
  startWechatDesktopLogin,
} from "./auth";
import { maybeRunE2eSmoke } from "./e2eSmoke";
import {
  createTerminalSession,
  getTerminalBuffer,
  killAllTerminalSessions,
  killTerminalSession,
  listTerminalSessions,
  renameTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "./terminal";
import type { TerminalCreateOptions } from "./terminal";
import { approveBrowserActionRequest } from "./browser/actionApproval";
import { checkBrowserUrlSync } from "./browser/urlPolicy";
import { registerBrowserController } from "./browser/browserControllerRegistry";
import { ElectronWebviewController } from "./browser/adapters/electronWebviewController";
import { BrowserUseController } from "./browser/adapters/browserUseController";
import { BrowserUseWorkerClient } from "./browser/browserUse/workerClient";
import { createBrowserUseTaskCommand } from "./browser/browserUse/protocol";
import {
  appendBrowserTaskTraceEvent,
  initializeBrowserTaskTrace,
} from "./browser/browserTaskTrace";
import type {
  BrowserTaskEvent,
  BrowserTaskApprovalRequest,
  BrowserTaskStartRequest,
} from "../shared/browser/types";
import type {
  DesktopApprovalProposalRequest,
  DesktopApprovalProposalResult,
  DesktopChannelAdapterConfigureRequest,
  DesktopChannelAdapterAuthStartRequest,
  DesktopChannelContextImportRequest,
  DesktopChannelInboundEventListRequest,
  DesktopChannelInboundEventRouteRequest,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDeliveryListRequest,
  DesktopChannelOutboundDraftRequest,
  DesktopChannelOutboundDraftResult,
  DesktopChannelSnapshotSyncRequest,
  DesktopForkLifecycleAction,
  DesktopForkLifecycleApprovalRequest,
  DesktopForkLifecycleApprovalResult,
  DesktopForkConflictDraftWriteRequest,
  DesktopForkConflictDraftWriteResult,
  DesktopForkQueueDispatchRequest,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalRequest,
  DesktopForkQueueStartApprovalResult,
  DesktopGitCommitApprovalRequest,
  DesktopMcpContextRequest,
  DesktopMcpActiveSessionListRequest,
  DesktopMcpReusableSessionCloseRequest,
  DesktopMcpReusableSessionListRequest,
  DesktopMcpSessionCancelRequest,
  DesktopMcpLiveEnumerationRequest,
  DesktopMcpSessionAuditListRequest,
  DesktopMcpToolExecutionAuditListRequest,
  DesktopMcpToolExecutionApprovalRequest,
  DesktopPendingApproval,
  DesktopScheduledTaskWorkerStatus,
  DesktopShellCommandApprovalRequest,
  DesktopThread,
  DesktopThreadForkMetadata,
  DesktopVoiceTranscriptHandoffRequest,
  DesktopVoiceTranscriptionRequest,
  WorkspaceCheckpointRestoreRequest,
  WorkspaceCheckpointRestoreResult,
  DesktopWorkflowRunPrepareRequest,
  UpdateMyDrSaiConfigRequest,
} from "../shared/desktopApi";
import {
  evaluateExecutionPermission,
  type ExecutionActionKind,
} from "../shared/executionPolicy";

let mainWindow: BrowserWindow | null = null;
let scheduledTaskWorker: ScheduledTaskWorkerHandle | null = null;
let browserWebContentsPolicyRegistered = false;
const configuredBrowserSessions = new WeakSet<Session>();
const browserTaskSubscribers = new Set<WebContents>();

function getRendererHtmlPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "renderer", "index.html")
    : join(__dirname, "../renderer/index.html");
}

function getRendererUrl(): string {
  return app.isPackaged
    ? `${RENDERER_PROTOCOL}://renderer/index.html`
    : pathToFileURL(getRendererHtmlPath()).toString();
}
const TRUSTED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEEP_LINK_PROTOCOL = "opendrsai";
const RENDERER_PROTOCOL = "opendrsai-app";
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);
const browserUseWorkerClient = new BrowserUseWorkerClient();
const pendingBrowserTaskApprovals = new Map<
  string,
  Extract<BrowserTaskEvent, { type: "action.proposed" }>
>();
const pendingDesktopApprovals = new Map<string, DesktopPendingApproval>();
const pendingShellCommandApprovals = new Map<
  string,
  {
    terminalSessionId: string;
    commandId: string;
    command: string;
    invocation: string;
    workflowRunId?: string;
    workflowStepId?: string;
  }
>();

const isE2eSmokeProcess =
  process.env.OPENDRSAI_E2E_SMOKE === "1" ||
  process.env.OPENDRSAI_E2E_CHAT === "1" ||
  process.env.OPENDRSAI_E2E_CHAT_FAILURES === "1" ||
  process.env.OPENDRSAI_E2E_AGENT_RUN === "1" ||
  process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES === "1" ||
  process.env.OPENDRSAI_E2E_THREADS === "1" ||
  process.env.OPENDRSAI_E2E_FORK_MERGE === "1" ||
  process.env.OPENDRSAI_E2E_OIDC === "1" ||
  process.env.OPENDRSAI_E2E_OIDC_HEADLESS === "1";
if (isE2eSmokeProcess) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("in-process-gpu");
}
const singleInstanceLock = isE2eSmokeProcess || app.requestSingleInstanceLock();
function recordE2eStartupTrace(event: string, details: Record<string, unknown> = {}): void {
  if (!isE2eSmokeProcess) return;
  const target = globalThis as { __OPENDRSAI_E2E_TRACE?: Array<Record<string, unknown>> };
  target.__OPENDRSAI_E2E_TRACE ??= [];
  target.__OPENDRSAI_E2E_TRACE.push({ event, at: new Date().toISOString(), ...details });
}
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    handleDeepLinkArgv(argv);
    focusMainWindow();
  });
}
type WorkspaceMutationAction =
  | "stage-file"
  | "revert-file"
  | "stage-hunk"
  | "revert-hunk";
const pendingWorkspaceMutationApprovals = new Map<
  string,
  {
    action: WorkspaceMutationAction;
    request: unknown;
  }
>();
const pendingWorkspaceCheckpointRestores = new Map<
  string,
  WorkspaceCheckpointRestoreRequest
>();
const pendingGitCommitApprovals = new Map<
  string,
  DesktopGitCommitApprovalRequest
>();
const pendingForkLifecycleApprovals = new Map<
  string,
  DesktopForkLifecycleApprovalRequest
>();
const pendingForkQueueStartApprovals = new Map<
  string,
  DesktopForkQueueStartApprovalRequest
>();
const pendingForkConflictDraftWrites = new Map<
  string,
  DesktopForkConflictDraftWriteRequest
>();
const pendingChannelOutboundDrafts = new Map<
  string,
  DesktopChannelOutboundDraftRequest
>();
const pendingMcpLiveEnumerations = new Map<
  string,
  DesktopMcpLiveEnumerationRequest
>();
const pendingMcpToolExecutions = new Map<
  string,
  DesktopMcpToolExecutionApprovalRequest
>();

browserUseWorkerClient.on("event", (event) => {
  updatePendingBrowserTaskApprovals(event);
  appendBrowserTaskTraceEvent(event);
  for (const subscriber of [...browserTaskSubscribers]) {
    if (subscriber.isDestroyed()) {
      browserTaskSubscribers.delete(subscriber);
      continue;
    }
    subscriber.send("desktop:browser-task-event", event);
  }
});

function updatePendingBrowserTaskApprovals(event: BrowserTaskEvent): void {
  if (event.type === "action.proposed" && event.requiresApproval) {
    pendingBrowserTaskApprovals.set(event.actionId, event);
    pendingDesktopApprovals.set(
      createBrowserTaskApprovalId(event.taskId, event.actionId),
      toDesktopBrowserTaskApproval(event),
    );
    return;
  }
  if (event.type === "action.completed") {
    pendingBrowserTaskApprovals.delete(event.actionId);
    pendingDesktopApprovals.delete(
      createBrowserTaskApprovalId(event.taskId, event.actionId),
    );
    return;
  }
  if (
    event.type === "task.completed" ||
    event.type === "task.failed" ||
    event.type === "task.cancelled"
  ) {
    for (const [actionId, approval] of pendingBrowserTaskApprovals) {
      if (approval.taskId === event.taskId) {
        pendingBrowserTaskApprovals.delete(actionId);
        pendingDesktopApprovals.delete(
          createBrowserTaskApprovalId(approval.taskId, approval.actionId),
        );
      }
    }
  }
}

function createBrowserTaskApprovalId(taskId: string, actionId: string): string {
  return `browser_task:${taskId}:${actionId}`;
}

function toDesktopBrowserTaskApproval(
  approval: Extract<BrowserTaskEvent, { type: "action.proposed" }>,
): DesktopPendingApproval {
  const sensitive =
    approval.action === "type" ||
    approval.action === "click" ||
    approval.action === "select" ||
    approval.action === "key_press";
  return {
    id: createBrowserTaskApprovalId(approval.taskId, approval.actionId),
    source: "browser_task",
    actionKind: sensitive ? "browser.sensitive_interact" : "browser.interact",
    title: `Browser ${approval.action}`,
    detail: approval.target || approval.actionId,
    target: approval.target,
    createdAt: approval.timestamp,
    risk: sensitive ? "high" : "medium",
    taskId: approval.taskId,
    actionId: approval.actionId,
  };
}

const APPROVAL_SOURCE_ACTIONS: Record<
  DesktopApprovalProposalRequest["source"],
  Set<ExecutionActionKind>
> = {
  shell: new Set(["terminal.create", "terminal.write", "shell.command"]),
  workspace: new Set(["workspace.stage", "workspace.revert", "workspace.checkpoint"]),
  git: new Set(["git.commit"]),
  fork: new Set(["fork.lifecycle", "fork.queue_start"]),
  workflow: new Set(["workflow.run"]),
  network: new Set(["network.request"]),
  connector: new Set(["external.service"]),
};

function createRuntimeApprovalId(
  request: DesktopApprovalProposalRequest,
): string {
  const stableKey = request.idempotencyKey?.trim();
  if (stableKey) return `${request.source}:${request.actionKind}:${stableKey}`;
  return `${request.source}:${request.actionKind}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function isValidApprovalProposalSourceAction(
  request: DesktopApprovalProposalRequest,
): boolean {
  return APPROVAL_SOURCE_ACTIONS[request.source]?.has(request.actionKind) === true;
}

function normalizeApprovalRisk(
  request: DesktopApprovalProposalRequest,
): DesktopPendingApproval["risk"] {
  if (request.risk) return request.risk;
  if (
    request.actionKind === "shell.command" ||
    request.actionKind === "git.commit" ||
    request.actionKind === "fork.lifecycle" ||
    request.actionKind === "fork.queue_start" ||
    request.actionKind === "workflow.run" ||
    request.actionKind === "external.service"
  ) {
    return "high";
  }
  if (
    request.actionKind === "workspace.revert" ||
    request.actionKind === "terminal.write" ||
    request.actionKind === "network.request"
  ) {
    return "medium";
  }
  return "low";
}

async function prepareWorkflowRun(
  request: unknown,
): Promise<Awaited<ReturnType<typeof createWorkflowRunRecipe>>> {
  const typed = normalizeWorkflowRunPrepareRequest(request);
  if (!typed) {
    return createWorkflowRunRecipe({
      templateId: "invalid",
    });
  }
  const template = await getWorkflowTemplate(typed.templateId, typed.workspacePath);
  if (!template || template.status !== "available" || !template.approvalRequired) {
    return createWorkflowRunRecipe(typed);
  }

  const proposal = await proposeDesktopApproval({
    source: "workflow",
    actionKind: "workflow.run",
    title: `Run workflow: ${template.name}`,
    detail: [
      template.summary,
      `Trigger: ${template.trigger}`,
      `Verification: ${template.verification}`,
    ].join("\n"),
    target: typed.workspacePath,
    risk: template.risk,
    idempotencyKey: [
      "workflow",
      template.id,
      typed.workspacePath ? stableApprovalHash(typed.workspacePath) : "global",
    ].join(":"),
  });
  return createWorkflowRunRecipe(typed, proposal);
}

async function requestMcpLiveEnumeration(
  request: unknown,
): Promise<Awaited<ReturnType<typeof enumerateMcpLiveServer>>> {
  const typed = normalizeMcpLiveEnumerationRequest(request);
  if (!typed) {
    return createMcpEnumerationBlockedResult(
      { workspacePath: "", server: undefined },
      "MCP live enumeration request is incomplete.",
    );
  }
  let inspection: ReturnType<typeof inspectMcpLiveServers>;
  try {
    inspection = inspectMcpLiveServers(typed.workspacePath);
  } catch (error) {
    return createMcpEnumerationBlockedResult(
      typed,
      error instanceof Error ? error.message : "MCP live server config is invalid.",
    );
  }
  const matchedServers = typed.server
    ? inspection.servers.filter((server) =>
        server.name.toLowerCase().includes(typed.server?.toLowerCase() ?? ""),
      )
    : inspection.servers;
  if (!matchedServers.length) {
    return createMcpEnumerationBlockedResult(
      typed,
      "No configured MCP server matched the requested selector.",
    );
  }
  const proposal = await proposeDesktopApproval({
    source: "network",
    actionKind: "network.request",
    title: "Enumerate live MCP server context",
    detail: [
      "Approve a bounded stdio MCP resources/list and tools/list enumeration.",
      `Config: ${inspection.configPath}`,
      `Servers: ${matchedServers.map((server) => server.name).join(", ")}`,
      "Results are written to .drsai/mcp-context.json for later reviewed /mcp resource or /mcp tool import.",
      "MCP tool execution is not performed by this approval.",
    ].join("\n"),
    target: typed.workspacePath,
    risk: "medium",
    idempotencyKey: [
      "mcp-live-enumerate",
      stableApprovalHash(typed.workspacePath),
      stableApprovalHash(typed.server ?? "all"),
    ].join(":"),
  });
  if (proposal.blocked || !proposal.allowed) {
    return createMcpEnumerationBlockedResult(typed, proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    pendingMcpLiveEnumerations.set(proposal.approval.id, typed);
    return createMcpEnumerationQueuedResult(
      typed,
      proposal.approval.id,
      proposal.reason,
    );
  }
  return enumerateMcpLiveServer(typed);
}

async function requestMcpToolExecutionApproval(
  request: unknown,
) {
  const typed = normalizeMcpToolExecutionApprovalRequest(request);
  if (!typed) {
    return createMcpToolExecutionApprovalResult(
      { workspacePath: "", server: "", tool: "", input: undefined },
      undefined,
      "MCP tool execution approval request is incomplete.",
      false,
      true,
    );
  }
  try {
    const inspection = inspectMcpLiveServers(typed.workspacePath);
    const matchedServer = inspection.servers.find((server) =>
      server.name.toLowerCase().includes(typed.server.toLowerCase()),
    );
    if (!matchedServer) {
      return createMcpToolExecutionApprovalResult(
        typed,
        undefined,
        "No configured MCP server matched the tool execution request.",
        false,
        true,
      );
    }
    if (typed.input) {
      const parsed = JSON.parse(typed.input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return createMcpToolExecutionApprovalResult(
          typed,
          undefined,
          "MCP tool input must be a JSON object.",
          false,
          true,
        );
      }
    }
  } catch (error) {
    return createMcpToolExecutionApprovalResult(
      typed,
      undefined,
      error instanceof Error ? error.message : "MCP tool execution preflight failed.",
      false,
      true,
    );
  }
  const proposal = await proposeDesktopApproval({
    source: "connector",
    actionKind: "external.service",
    title: `Execute MCP tool: ${typed.tool}`,
    detail: [
      "Approve a bounded stdio MCP tools/call execution for the selected server/tool.",
      `Server: ${typed.server}`,
      `Tool: ${typed.tool}`,
      typed.input ? `Input preview: ${typed.input.slice(0, 1200)}` : "Input preview: none",
      "Approved results are written to .drsai/mcp-context.json for reviewed /mcp tool import.",
      "This approval path is intentionally separate from live MCP enumeration and from /mcp context import.",
    ].join("\n"),
    target: typed.workspacePath,
    risk: "high",
    idempotencyKey: [
      "mcp-tool-exec",
      stableApprovalHash(typed.workspacePath),
      stableApprovalHash(typed.server),
      stableApprovalHash(typed.tool),
      stableApprovalHash(typed.input ?? ""),
    ].join(":"),
  });
  if (proposal.queued && proposal.approval) {
    pendingMcpToolExecutions.set(proposal.approval.id, typed);
  }
  if (!proposal.queued && proposal.allowed && !proposal.blocked) {
    return executeMcpToolAfterApproval(typed);
  }
  return createMcpToolExecutionApprovalResult(
    typed,
    proposal.approval?.id,
    proposal.reason,
    Boolean(proposal.queued && proposal.approval),
    proposal.blocked || !proposal.allowed,
  );
}

async function runDueScheduledTasksAndMirror(
  request: unknown,
): Promise<Awaited<ReturnType<typeof runDueScheduledTasks>>> {
  const result = await runDueScheduledTasks(request, {
    prepareWorkflowRun,
    startWorkflowRun,
    listWorkflowRuns,
  });
  await Promise.all(result.runs.map((run) => upsertBackgroundTaskForWorkflowRun(run)));
  return result;
}

function startScheduledTaskWorkerIfEnabled(): void {
  if (scheduledTaskWorker || process.env.OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER === "1") {
    return;
  }
  scheduledTaskWorker = startScheduledTaskWorker(
    {
      prepareWorkflowRun,
      startWorkflowRun,
      listWorkflowRuns,
      onWorkflowRun: async (run) => {
        await upsertBackgroundTaskForWorkflowRun(run);
      },
    },
    {
      intervalMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INTERVAL_MS),
      initialDelayMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INITIAL_DELAY_MS),
    },
  );
}

async function recoverWorkflowRunStateAfterRestart(): Promise<void> {
  try {
    const result = await recoverWorkflowRunsAfterRestart();
      if (result.recovered === 0) return;
      await Promise.all(
        result.runs.map((run) => upsertBackgroundTaskForWorkflowRun(run)),
      );
      console.info(
        `[desktop] Recovered ${result.recovered} workflow run(s) after restart.`,
      );
  } catch (error) {
    console.warn(
      "[desktop] Workflow run restart recovery failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function getScheduledTaskWorkerStatus(): DesktopScheduledTaskWorkerStatus {
  if (scheduledTaskWorker) {
    return scheduledTaskWorker.getStatus();
  }
  const disabled = process.env.OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER === "1";
  return {
    enabled: !disabled,
    running: false,
    stopped: true,
    intervalMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INTERVAL_MS) || 5 * 60 * 1000,
    initialDelayMs:
      Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INITIAL_DELAY_MS) || 15 * 1000,
    message: disabled
      ? "Scheduled task worker is disabled by OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER."
      : "Scheduled task worker has not started yet.",
  };
}

function stopScheduledTaskWorker(): void {
  scheduledTaskWorker?.stop();
  scheduledTaskWorker = null;
}

function normalizeWorkflowRunPrepareRequest(
  request: unknown,
): DesktopWorkflowRunPrepareRequest | null {
  if (!request || typeof request !== "object") return null;
  const templateId = getStringProperty(request, "templateId");
  if (!templateId || templateId.length > 80) return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  return {
    templateId,
    ...(workspacePath ? { workspacePath } : {}),
  };
}

function normalizeMcpLiveEnumerationRequest(
  request: unknown,
): DesktopMcpLiveEnumerationRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  if (!workspacePath || workspacePath.length > 2048) return null;
  const server = sanitizeOptionalDispatchText(getStringProperty(request, "server"), 120);
  return {
    workspacePath,
    ...(server ? { server } : {}),
  };
}

function normalizeMcpToolExecutionApprovalRequest(
  request: unknown,
): DesktopMcpToolExecutionApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  const server = sanitizeOptionalDispatchText(getStringProperty(request, "server"), 120);
  const tool = sanitizeOptionalDispatchText(getStringProperty(request, "tool"), 160);
  if (!workspacePath || !server || !tool || workspacePath.length > 2048) {
    return null;
  }
  const input = getStringProperty(request, "input");
  return {
    workspacePath,
    server,
    tool,
    ...(input ? { input: input.slice(0, 12000) } : {}),
  };
}

async function proposeDesktopApproval(
  request: unknown,
): Promise<DesktopApprovalProposalResult> {
  if (!request || typeof request !== "object") {
    return blockedApprovalProposal("Approval proposal must be an object.");
  }
  const typed = request as DesktopApprovalProposalRequest;
  if (
    !typed.source ||
    !typed.actionKind ||
    typeof typed.title !== "string" ||
    typeof typed.detail !== "string" ||
    !typed.title.trim() ||
    !typed.detail.trim() ||
    !isValidApprovalProposalSourceAction(typed)
  ) {
    return blockedApprovalProposal("Approval proposal has an invalid source/action pair.");
  }

  const policy = await getDesktopExecutionPolicy();
  const decision = evaluateExecutionPermission(typed.actionKind, policy);
  if (!decision.allowed) {
    return {
      queued: false,
      allowed: false,
      requiresApproval: false,
      blocked: true,
      reason: decision.reason,
    };
  }
  if (!decision.requiresApproval) {
    return {
      queued: false,
      allowed: true,
      requiresApproval: false,
      blocked: false,
      reason: decision.reason,
    };
  }

  const approval: DesktopPendingApproval = {
    id: createRuntimeApprovalId(typed),
    source: typed.source,
    actionKind: typed.actionKind,
    title: typed.title.trim(),
    detail: typed.detail.trim(),
    target: typeof typed.target === "string" ? typed.target : undefined,
    createdAt: new Date().toISOString(),
    risk: normalizeApprovalRisk(typed),
    ...(typed.checklist ? { checklist: typed.checklist } : {}),
  };
  pendingDesktopApprovals.set(approval.id, approval);
  return {
    queued: true,
    approval,
    allowed: true,
    requiresApproval: true,
    blocked: false,
    reason: decision.reason,
  };
}

function blockedApprovalProposal(reason: string): DesktopApprovalProposalResult {
  return {
    queued: false,
    allowed: false,
    requiresApproval: false,
    blocked: true,
    reason,
  };
}

async function requestTerminalShellCommandApproval(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<DesktopApprovalProposalResult> {
  if (!request || typeof request !== "object") {
    return blockedApprovalProposal("Shell command approval request must be an object.");
  }
  const typed = request as DesktopShellCommandApprovalRequest;
  if (
    typeof typed.terminalSessionId !== "string" ||
    !typed.terminalSessionId.trim() ||
    typeof typed.commandId !== "string" ||
    !typed.commandId.trim() ||
    typeof typed.command !== "string" ||
    !typed.command.trim() ||
    typeof typed.invocation !== "string" ||
    !typed.invocation.trim()
  ) {
    return blockedApprovalProposal("Shell command approval request is incomplete.");
  }

  const proposal = await proposeDesktopApproval({
    source: "shell",
    actionKind: "shell.command",
    title: "Run shell command",
    detail: typed.command.trim(),
    target: typed.terminalSessionId.trim(),
    risk: typed.risk,
    idempotencyKey: `terminal:${typed.terminalSessionId}:${typed.commandId}`,
  });

  if (proposal.blocked || !proposal.allowed) return proposal;

  if (proposal.queued && proposal.approval) {
    pendingShellCommandApprovals.set(proposal.approval.id, {
      terminalSessionId: typed.terminalSessionId,
      commandId: typed.commandId,
      command: typed.command,
      invocation: typed.invocation,
      ...(typed.workflowRunId ? { workflowRunId: typed.workflowRunId } : {}),
      ...(typed.workflowStepId ? { workflowStepId: typed.workflowStepId } : {}),
    });
    return proposal;
  }

  await assertExecutionAllowed("shell.command", { approved: true });
  const wrote = writeTerminalSession(event, typed.terminalSessionId, typed.invocation);
  if (!wrote) {
    return blockedApprovalProposal("The target terminal session is no longer available.");
  }
  await markShellWorkflowStepRunning(typed);
  return proposal;
}

async function requestGitCommitApproval(
  request: unknown,
): Promise<DesktopApprovalProposalResult> {
  const typed = normalizeGitCommitApprovalRequest(request);
  if (!typed) {
    return blockedApprovalProposal("Git commit approval request is incomplete.");
  }
  if (!(await isAllowedOpenPath(typed.workspacePath))) {
    return blockedApprovalProposal("Git commit workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "git",
    actionKind: "git.commit",
    title: "Create git commit",
    detail: formatGitCommitApprovalDetail(typed),
    target: typed.workspacePath,
    risk: "high",
    ...(typed.checklist ? { checklist: typed.checklist } : {}),
    idempotencyKey: getGitCommitIdempotencyKey(typed),
  });

  if (proposal.blocked || !proposal.allowed) return proposal;

  if (proposal.queued && proposal.approval) {
    pendingGitCommitApprovals.set(proposal.approval.id, typed);
    return proposal;
  }

  await assertExecutionAllowed("git.commit", { approved: true });
  await executeGitCommit(typed);
  return proposal;
}

async function requestForkLifecycleApproval(
  request: unknown,
): Promise<DesktopForkLifecycleApprovalResult> {
  const typed = normalizeForkLifecycleApprovalRequest(request);
  if (!typed) {
    return blockedForkLifecycleProposal("Fork lifecycle approval request is incomplete.");
  }
  const thread = (await listThreads()).find((item) => item.id === typed.threadId);
  if (!thread?.fork) {
    return blockedForkLifecycleProposal("Fork lifecycle approval requires a fork thread.");
  }
  if (thread.fork.lifecycleStatus === "closed") {
    return blockedForkLifecycleProposal("Closed fork threads cannot request lifecycle changes.");
  }
  if (!(await isAllowedOpenPath(thread.fork.sourceWorkspacePath))) {
    return blockedForkLifecycleProposal("Fork source workspace is not registered or allowed.");
  }

  const actionLabel = typed.action === "merge_back" ? "merge back" : "discard";
  const proposal = await proposeDesktopApproval({
    source: "fork",
    actionKind: "fork.lifecycle",
    title: `Review fork ${actionLabel}`,
    detail: formatForkLifecycleApprovalDetail(thread.fork, typed.action),
    target: thread.fork.worktreePath,
    risk: "high",
    idempotencyKey: `fork-lifecycle:${typed.threadId}:${typed.action}:${thread.fork.lifecycleStatus}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    return {
      queued: false,
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
    };
  }

  if (proposal.queued && proposal.approval) {
    pendingForkLifecycleApprovals.set(proposal.approval.id, typed);
    return {
      queued: true,
      approval: proposal.approval,
      allowed: true,
      blocked: false,
      reason: proposal.reason,
    };
  }

  const updatedThread = await executeForkLifecycleApproval(typed);
  return {
    queued: false,
    thread: updatedThread,
    allowed: true,
    blocked: false,
    reason: "Fork lifecycle state was updated.",
  };
}

async function requestForkQueueStartApproval(
  request: unknown,
): Promise<DesktopForkQueueStartApprovalResult> {
  const typed = normalizeForkQueueStartApprovalRequest(request);
  if (!typed) {
    return blockedForkQueueStartProposal("Fork queue start approval request is incomplete.");
  }
  const allThreads = await listThreads();
  const requestedThreads = typed.threadIds
    .map((threadId) => allThreads.find((thread) => thread.id === threadId))
    .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread));
  if (requestedThreads.length !== typed.threadIds.length || requestedThreads.some((thread) => !thread.fork)) {
    return blockedForkQueueStartProposal("Fork queue start approval requires existing fork threads.");
  }
  if (requestedThreads.some((thread) => thread.fork?.lifecycleStatus === "closed")) {
    return blockedForkQueueStartProposal("Closed fork threads cannot be queued for agent dispatch.");
  }
  const sourceWorkspacePath = requestedThreads[0]?.fork?.sourceWorkspacePath;
  if (!sourceWorkspacePath || !(await isAllowedOpenPath(sourceWorkspacePath))) {
    return blockedForkQueueStartProposal("Fork queue source workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "fork",
    actionKind: "fork.queue_start",
    title: `Start fork queue (${requestedThreads.length})`,
    detail: formatForkQueueStartApprovalDetail(requestedThreads),
    target: sourceWorkspacePath,
    risk: "high",
    idempotencyKey: `fork-queue-start:${typed.threadIds.join(":")}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    return {
      queued: false,
      threads: requestedThreads,
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
    };
  }

  if (proposal.queued && proposal.approval) {
    pendingForkQueueStartApprovals.set(proposal.approval.id, typed);
    const threads = await updateForkQueueThreads(
      typed.threadIds,
      "waiting_approval",
      `Queue start is waiting in Approval Center: ${proposal.approval.title}.`,
      proposal.approval.id,
    );
    return {
      queued: true,
      approval: proposal.approval,
      threads,
      allowed: true,
      blocked: false,
      reason: proposal.reason,
    };
  }

  const threads = await updateForkQueueThreads(
    typed.threadIds,
    "ready",
    "Fork queue start was allowed by policy; queued subtasks are ready for explicit agent dispatch.",
  );
  return {
    queued: false,
    threads,
    allowed: true,
    blocked: false,
    reason: "Fork queue is ready for explicit agent dispatch.",
  };
}

function normalizeForkLifecycleApprovalRequest(
  request: unknown,
): DesktopForkLifecycleApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const threadId = getStringProperty(request, "threadId");
  const action = (request as { action?: unknown }).action;
  if (!threadId || (action !== "merge_back" && action !== "discard")) return null;
  return {
    threadId,
    action,
  };
}

function normalizeForkQueueStartApprovalRequest(
  request: unknown,
): DesktopForkQueueStartApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const threadIds = (request as { threadIds?: unknown }).threadIds;
  if (!Array.isArray(threadIds)) return null;
  const normalized = [...new Set(threadIds)]
    .filter((threadId): threadId is string => typeof threadId === "string")
    .map((threadId) => threadId.trim())
    .filter((threadId) => threadId.length > 0 && threadId.length <= 160)
    .slice(0, 12);
  if (!normalized.length || normalized.length !== threadIds.length) return null;
  return { threadIds: normalized };
}

function formatForkLifecycleApprovalDetail(
  fork: DesktopThreadForkMetadata,
  action: DesktopForkLifecycleAction,
): string {
  const nextState = action === "merge_back" ? "merge_pending" : "cleanup_pending";
  const actionText =
    action === "merge_back"
      ? "Approve merging this fork branch back into the source workspace. If conflicts or dirty worktrees are detected, the fork remains merge_pending with a status message."
      : "Approve removing this controlled fork worktree from the Git worktree registry and deleting its desktop-managed directory. If the fork branch is already merged, cleanup deletes it with git branch -d; otherwise the branch is renamed under drsai/archive so unmerged work is retained.";
  return [
    actionText,
    `Next lifecycle state: ${nextState}`,
    `Branch: ${fork.branch}`,
    fork.branchCleanupStatus ? `Current branch cleanup: ${fork.branchCleanupStatus}` : "",
    fork.archivedBranch ? `Archived branch: ${fork.archivedBranch}` : "",
    `Base: ${fork.baseRef}`,
    `Source workspace: ${fork.sourceWorkspacePath}`,
    `Fork worktree: ${fork.worktreePath}`,
  ].filter(Boolean).join("\n");
}

function formatForkQueueStartApprovalDetail(
  threads: Array<{ title: string; fork?: DesktopThreadForkMetadata }>,
): string {
  return [
    "Approve starting this fork-backed subtask queue. Approval only marks the isolated fork threads ready for explicit agent dispatch; it does not bypass chat, terminal, or file mutation approvals.",
    ...threads.map((thread, index) =>
      [
        `${index + 1}. ${thread.title}`,
        thread.fork?.branch ? `Branch: ${thread.fork.branch}` : "",
        thread.fork?.worktreePath ? `Worktree: ${thread.fork.worktreePath}` : "",
      ].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
}

async function executeForkLifecycleApproval(
  request: DesktopForkLifecycleApprovalRequest,
) {
  await assertExecutionAllowed("fork.lifecycle", { approved: true });
  const thread = (await listThreads()).find((item) => item.id === request.threadId);
  if (!thread?.fork) {
    throw new Error("Fork lifecycle approval target no longer exists.");
  }
  if (!(await isAllowedOpenPath(thread.fork.sourceWorkspacePath))) {
    throw new Error("Fork source workspace is not registered or allowed.");
  }
  const lifecycleStatus =
    request.action === "merge_back" ? "merge_pending" : "cleanup_pending";
  const pendingThread = await updateThread({
    id: thread.id,
    fork: {
      ...thread.fork,
      lifecycleStatus,
      lifecycleUpdatedAt: new Date().toISOString(),
      lifecycleMessage:
        request.action === "merge_back"
          ? "Merge-back approved; checking source and fork worktrees."
          : "Discard approved; removing the controlled fork worktree.",
    },
  });
  const result = await executeForkLifecycleAction(pendingThread.fork ?? thread.fork, request.action);
  return updateThread({
    id: thread.id,
    fork: {
      ...(pendingThread.fork ?? thread.fork),
      ...result,
    },
  });
}

async function executeForkQueueStartApproval(
  request: DesktopForkQueueStartApprovalRequest,
  approved: boolean,
) {
  if (approved) {
    await assertExecutionAllowed("fork.queue_start", { approved: true });
  }
  return updateForkQueueThreads(
    request.threadIds,
    approved ? "ready" : "blocked",
    approved
      ? "Fork queue start approved; subtasks are ready for explicit agent dispatch."
      : "Fork queue start was rejected in Approval Center.",
  );
}

async function dispatchForkQueue(
  webContents: WebContents,
  request: unknown,
): Promise<DesktopForkQueueDispatchResult> {
  const typed = normalizeForkQueueDispatchRequest(request);
  if (!typed) {
    return {
      startedRuns: [],
      threads: [],
      blockedThreadIds: [],
      reason: "Fork queue dispatch request is incomplete.",
    };
  }
  const allThreads = await listThreads();
  const requestedThreads = typed.threadIds
    .map((threadId) => allThreads.find((thread) => thread.id === threadId))
    .filter((thread): thread is DesktopThread => Boolean(thread?.fork));
  if (requestedThreads.length !== typed.threadIds.length) {
    return {
      startedRuns: [],
      threads: requestedThreads,
      blockedThreadIds: typed.threadIds,
      reason: "Fork queue dispatch requires existing fork threads.",
    };
  }
  const notReadyThreads = requestedThreads.filter((thread) => thread.fork?.queueStatus !== "ready");
  if (notReadyThreads.length) {
    const blocked = await updateForkQueueThreads(
      notReadyThreads.map((thread) => thread.id),
      "blocked",
      "Fork queue dispatch was blocked because the queue is not approved and ready.",
    );
    return {
      startedRuns: [],
      threads: blocked,
      blockedThreadIds: notReadyThreads.map((thread) => thread.id),
      reason: "Only approved ready fork queue threads can be dispatched.",
    };
  }

  const startedRuns: DesktopForkQueueDispatchResult["startedRuns"] = [];
  const blockedThreadIds: string[] = [];
  const updatedThreads: DesktopThread[] = [];
  for (const thread of requestedThreads) {
    const fork = thread.fork;
    if (!fork) continue;
    if (!(await isAllowedOpenPath(fork.sourceWorkspacePath))) {
      blockedThreadIds.push(thread.id);
      updatedThreads.push(
        ...(await updateForkQueueThreads(
          [thread.id],
          "blocked",
          "Fork queue dispatch was blocked because the source workspace is not registered or allowed.",
        )),
      );
      continue;
    }
    try {
      const now = new Date().toISOString();
      const runningThread = await updateThread({
        id: thread.id,
        status: "running",
        fork: {
          ...fork,
          queueStatus: "running",
          queueMessage: buildForkQueueRunningMessage(thread, typed),
          queueUpdatedAt: now,
        },
      });
      updatedThreads.push(runningThread);
      const started = await startAgentRun(webContents, {
        threadId: thread.id,
        sessionId: thread.id,
        runId: `fork-queue-${Date.now()}-${thread.id}`,
        task: buildForkQueueDispatchTask(thread, typed),
        workspacePath: fork.worktreePath,
        model: typed.model,
        metadata: {
          runtime_mode: {
            name: "fork",
            intent: thread.title,
            activated_by: "fork_queue_dispatch",
          },
          fork_queue_dispatch: true,
          fork_queue_group_id: fork.queueGroupId,
          fork_queue_index: fork.queueIndex,
          fork_queue_size: fork.queueSize,
          selected_agent_id: resolveForkQueueAssignment(thread, typed).agentId,
          selected_agent_name: resolveForkQueueAssignment(thread, typed).agentName,
          source_workspace_path: fork.sourceWorkspacePath,
          isolated_worktree_path: fork.worktreePath,
        },
      });
      startedRuns.push({
        threadId: thread.id,
        requestId: started.requestId,
        runId: started.runId,
      });
    } catch (error) {
      blockedThreadIds.push(thread.id);
      updatedThreads.push(
        ...(await updateForkQueueThreads(
          [thread.id],
          "blocked",
          `Fork queue dispatch failed to start: ${formatForkQueueDispatchError(error)}`,
        )),
      );
    }
  }
  return {
    startedRuns,
    threads: updatedThreads,
    blockedThreadIds,
    reason: startedRuns.length
      ? `Dispatched ${startedRuns.length} fork queue subtask${startedRuns.length === 1 ? "" : "s"}.`
      : "No fork queue subtasks were dispatched.",
  };
}

async function updateForkQueueThreads(
  threadIds: string[],
  queueStatus: NonNullable<DesktopThreadForkMetadata["queueStatus"]>,
  queueMessage: string,
  queueApprovalId?: string,
) {
  const now = new Date().toISOString();
  const allThreads = await listThreads();
  const updated: Array<Awaited<ReturnType<typeof updateThread>>> = [];
  for (const threadId of threadIds) {
    const thread = allThreads.find((item) => item.id === threadId);
    if (!thread?.fork) continue;
    updated.push(
      await updateThread({
        id: thread.id,
        fork: {
          ...thread.fork,
          queueStatus,
          queueMessage,
          ...(queueApprovalId ? { queueApprovalId } : {}),
          queueUpdatedAt: now,
        },
      }),
    );
  }
  return updated;
}

function normalizeForkQueueDispatchRequest(
  request: unknown,
): DesktopForkQueueDispatchRequest | null {
  if (!request || typeof request !== "object") return null;
  const startRequest = normalizeForkQueueStartApprovalRequest(request);
  if (!startRequest) return null;
  return {
    threadIds: startRequest.threadIds,
    selectedAgentId: sanitizeOptionalDispatchText(getStringProperty(request, "selectedAgentId"), 120),
    selectedAgentName: sanitizeOptionalDispatchText(getStringProperty(request, "selectedAgentName"), 160),
    threadAgentAssignments: normalizeForkQueueAgentAssignments(request as Record<string, unknown>, startRequest.threadIds),
    model: sanitizeOptionalDispatchText(getStringProperty(request, "model"), 160),
  };
}

function normalizeForkQueueAgentAssignments(
  request: Record<string, unknown>,
  threadIds: string[],
): DesktopForkQueueDispatchRequest["threadAgentAssignments"] | undefined {
  const raw = request.threadAgentAssignments;
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const allowed = new Set(threadIds);
  const entries: Array<[string, { agentId?: string; agentName?: string }]> = [];
  for (const [threadId, value] of Object.entries(source)) {
    if (!allowed.has(threadId) || !value || typeof value !== "object") continue;
    const assignment = value as Record<string, unknown>;
    const agentId = sanitizeOptionalDispatchText(getStringProperty(assignment, "agentId"), 120);
    const agentName = sanitizeOptionalDispatchText(getStringProperty(assignment, "agentName"), 160);
    if (!agentId && !agentName) continue;
    entries.push([threadId, { agentId, agentName }]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sanitizeOptionalDispatchText(value: string, maxChars: number): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxChars) || undefined;
}

function buildForkQueueDispatchTask(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): string {
  const fork = thread.fork;
  const assignment = resolveForkQueueAssignment(thread, request);
  return [
    `Subtask: ${thread.title}`,
    "Execute this approved fork queue subtask inside its isolated worktree.",
    fork?.queueIndex && fork.queueSize ? `Queue position: ${fork.queueIndex}/${fork.queueSize}` : "",
    assignment.agentName ? `Assigned agent: ${assignment.agentName}` : "",
    fork?.queueAgentHint && !assignment.agentName ? `Requested agent hint: ${fork.queueAgentHint}` : "",
    fork?.sourceWorkspacePath ? `Source workspace for review only: ${fork.sourceWorkspacePath}` : "",
    fork?.worktreePath ? `Writable isolated worktree: ${fork.worktreePath}` : "",
    "Before coding, write a concise design plan in the agent run. Then implement, add or update tests, run the relevant verification, and report completion or blockers.",
  ].filter(Boolean).join("\n");
}

function buildForkQueueRunningMessage(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): string {
  const assignment = resolveForkQueueAssignment(thread, request);
  return [
    "Fork queue subtask is running in its isolated worktree.",
    assignment.agentName ? `Assigned agent: ${assignment.agentName}.` : "",
  ].filter(Boolean).join(" ");
}

function resolveForkQueueAssignment(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): { agentId?: string; agentName?: string } {
  const explicit = request.threadAgentAssignments?.[thread.id];
  return {
    agentId: explicit?.agentId ?? thread.fork?.queueAgentId ?? request.selectedAgentId,
    agentName: explicit?.agentName ?? thread.fork?.queueAgentName ?? request.selectedAgentName,
  };
}

function formatForkQueueDispatchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blockedForkLifecycleProposal(
  reason: string,
): DesktopForkLifecycleApprovalResult {
  return {
    queued: false,
    allowed: false,
    blocked: true,
    reason,
  };
}

function blockedForkQueueStartProposal(
  reason: string,
): DesktopForkQueueStartApprovalResult {
  return {
    queued: false,
    threads: [],
    allowed: false,
    blocked: true,
    reason,
  };
}

function normalizeGitCommitApprovalRequest(
  request: unknown,
): DesktopGitCommitApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  const message = getStringProperty(request, "message");
  if (!workspacePath || !message || message.length > 240) return null;
  const body = getStringProperty(request, "body");
  const requestId = getStringProperty(request, "requestId");
  return {
    workspacePath,
    message,
    ...(body ? { body } : {}),
    ...(isDesktopCommitApprovalChecklist((request as Record<string, unknown>).checklist)
      ? { checklist: (request as { checklist: DesktopGitCommitApprovalRequest["checklist"] }).checklist }
      : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function isDesktopCommitApprovalChecklist(
  value: unknown,
): value is NonNullable<DesktopGitCommitApprovalRequest["checklist"]> {
  if (!value || typeof value !== "object") return false;
  const typed = value as DesktopGitCommitApprovalRequest["checklist"];
  return (
    typed?.type === "git_commit" &&
    Array.isArray(typed.stagedFiles) &&
    typeof typed.workspaceChangedFileCount === "number" &&
    typeof typed.unstagedFileCount === "number" &&
    typeof typed.diffLineCount === "number" &&
    typeof typed.diffTruncated === "boolean" &&
    typeof typed.riskSummary === "string" &&
    typeof typed.testCommitment === "string"
  );
}

function formatGitCommitApprovalDetail(
  request: DesktopGitCommitApprovalRequest,
): string {
  const command = `git commit -m "${request.message}"`;
  if (!request.body?.trim()) return command;
  return `${command}\n\n${request.body.trim()}`;
}

function getGitCommitIdempotencyKey(
  request: DesktopGitCommitApprovalRequest,
): string {
  return [
    "git-commit",
    request.workspacePath,
    stableApprovalHash(request.message),
    request.body ? stableApprovalHash(request.body) : "",
    request.requestId ?? "",
  ]
    .filter(Boolean)
    .join(":");
}

async function executeGitCommit(
  request: DesktopGitCommitApprovalRequest,
): Promise<void> {
  if (!(await isAllowedOpenPath(request.workspacePath))) {
    throw new Error("Git commit workspace is not registered or allowed.");
  }
  const args = ["-C", request.workspacePath, "commit", "-m", request.message];
  if (request.body?.trim()) args.push("-m", request.body.trim());
  await execGit(args, request.workspacePath, 60000);
}

async function execGit(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      args,
      { cwd, timeout, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(
            new Error(stderr?.trim() || stdout?.trim() || error.message),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

async function requestWorkspaceMutationApproval(
  action: WorkspaceMutationAction,
  request: unknown,
): Promise<unknown> {
  const actionKind = getWorkspaceMutationActionKind(action);
  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind,
    title: getWorkspaceMutationTitle(action),
    detail: getWorkspaceMutationDetail(action, request),
    target: getStringProperty(request, "path") || getStringProperty(request, "workspacePath"),
    risk: actionKind === "workspace.revert" ? "medium" : "low",
    idempotencyKey: getWorkspaceMutationIdempotencyKey(action, request),
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    pendingWorkspaceMutationApprovals.set(proposal.approval.id, {
      action,
      request,
    });
    return createQueuedWorkspaceMutationResult(action, request, proposal.approval.id);
  }

  await assertExecutionAllowed(actionKind, { approved: true });
  return executeWorkspaceMutation(action, request);
}

async function requestWorkspaceCheckpointRestore(
  request: unknown,
): Promise<WorkspaceCheckpointRestoreResult> {
  const workspacePath = getStringProperty(request, "workspacePath");
  const checkpointId = getStringProperty(request, "checkpointId");
  if (!workspacePath || !checkpointId) {
    throw new Error("Workspace checkpoint restore request is incomplete.");
  }
  if (!(await isAllowedOpenPath(workspacePath))) {
    throw new Error("Checkpoint workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind: "workspace.revert",
    title: "Restore workspace checkpoint",
    detail: `Restore checkpoint ${checkpointId} in ${workspacePath}. This may overwrite or remove workspace files captured by the checkpoint manifest.`,
    target: workspacePath,
    risk: "medium",
    idempotencyKey: `workspace:checkpoint-restore:${stableApprovalHash(workspacePath)}:${checkpointId}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    pendingWorkspaceCheckpointRestores.set(proposal.approval.id, {
      workspacePath,
      checkpointId,
    });
    return {
      workspacePath,
      checkpointId,
      restored: false,
      restoredFileCount: 0,
      removedFileCount: 0,
      skippedFileCount: 0,
      approvalId: proposal.approval.id,
      approvalQueued: true,
      message: "Workspace checkpoint restore is waiting in Approval Center.",
    };
  }

  await assertExecutionAllowed("workspace.revert", { approved: true });
  return restoreWorkspaceCheckpoint({ workspacePath, checkpointId });
}

async function requestForkConflictDraftWrite(
  request: unknown,
): Promise<DesktopForkConflictDraftWriteResult> {
  const typed = normalizeForkConflictDraftWriteRequest(request);
  const thread = (await listThreads()).find((item) => item.id === typed.threadId);
  if (!thread?.fork) {
    throw new Error("Fork conflict draft target thread no longer exists.");
  }
  if (thread.fork.lifecycleStatus !== "merge_pending") {
    throw new Error("Fork conflict draft write-back is only available during merge recovery.");
  }
  if (
    !isSameFilesystemPath(
      thread.fork.sourceWorkspacePath,
      typed.workspacePath,
    )
  ) {
    throw new Error("Fork conflict draft workspace does not match the source workspace.");
  }
  if (!(await isAllowedOpenPath(typed.workspacePath))) {
    throw new Error("Fork conflict source workspace is not registered or allowed.");
  }
  const safeRelativePath = resolveForkConflictDraftPath(typed.workspacePath, typed.path);
  const diff = await getWorkspaceGitDiff({
    workspacePath: typed.workspacePath,
    path: safeRelativePath,
    maxChars: 300_000,
  });
  if (diff.diffHash !== typed.expectedDiffHash) {
    throw new Error("File diff changed since review; reload before writing the resolved draft.");
  }

  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind: "workspace.revert",
    title: "Write resolved conflict draft",
    detail: [
      "Approve writing the manually reviewed resolved draft into the source workspace file.",
      "This overwrites the current worktree file content but does not stage it; use Stage resolved file after reviewing the resulting diff.",
      `Thread: ${thread.title}`,
      `File: ${safeRelativePath}`,
      `Workspace: ${typed.workspacePath}`,
      `Reviewed diff hash: ${typed.expectedDiffHash}`,
    ].join("\n"),
    target: safeRelativePath,
    risk: "medium",
    idempotencyKey: [
      "fork-conflict-draft",
      typed.threadId,
      stableApprovalHash(typed.workspacePath),
      safeRelativePath,
      typed.expectedDiffHash,
      stableApprovalHash(typed.draft),
    ].join(":"),
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  const normalizedRequest: DesktopForkConflictDraftWriteRequest = {
    ...typed,
    path: safeRelativePath,
  };
  if (proposal.queued && proposal.approval) {
    pendingForkConflictDraftWrites.set(proposal.approval.id, normalizedRequest);
    return {
      threadId: typed.threadId,
      workspacePath: typed.workspacePath,
      path: safeRelativePath,
      written: false,
      approvalId: proposal.approval.id,
      approvalQueued: true,
      message: "Resolved draft write-back is waiting in Approval Center.",
    };
  }

  await assertExecutionAllowed("workspace.revert", { approved: true });
  return executeForkConflictDraftWrite(normalizedRequest);
}

async function executeForkConflictDraftWrite(
  request: DesktopForkConflictDraftWriteRequest,
): Promise<DesktopForkConflictDraftWriteResult> {
  const safeRelativePath = resolveForkConflictDraftPath(request.workspacePath, request.path);
  const diff = await getWorkspaceGitDiff({
    workspacePath: request.workspacePath,
    path: safeRelativePath,
    maxChars: 300_000,
  });
  if (diff.diffHash !== request.expectedDiffHash) {
    throw new Error("File diff changed since approval; reload before writing the resolved draft.");
  }
  const targetPath = resolve(request.workspacePath, safeRelativePath);
  writeFileSync(targetPath, request.draft, "utf8");
  return {
    threadId: request.threadId,
    workspacePath: request.workspacePath,
    path: safeRelativePath,
    written: true,
    message: "Resolved draft was written to the source workspace. Review the new diff before staging.",
  };
}

function normalizeForkConflictDraftWriteRequest(
  request: unknown,
): DesktopForkConflictDraftWriteRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Fork conflict draft write request is invalid.");
  }
  const threadId = getStringProperty(request, "threadId");
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const expectedDiffHash = getStringProperty(request, "expectedDiffHash");
  const rawDraft = (request as Record<string, unknown>).draft;
  if (!threadId || !workspacePath || !path || !expectedDiffHash) {
    throw new Error("Fork conflict draft write request is incomplete.");
  }
  if (typeof rawDraft !== "string") {
    throw new Error("Resolved draft content is required.");
  }
  if (rawDraft.length > 500_000) {
    throw new Error("Resolved draft is too large for inline write-back.");
  }
  if (rawDraft.includes("\u0000")) {
    throw new Error("Resolved draft contains invalid null bytes.");
  }
  return {
    threadId,
    workspacePath,
    path,
    draft: rawDraft,
    expectedDiffHash,
  };
}

function resolveForkConflictDraftPath(workspacePath: string, rawPath: string): string {
  const workspaceRoot = realpathSync(resolve(workspacePath));
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath);
  if (!existsSync(candidate)) {
    throw new Error("Fork conflict draft write-back requires an existing source file.");
  }
  const target = realpathSync(candidate);
  const relativePath = relative(workspaceRoot, target);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Fork conflict draft path escapes the source workspace.");
  }
  return relativePath.replace(/\\/g, "/");
}

function isSameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = realpathSync(resolve(left));
  const normalizedRight = realpathSync(resolve(right));
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

async function proposeChannelOutboundDraft(
  request: unknown,
): Promise<DesktopChannelOutboundDraftResult> {
  if (!request || typeof request !== "object") {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: "Channel outbound draft request must be an object.",
      verification: "No connector proposal was queued.",
    };
  }
  const typed = request as DesktopChannelOutboundDraftRequest;
  if (typed.workspacePath && !(await isAllowedOpenPath(typed.workspacePath))) {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: "Channel outbound workspace is not registered or allowed.",
      verification: "No connector proposal was queued.",
    };
  }
  try {
    const proposal = await proposeDesktopApproval(
      createChannelOutboundDraftApproval(typed),
    );
    let delivery: DesktopChannelOutboundDelivery | undefined;
    if (proposal.approval) {
      pendingChannelOutboundDrafts.set(proposal.approval.id, typed);
    } else if (proposal.allowed && !proposal.blocked) {
      delivery = executeChannelOutboundDelivery(
        typed,
        `connector:auto:${Date.now()}`,
        true,
      );
    }
    return {
      queued: proposal.queued,
      ...(proposal.approval ? { approval: proposal.approval } : {}),
      ...(delivery ? { delivery } : {}),
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
      verification:
        "Outbound channel drafts are approval-gated and do not send until a live connector runtime is configured.",
    };
  } catch (error) {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: error instanceof Error ? error.message : String(error),
      verification: "No connector proposal was queued.",
    };
  }
}

function getWorkspaceMutationActionKind(
  action: WorkspaceMutationAction,
): "workspace.stage" | "workspace.revert" {
  return action === "stage-file" || action === "stage-hunk"
    ? "workspace.stage"
    : "workspace.revert";
}

function getWorkspaceMutationTitle(action: WorkspaceMutationAction): string {
  return {
    "stage-file": "Stage workspace file",
    "revert-file": "Revert workspace file",
    "stage-hunk": "Stage workspace hunk",
    "revert-hunk": "Revert workspace hunk",
  }[action];
}

function getWorkspaceMutationDetail(
  action: WorkspaceMutationAction,
  request: unknown,
): string {
  const path = getStringProperty(request, "path") || "workspace change";
  const workspacePath = getStringProperty(request, "workspacePath");
  const suffix = workspacePath ? ` in ${workspacePath}` : "";
  return `${getWorkspaceMutationTitle(action)}: ${path}${suffix}`;
}

function getWorkspaceMutationIdempotencyKey(
  action: WorkspaceMutationAction,
  request: unknown,
): string {
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const expectedDiffHash = getStringProperty(request, "expectedDiffHash");
  const patch = getStringProperty(request, "patch");
  return [
    "workspace",
    action,
    workspacePath,
    path,
    expectedDiffHash,
    patch ? stableApprovalHash(patch) : "",
  ]
    .filter(Boolean)
    .join(":");
}

function stableApprovalHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getStringProperty(request: unknown, key: string): string {
  if (!request || typeof request !== "object") return "";
  const value = (request as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function createQueuedWorkspaceMutationResult(
  action: WorkspaceMutationAction,
  request: unknown,
  approvalId: string,
): unknown {
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const queued = {
    workspacePath,
    path,
    approvalId,
    approvalQueued: true,
    message: "Workspace change is waiting in Approval Center.",
  };
  if (action === "stage-file") return { ...queued, staged: false };
  if (action === "revert-file") return { ...queued, reverted: false };
  return { ...queued, applied: false };
}

async function executeWorkspaceMutation(
  action: WorkspaceMutationAction,
  request: unknown,
): Promise<unknown> {
  if (action === "stage-file") return stageWorkspaceFile(request);
  if (action === "revert-file") return revertWorkspaceFile(request);
  if (action === "stage-hunk") return stageWorkspaceHunk(request);
  return revertWorkspaceHunk(request);
}

browserUseWorkerClient.on("error-line", (line) => {
  console.warn("[browser-use worker]", line);
});

if (process.env.OPENDRSAI_E2E_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");
}

function createWindow(): void {
  recordE2eStartupTrace("createWindow:start", { appPath: app.getAppPath() });
  const windowIcon = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenDrSai",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fafafe",
      symbolColor: "#5f5870",
      height: 34,
    },
    backgroundColor: "#fafafe",
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordE2eStartupTrace("createWindow:did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  mainWindow.webContents.on("did-finish-load", () => {
    recordE2eStartupTrace("createWindow:did-finish-load", {
      url: mainWindow?.webContents.getURL(),
    });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    recordE2eStartupTrace("createWindow:render-process-gone", { ...details });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedRendererNavigation = isAllowedRendererNavigationUrl(url);
    recordE2eStartupTrace("createWindow:will-navigate", {
      url,
      currentUrl: mainWindow?.webContents.getURL(),
      allowedRendererNavigation,
    });
    if (allowedRendererNavigation) return;
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      const check = checkBrowserUrlSync(params.src);
      if (!check.allowed) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
    },
  );
  configureMainWindowPermissionPolicy(mainWindow);
  registerBrowserWebContentsPolicy();

  maybeRunE2eSmoke(mainWindow);
  recordE2eStartupTrace("createWindow:e2e-hook-registered");

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    if (!isAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
      throw new Error(
        "ELECTRON_RENDERER_URL must point at localhost in development.",
      );
    }
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    recordE2eStartupTrace("createWindow:load-dev-url", { url: process.env.ELECTRON_RENDERER_URL });
  } else {
    const rendererHtmlPath = getRendererHtmlPath();
    const rendererUrl = getRendererUrl();
    recordE2eStartupTrace("createWindow:load-renderer", {
      rendererHtmlPath,
      rendererUrl,
      exists: existsSync(rendererHtmlPath),
    });
    void mainWindow.loadURL(rendererUrl).then(() => {
      recordE2eStartupTrace("createWindow:load-renderer-resolved");
    }).catch((error) => {
      recordE2eStartupTrace("createWindow:load-renderer-rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
      writeE2eStartupFailure("Renderer loadFile failed.", error);
    });
  }
}

function writeE2eStartupFailure(message: string, error: unknown): void {
  if (!isE2eSmokeProcess || !process.env.OPENDRSAI_E2E_RESULT) return;
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  try {
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(
      resultPath,
      `${JSON.stringify(
        {
          ok: false,
          checks: {},
          details: { rendererHtmlPath: getRendererHtmlPath(), appPath: app.getAppPath() },
          error: `${message} ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // The smoke watchdog will still report a timeout if diagnostics cannot be written.
  }
}

function registerDeepLinkProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
        resolve(process.argv[1]),
      ]);
      registerDeepLinkDisplayName();
      return;
    }
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    registerDeepLinkDisplayName();
  } catch (error) {
    console.warn(
      "[desktop] Failed to register deep link protocol:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function registerDeepLinkDisplayName(): void {
  if (process.platform !== "win32") return;
  const protocolKey = `HKCU\\Software\\Classes\\${DEEP_LINK_PROTOCOL}`;
  execFile("reg.exe", [
    "add",
    `${protocolKey}\\Application`,
    "/v",
    "ApplicationName",
    "/t",
    "REG_SZ",
    "/d",
    "OpenDrSai",
    "/f",
  ], (error) => {
    if (error) {
      console.warn("[desktop] Failed to register deep link display name:", error.message);
    }
  });
}

function registerRendererProtocol(): void {
  protocol.registerFileProtocol(RENDERER_PROTOCOL, (request, callback) => {
    try {
      recordE2eStartupTrace("renderer-protocol:request", { url: request.url });
      const rendererRoot = resolve(process.resourcesPath, "renderer");
      const url = new URL(request.url);
      const requestedPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const relativePath = requestedPath || "index.html";
      const targetPath = resolve(rendererRoot, relativePath);
      const localRelative = relative(rendererRoot, targetPath);
      if (
        localRelative.startsWith("..") ||
        isAbsolute(localRelative)
      ) {
        recordE2eStartupTrace("renderer-protocol:forbidden", { targetPath });
        callback({ error: -10 });
        return;
      }
      if (!existsSync(targetPath)) {
        recordE2eStartupTrace("renderer-protocol:not-found", { targetPath });
        callback({ error: -6 });
        return;
      }
      recordE2eStartupTrace("renderer-protocol:served", { targetPath });
      callback({ path: targetPath });
    } catch (error) {
      recordE2eStartupTrace("renderer-protocol:error", {
        error: error instanceof Error ? error.message : String(error),
      });
      callback({ error: -2 });
    }
  });
}

function findDeepLinkArg(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) || null;
}

function handleDeepLinkArgv(argv: string[]): void {
  const deepLink = findDeepLinkArg(argv);
  if (!deepLink) return;
  try {
    const url = new URL(deepLink);
    if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return;
    if (url.hostname !== "auth-complete") return;
    focusMainWindow();
  } catch (error) {
    console.warn(
      "[desktop] Ignored invalid deep link:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function focusMainWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function registerBrowserWebContentsPolicy(): void {
  if (browserWebContentsPolicyRegistered) return;
  browserWebContentsPolicyRegistered = true;
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    configureBrowserSessionPolicy(contents.session);
  });
}

function configureBrowserSessionPolicy(session: Session): void {
  if (configuredBrowserSessions.has(session)) return;
  configuredBrowserSessions.add(session);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.on("will-download", (event) => {
    event.preventDefault();
  });
}

function configureMainWindowPermissionPolicy(window: BrowserWindow): void {
  const allowedWebContentsId = window.webContents.id;
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes =
      "mediaTypes" in details && Array.isArray(details.mediaTypes)
        ? details.mediaTypes
        : [];
    callback(
      permission === "media" &&
        contents.id === allowedWebContentsId &&
        mediaTypes.includes("audio") &&
        !mediaTypes.includes("video"),
    );
  });
}

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.png"),
        join(process.cwd(), "build", "icon.png"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isAllowedDevRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "http:" &&
      TRUSTED_DEV_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isAllowedRendererNavigationUrl(rawUrl: string): boolean {
  if (is.dev && isAllowedDevRendererUrl(rawUrl)) return true;
  if (app.isPackaged && rawUrl === getRendererUrl()) return true;
  return false;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  if (frameUrl === mainWindow.webContents.getURL()) return true;
  if (is.dev) return isAllowedDevRendererUrl(frameUrl);
  return false;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Blocked untrusted desktop IPC caller.");
  }
}

function secureHandle<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: T) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function isAllowedLocalPath(rawPath: unknown): boolean {
  if (typeof rawPath !== "string" || !rawPath) return false;
  if (!existsSync(rawPath)) return false;
  const root = realpathSync.native(resolve(DRSAI_HOME));
  const target = realpathSync.native(resolve(rawPath));
  const localRelative = relative(root, target);
  return (
    localRelative === "" ||
    (!localRelative.startsWith("..") && !isAbsolute(localRelative))
  );
}

async function isAllowedOpenPath(rawPath: unknown): Promise<boolean> {
  if (isAllowedLocalPath(rawPath)) return true;
  if (typeof rawPath !== "string" || !rawPath || !existsSync(rawPath))
    return false;
  const target = realpathSync.native(resolve(rawPath));
  const workspaces = await listWorkspaces();
  return workspaces.some((workspace) => {
    if (!existsSync(workspace.path)) return false;
    const root = realpathSync.native(resolve(workspace.path));
    const relativePath = relative(root, target);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  });
}

function registerIpc(): void {
  registerBrowserController(new ElectronWebviewController());
  registerBrowserController(new BrowserUseController(browserUseWorkerClient));
  secureHandle("desktop:get-auth-session", () => getAuthSession());
  secureHandle("desktop:login", (_event, request) => login(request));
  secureHandle("desktop:start-oidc-login", async (event, request) => {
    const result = await startOidcLogin(request, (debugEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:oidc-login-debug", debugEvent);
      }
    });
    if (result.ok) focusMainWindow();
    return result;
  });
  secureHandle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  secureHandle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  secureHandle("desktop:start-wechat-desktop-login", () =>
    startWechatDesktopLogin(),
  );
  secureHandle("desktop:poll-desktop-sso-login", (_event, deviceCode: string) =>
    pollDesktopSsoLogin(deviceCode),
  );
  secureHandle(
    "desktop:cancel-desktop-sso-login",
    (_event, deviceCode: string) => cancelDesktopSsoLogin(deviceCode),
  );
  secureHandle("desktop:logout", (_event, options) => {
    stopGateway();
    return logout(options);
  });
  secureHandle("desktop:refresh-auth-session", () => refreshAuthSession());
  secureHandle("desktop:bootstrap", () => bootstrapDesktop());
  secureHandle("desktop:get-health", () => getDesktopHealth());
  secureHandle("desktop:get-install-status", () => getInstallStatus());
  secureHandle("desktop:get-gateway-status", () => getGatewayStatus());
  secureHandle("desktop:check-for-updates", (event) => {
    subscribeUpdateStatus(event.sender);
    return checkForUpdates();
  });

  secureHandle("desktop:open-external", async (_event, rawUrl: string) => {
    if (!isAllowedExternalUrl(rawUrl)) return;
    await shell.openExternal(rawUrl);
  });

  secureHandle("desktop:open-path", async (_event, rawPath: string) => {
    if (!(await isAllowedOpenPath(rawPath))) {
      return "Path is not registered as a DrSai or workspace path.";
    }
    return shell.openPath(rawPath);
  });

  secureHandle("desktop:ide-context", (_event, workspacePath: string) =>
    getIdeContext(workspacePath),
  );

  secureHandle("desktop:get-file-icon", async (_event, rawPath: string) => {
    if (!(await isAllowedOpenPath(rawPath))) {
      return { path: rawPath, dataUrl: null };
    }
    try {
      const icon = await app.getFileIcon(rawPath, { size: "normal" });
      return {
        path: rawPath,
        dataUrl: icon.isEmpty() ? null : icon.toDataURL(),
      };
    } catch {
      return { path: rawPath, dataUrl: null };
    }
  });

  secureHandle("desktop:start-install", async (event, options) => {
    await startInstall(event.sender, options ?? {});
  });
  secureHandle("desktop:cancel-install", () => cancelInstall());

  secureHandle("desktop:start-gateway", () => startGateway());
  secureHandle("desktop:stop-gateway", () => stopGateway());
  secureHandle(
    "desktop:terminal-create",
    async (event, options: TerminalCreateOptions | undefined) => {
      await assertExecutionAllowed("terminal.create", { approved: true });
      return createTerminalSession(event, options);
    },
  );
  secureHandle("desktop:terminal-list", (event, workspaceKey?: string) =>
    listTerminalSessions(event, workspaceKey),
  );
  secureHandle("desktop:terminal-buffer", (event, id: string) =>
    getTerminalBuffer(event, id),
  );
  secureHandle("desktop:terminal-rename", (event, id: string, title: string) =>
    renameTerminalSession(event, id, title),
  );
  secureHandle("desktop:terminal-write", async (event, id: string, data: string) => {
    await assertExecutionAllowed("terminal.write", { approved: true });
    return writeTerminalSession(event, id, data);
  });
  secureHandle(
    "desktop:terminal-resize",
    (event, id: string, cols: number, rows: number) =>
      resizeTerminalSession(event, id, cols, rows),
  );
  secureHandle("desktop:terminal-kill", (event, id: string) =>
    killTerminalSession(event, id),
  );
  secureHandle("desktop:list-workspaces", () => listWorkspaces());
  secureHandle("desktop:create-workspace", (_event, request) =>
    createWorkspace(request),
  );
  secureHandle("desktop:update-workspace", (_event, request) =>
    updateWorkspace(request),
  );
  secureHandle("desktop:delete-workspace", (_event, id: string) =>
    deleteWorkspace(id),
  );
  secureHandle("desktop:workspace-context-overview", (_event, workspacePath: string) =>
    getWorkspaceContextOverview(workspacePath),
  );
  secureHandle("desktop:workspace-files", (_event, request) =>
    listWorkspaceFiles(request),
  );
  secureHandle("desktop:workspace-folder-summary", (_event, request) =>
    summarizeWorkspaceFolder(request),
  );
  secureHandle("desktop:workspace-file-preview", (_event, request) =>
    previewWorkspaceFile(request),
  );
  secureHandle("desktop:workspace-git-diff", (_event, request) =>
    getWorkspaceGitDiff(request),
  );
  secureHandle("desktop:workspace-git-file-at-ref", (_event, request) =>
    getWorkspaceGitFileAtRef(request),
  );
  secureHandle("desktop:workspace-revert-file", async (_event, request) =>
    requestWorkspaceMutationApproval("revert-file", request),
  );
  secureHandle("desktop:workspace-stage-file", async (_event, request) =>
    requestWorkspaceMutationApproval("stage-file", request),
  );
  secureHandle("desktop:workspace-stage-hunk", async (_event, request) =>
    requestWorkspaceMutationApproval("stage-hunk", request),
  );
  secureHandle("desktop:workspace-revert-hunk", async (_event, request) =>
    requestWorkspaceMutationApproval("revert-hunk", request),
  );
  secureHandle("desktop:workspace-checkpoints-list", async (_event, workspacePath: string) => {
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    return listWorkspaceCheckpoints(workspacePath);
  });
  secureHandle("desktop:workspace-checkpoint-create", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    await assertExecutionAllowed("workspace.checkpoint");
    return createWorkspaceCheckpoint(request);
  });
  secureHandle("desktop:workspace-checkpoint-preview", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    return previewWorkspaceCheckpoint(request);
  });
  secureHandle("desktop:workspace-checkpoint-restore", async (_event, request) =>
    requestWorkspaceCheckpointRestore(request),
  );
  secureHandle("desktop:fork-conflict-draft-write", async (_event, request) =>
    requestForkConflictDraftWrite(request),
  );
  secureHandle("desktop:list-threads", () => listThreads());
  secureHandle("desktop:list-agents", () => listAgents());
  secureHandle("desktop:get-my-drsai-config", async (_event, workspacePath?: string) => {
    if (workspacePath && !(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Tokenizer calibration workspace is not registered or allowed.");
    }
    return getMyDrSaiConfig(workspacePath);
  });
  secureHandle("desktop:update-my-drsai-config", (_event, request: UpdateMyDrSaiConfigRequest) =>
    updateMyDrSaiConfig(request),
  );
  secureHandle("desktop:create-thread", (_event, request) =>
    createThread(request),
  );
  secureHandle("desktop:update-thread", (_event, request) =>
    updateThread(request),
  );
  secureHandle("desktop:get-thread-snapshot", (_event, threadId) =>
    getThreadSnapshot(threadId),
  );
  secureHandle("desktop:update-thread-snapshot", (_event, snapshot) =>
    updateThreadSnapshot(snapshot),
  );
  secureHandle("desktop:prepare-fork-worktree", (_event, request) =>
    prepareForkWorktree(request),
  );
  secureHandle("desktop:project-memory-list", (_event, request) =>
    listProjectMemory(request),
  );
  secureHandle("desktop:project-memory-add", (_event, request) =>
    addProjectMemory(request),
  );
  secureHandle("desktop:project-memory-update", (_event, request) =>
    updateProjectMemory(request),
  );
  secureHandle("desktop:project-memory-clear", (_event, request) =>
    clearProjectMemory(request),
  );
  secureHandle("desktop:custom-commands-list", (_event, request) =>
    listCustomCommands(request),
  );
  secureHandle("desktop:custom-command-upsert", (_event, request) =>
    upsertCustomCommand(request),
  );
  secureHandle("desktop:custom-command-delete", (_event, request) =>
    deleteCustomCommand(request),
  );
  secureHandle("desktop:project-skill-drafts-list", (_event, request) =>
    listProjectSkillDrafts(request),
  );
  secureHandle("desktop:project-skill-draft-create", (_event, request) =>
    createProjectSkillDraft(request),
  );
  secureHandle("desktop:project-skill-draft-install", (_event, request) =>
    installProjectSkillDraft(request),
  );
  secureHandle("desktop:project-skill-draft-publish", (_event, request) =>
    publishProjectSkillDraft(request),
  );
  secureHandle("desktop:workflow-marketplace-list", (_event, workspacePath) =>
    listWorkflowMarketplace(workspacePath),
  );
  secureHandle("desktop:workflow-marketplace-sync", (_event, request) =>
    syncWorkflowMarketplace(request),
  );
  secureHandle("desktop:workflow-run-prepare", (_event, request) =>
    prepareWorkflowRun(request),
  );
  secureHandle("desktop:workflow-run-start", async (_event, request) => {
    const result = await startWorkflowRun(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:workflow-runs-list", (_event, workspacePath?: string) =>
    listWorkflowRuns(workspacePath),
  );
  secureHandle("desktop:workflow-run-step-dispatch", async (_event, request) => {
    const result = await dispatchWorkflowRunStep(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:workflow-run-step-complete", async (_event, request) => {
    const result = await completeWorkflowRunStep(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:background-tasks-list", (_event, request) =>
    listBackgroundTasks(request),
  );
  secureHandle("desktop:background-task-enqueue", (_event, request) =>
    enqueueBackgroundTask(request),
  );
  secureHandle("desktop:background-task-update", (_event, request) =>
    updateBackgroundTask(request),
  );
  secureHandle("desktop:scheduled-tasks-list", (_event, request) =>
    listScheduledTasks(request),
  );
  secureHandle("desktop:scheduled-task-create", (_event, request) =>
    createScheduledTask(request),
  );
  secureHandle("desktop:scheduled-task-update", (_event, request) =>
    updateScheduledTask(request),
  );
  secureHandle("desktop:scheduled-tasks-run-due", (_event, request) =>
    runDueScheduledTasksAndMirror(request),
  );
  secureHandle("desktop:scheduled-task-worker-status", () =>
    getScheduledTaskWorkerStatus(),
  );
  secureHandle("desktop:channel-adapters-list", (_event, workspacePath?: string) =>
    listChannelAdapters(workspacePath),
  );
  secureHandle(
    "desktop:channel-adapter-configure",
    (_event, request: DesktopChannelAdapterConfigureRequest) =>
      configureChannelAdapter(request),
  );
  secureHandle(
    "desktop:channel-adapter-auth-start",
    (_event, request: DesktopChannelAdapterAuthStartRequest) =>
      startChannelAdapterAuth(request),
  );
  secureHandle(
    "desktop:channel-context-import",
    (_event, request: DesktopChannelContextImportRequest) =>
      importChannelContext(request),
  );
  secureHandle(
    "desktop:channel-snapshot-sync",
    (_event, request: DesktopChannelSnapshotSyncRequest) =>
      syncChannelSnapshots(request),
  );
  secureHandle(
    "desktop:channel-inbound-events",
    (_event, request?: DesktopChannelInboundEventListRequest) =>
      listChannelInboundEvents(request),
  );
  secureHandle(
    "desktop:channel-inbound-route",
    (_event, request: DesktopChannelInboundEventRouteRequest) =>
      routeChannelInboundEvent(request),
  );
  secureHandle(
    "desktop:channel-outbound-draft",
    (_event, request: DesktopChannelOutboundDraftRequest) =>
      proposeChannelOutboundDraft(request),
  );
  secureHandle("desktop:channel-outbound-deliveries", (_event, request?: DesktopChannelOutboundDeliveryListRequest) =>
    listChannelOutboundDeliveries(request),
  );
  secureHandle(
    "desktop:mcp-context-import",
    (_event, request: DesktopMcpContextRequest) => importMcpContext(request),
  );
  secureHandle("desktop:mcp-live-enumerate", (_event, request) =>
    requestMcpLiveEnumeration(request),
  );
  secureHandle("desktop:mcp-tool-execution-approval", (_event, request) =>
    requestMcpToolExecutionApproval(request),
  );
  secureHandle(
    "desktop:mcp-execution-audits",
    (_event, request: DesktopMcpToolExecutionAuditListRequest) =>
      listMcpToolExecutionAudits(request),
  );
  secureHandle(
    "desktop:mcp-session-audits",
    (_event, request: DesktopMcpSessionAuditListRequest) =>
      listMcpSessionAudits(request),
  );
  secureHandle(
    "desktop:mcp-active-sessions",
    (_event, request: DesktopMcpActiveSessionListRequest) =>
      listMcpActiveSessions(request),
  );
  secureHandle(
    "desktop:mcp-reusable-sessions",
    (_event, request: DesktopMcpReusableSessionListRequest) =>
      listMcpReusableSessions(request),
  );
  secureHandle(
    "desktop:mcp-reusable-session-close",
    (_event, request: DesktopMcpReusableSessionCloseRequest) =>
      closeMcpReusableSession(request),
  );
  secureHandle(
    "desktop:mcp-session-cancel",
    (_event, request: DesktopMcpSessionCancelRequest) =>
      cancelMcpActiveSession(request),
  );
  secureHandle("desktop:start-chat", (event, request) =>
    startChat(event.sender, request),
  );
  secureHandle("desktop:abort-chat", (_event, requestId: string) =>
    abortChat(requestId),
  );
  secureHandle(
    "desktop:voice-transcription-start",
    (event, request: DesktopVoiceTranscriptionRequest) =>
      startVoiceTranscription(event.sender, request),
  );
  secureHandle(
    "desktop:voice-transcription-cancel",
    (_event, requestId: string) => cancelVoiceTranscription(requestId),
  );
  secureHandle(
    "desktop:voice-runtime-status",
    () => getVoiceRuntimeStatus(),
  );
  secureHandle(
    "desktop:voice-handoff-write",
    async (_event, request: DesktopVoiceTranscriptHandoffRequest) => {
      const workspacePath = getStringProperty(request, "workspacePath");
      if (!(await isAllowedOpenPath(workspacePath))) {
        throw new Error("Voice handoff workspace is not registered or allowed.");
      }
      return writeVoiceTranscriptHandoff(request);
    },
  );
  secureHandle("desktop:start-agent-run", (event, request) =>
    startAgentRun(event.sender, request),
  );
  secureHandle("desktop:abort-agent-run", (_event, requestId: string) =>
    abortAgentRun(requestId),
  );
  secureHandle("desktop:save-api-key", (_event, apiKey: string, defaultModel?: string) => {
    if (!is.dev) {
      return { ok: false, message: "This build receives service authorization through HepAI OIDC." };
    }
    return saveApiKeyAndDefaultModel(apiKey, defaultModel);
  });
  secureHandle("desktop:pick-files", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add files",
      properties: ["openFile", "multiSelections"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:pick-folder", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add folder",
      properties: ["openDirectory"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:browser-check-url", (_event, rawUrl: string) =>
    checkBrowserUrlSync(rawUrl),
  );
  secureHandle("desktop:browser-action-request", (_event, request) =>
    approveBrowserActionRequest(request),
  );
  secureHandle("desktop:browser-task-start", async (event, request) => {
    const startRequest = toBrowserTaskStartRequest(request);
    if (!startRequest) {
      throw new Error("Invalid browser task start request.");
    }
    browserTaskSubscribers.add(event.sender);
    const install = await getInstallStatus();
    const pythonCommand = resolveBrowserUsePythonCommand(
      install.pythonPath || install.prerequisites.pythonCommand,
    );
    browserUseWorkerClient.start(pythonCommand);
    const command = createBrowserUseTaskCommand(startRequest);
    initializeBrowserTaskTrace(command.taskId, startRequest);
    browserUseWorkerClient.send(command);
    return { taskId: command.taskId };
  });
  secureHandle("desktop:browser-task-stop", (_event, request) => {
    if (!request || typeof request !== "object") return false;
    const taskId = (request as { taskId?: unknown }).taskId;
    if (typeof taskId !== "string" || !taskId.trim()) return false;
    browserUseWorkerClient.send({ type: "task.stop", taskId });
    return true;
  });
  secureHandle("desktop:browser-task-pending-approvals", () =>
    [...pendingBrowserTaskApprovals.values()].sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp),
    ),
  );
  secureHandle("desktop:propose-approval", (_event, request) =>
    proposeDesktopApproval(request),
  );
  secureHandle("desktop:shell-command-approval", (event, request) =>
    requestTerminalShellCommandApproval(event, request),
  );
  secureHandle("desktop:git-commit-approval", (_event, request) =>
    requestGitCommitApproval(request),
  );
  secureHandle("desktop:fork-lifecycle-approval", (_event, request) =>
    requestForkLifecycleApproval(request),
  );
  secureHandle("desktop:fork-queue-start-approval", (_event, request) =>
    requestForkQueueStartApproval(request),
  );
  secureHandle("desktop:fork-queue-dispatch", (event, request) =>
    dispatchForkQueue(event.sender, request),
  );
  secureHandle("desktop:pending-approvals", () =>
    [...pendingDesktopApprovals.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  );
  secureHandle("desktop:decide-approval", (event, request) =>
    decidePendingDesktopApproval(event, request),
  );
  secureHandle("desktop:browser-task-approve", (_event, request) => {
    const approvalRequest = toBrowserTaskApprovalRequest(request);
    if (!approvalRequest) return false;
    pendingBrowserTaskApprovals.delete(approvalRequest.actionId);
    pendingDesktopApprovals.delete(
      createBrowserTaskApprovalId(
        approvalRequest.taskId,
        approvalRequest.actionId,
      ),
    );
    browserUseWorkerClient.send({
      type: "action.approve",
      taskId: approvalRequest.taskId,
      actionId: approvalRequest.actionId,
      approved: approvalRequest.approved,
    });
    return true;
  });
}

async function decidePendingDesktopApproval(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<boolean> {
  if (!request || typeof request !== "object") return false;
  const typed = request as { id?: unknown; approved?: unknown };
  if (typeof typed.id !== "string" || typeof typed.approved !== "boolean") {
    return false;
  }
  const decisionReason =
    (request as { reason?: unknown }).reason === "cancel" ? "cancel" : "reject";
  const approval = pendingDesktopApprovals.get(typed.id);
  if (!approval) return false;
  pendingDesktopApprovals.delete(typed.id);
  const pendingShellCommand = pendingShellCommandApprovals.get(typed.id);
  pendingShellCommandApprovals.delete(typed.id);
  const pendingWorkspaceMutation = pendingWorkspaceMutationApprovals.get(typed.id);
  pendingWorkspaceMutationApprovals.delete(typed.id);
  const pendingWorkspaceCheckpointRestore = pendingWorkspaceCheckpointRestores.get(typed.id);
  pendingWorkspaceCheckpointRestores.delete(typed.id);
  const pendingGitCommit = pendingGitCommitApprovals.get(typed.id);
  pendingGitCommitApprovals.delete(typed.id);
  const pendingForkLifecycle = pendingForkLifecycleApprovals.get(typed.id);
  pendingForkLifecycleApprovals.delete(typed.id);
  const pendingForkQueueStart = pendingForkQueueStartApprovals.get(typed.id);
  pendingForkQueueStartApprovals.delete(typed.id);
  const pendingForkConflictDraftWrite = pendingForkConflictDraftWrites.get(typed.id);
  pendingForkConflictDraftWrites.delete(typed.id);
  const pendingChannelOutboundDraft = pendingChannelOutboundDrafts.get(typed.id);
  pendingChannelOutboundDrafts.delete(typed.id);
  const pendingMcpLiveEnumeration = pendingMcpLiveEnumerations.get(typed.id);
  pendingMcpLiveEnumerations.delete(typed.id);
  const pendingMcpToolExecution = pendingMcpToolExecutions.get(typed.id);
  pendingMcpToolExecutions.delete(typed.id);
  if (
    approval.source === "browser_task" &&
    approval.taskId &&
    approval.actionId
  ) {
    pendingBrowserTaskApprovals.delete(approval.actionId);
    browserUseWorkerClient.send({
      type: "action.approve",
      taskId: approval.taskId,
      actionId: approval.actionId,
      approved: typed.approved,
    });
  }
  if (pendingShellCommand) {
    if (!typed.approved) return true;
    await assertExecutionAllowed("shell.command", { approved: true });
    const wrote = writeTerminalSession(
      event,
      pendingShellCommand.terminalSessionId,
      pendingShellCommand.invocation,
    );
    if (wrote) {
      await markShellWorkflowStepRunning(pendingShellCommand);
    }
    return wrote;
  }
  if (pendingWorkspaceMutation) {
    if (!typed.approved) return true;
    await assertExecutionAllowed(
      getWorkspaceMutationActionKind(pendingWorkspaceMutation.action),
      { approved: true },
    );
    await executeWorkspaceMutation(
      pendingWorkspaceMutation.action,
      pendingWorkspaceMutation.request,
    );
    return true;
  }
  if (pendingWorkspaceCheckpointRestore) {
    if (!typed.approved) return true;
    await assertExecutionAllowed("workspace.revert", { approved: true });
    await restoreWorkspaceCheckpoint(pendingWorkspaceCheckpointRestore);
    return true;
  }
  if (pendingGitCommit) {
    if (!typed.approved) return true;
    await assertExecutionAllowed("git.commit", { approved: true });
    await executeGitCommit(pendingGitCommit);
    return true;
  }
  if (pendingForkLifecycle) {
    if (!typed.approved) return true;
    await executeForkLifecycleApproval(pendingForkLifecycle);
    return true;
  }
  if (pendingForkQueueStart) {
    await executeForkQueueStartApproval(pendingForkQueueStart, typed.approved);
    return true;
  }
  if (pendingForkConflictDraftWrite) {
    if (!typed.approved) return true;
    await assertExecutionAllowed("workspace.revert", { approved: true });
    await executeForkConflictDraftWrite(pendingForkConflictDraftWrite);
    return true;
  }
  if (pendingChannelOutboundDraft) {
    if (typed.approved) {
      await assertExecutionAllowed("external.service", { approved: true });
    }
    executeChannelOutboundDelivery(
      pendingChannelOutboundDraft,
      typed.id,
      typed.approved,
    );
    return true;
  }
  if (pendingMcpLiveEnumeration) {
    if (!typed.approved) {
      if (decisionReason === "cancel") {
        recordCancelledMcpLiveEnumerationAudit(pendingMcpLiveEnumeration, typed.id);
      }
      return true;
    }
    await assertExecutionAllowed("network.request", { approved: true });
    await enumerateMcpLiveServer(pendingMcpLiveEnumeration);
    return true;
  }
  if (pendingMcpToolExecution) {
    if (!typed.approved) {
      if (decisionReason === "cancel") {
        recordCancelledMcpToolExecutionAudit(pendingMcpToolExecution, typed.id);
      } else {
        recordRejectedMcpToolExecutionAudit(pendingMcpToolExecution, typed.id);
      }
      return true;
    }
    await assertExecutionAllowed("external.service", { approved: true });
    await executeMcpToolAfterApproval(pendingMcpToolExecution, typed.id);
    return true;
  }
  return true;
}

async function markShellWorkflowStepRunning(request: {
  workflowRunId?: string;
  workflowStepId?: string;
}): Promise<void> {
  if (!request.workflowRunId || !request.workflowStepId) return;
  const run = await markWorkflowRunTerminalStepRunning({
    runId: request.workflowRunId,
    stepId: request.workflowStepId,
  });
  if (run) {
    await upsertBackgroundTaskForWorkflowRun(run);
  }
}

function resolveBrowserUsePythonCommand(preferredPython?: string | null): string {
  if (process.env.OPENDRSAI_BROWSER_USE_PYTHON) {
    return process.env.OPENDRSAI_BROWSER_USE_PYTHON;
  }
  const python311 = "C:\\Python311\\python.exe";
  if (existsSync(python311)) return python311;
  return preferredPython || process.env.PYTHON || "python";
}

function toBrowserTaskStartRequest(
  request: unknown,
): BrowserTaskStartRequest | null {
  if (!request || typeof request !== "object") return null;
  const typed = request as Partial<BrowserTaskStartRequest>;
  if (typeof typed.instruction !== "string" || !typed.instruction.trim()) {
    return null;
  }
  return {
    taskId: typeof typed.taskId === "string" ? typed.taskId : undefined,
    instruction: typed.instruction,
    url: typeof typed.url === "string" ? typed.url : undefined,
    engine: typed.engine === "browser-use" || typed.engine === "electron-webview" ? typed.engine : "browser-use",
    workspacePath: typeof typed.workspacePath === "string" ? typed.workspacePath : undefined,
  };
}

function toBrowserTaskApprovalRequest(
  request: unknown,
): BrowserTaskApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const typed = request as Partial<BrowserTaskApprovalRequest>;
  if (typeof typed.taskId !== "string" || !typed.taskId.trim()) return null;
  if (typeof typed.actionId !== "string" || !typed.actionId.trim()) return null;
  if (typeof typed.approved !== "boolean") return null;
  return {
    taskId: typed.taskId,
    actionId: typed.actionId,
    approved: typed.approved,
  };
}

async function autoStartGatewayWhenInstalled(): Promise<void> {
  try {
    const install = await getInstallStatus();
    if (!install.installed) return;
    await startGateway();
  } catch (error) {
    console.warn(
      "[desktop] Gateway autostart skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

app.whenReady().then(() => {
  cleanupExpiredVoiceTempFiles();
  if (!singleInstanceLock) return;
  if (process.env.OPENDRSAI_E2E_OIDC_HEADLESS === "1") {
    void runHeadlessOidcSmoke();
    return;
  }
  registerDeepLinkProtocol();
  registerRendererProtocol();
  registerIpc();
  createWindow();
  handleDeepLinkArgv(process.argv);
  void recoverWorkflowRunStateAfterRestart().finally(() => {
    startScheduledTaskWorkerIfEnabled();
  });
  void autoStartGatewayWhenInstalled();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void autoStartGatewayWhenInstalled();
    }
  });
});

async function runHeadlessOidcSmoke(): Promise<void> {
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    app.exit(1);
    return;
  }
  const result: {
    ok: boolean;
    checks: Record<string, boolean>;
    details: Record<string, unknown>;
    error?: string;
  } = { ok: false, checks: {}, details: {} };
  try {
    const loginResult = await startOidcLogin({ rememberMe: true });
    result.details.login = {
      ok: loginResult.ok,
      message: loginResult.message,
      session: loginResult.session,
    };
    result.checks.oidcLoginOk = Boolean(loginResult.ok);
    result.checks.oidcPublicSession = publicSessionLooksHeadlessOidc(
      loginResult.session,
    );

    const bootstrap = await bootstrapDesktop();
    result.details.bootstrap = bootstrap;
    result.checks.oidcBootstrapReady = Boolean(
      bootstrap.ready &&
      bootstrap.defaults.modelAlias === "drsai" &&
      bootstrap.models.some((model) => model.id === "drsai") &&
      bootstrap.capabilities.chat &&
      bootstrap.capabilities.tools.includes("files") &&
      bootstrap.capabilities.tools.includes("shell") &&
      bootstrap.capabilities.tools.includes("git"),
    );

    const restored = await getAuthSession();
    result.details.restored = restored;
    result.checks.restoredSession = publicSessionLooksHeadlessOidc(restored);

    const refreshed = await refreshAuthSession();
    result.details.refreshed = refreshed;
    result.checks.refreshSession = publicSessionLooksHeadlessOidc(refreshed);

    const authContext = await requireAuthContext();
    result.details.authContext = {
      userId: authContext.userId,
      authMode: authContext.authMode,
      hasAccessToken: Boolean(authContext.accessToken),
      publicSession: authContext.session,
    };
    result.checks.authContextUsesOidc = authContext.authMode === "oidc";
    result.checks.authContextHasBearerToken = Boolean(authContext.accessToken);
    result.checks.authContextPublicSession = publicSessionLooksHeadlessOidc(
      authContext.session,
    );

    const gatewayEvents: Array<{ channel: string; event: Record<string, unknown> }> = [];
    const gatewayWebContents = {
      send(channel: string, event: Record<string, unknown>) {
        gatewayEvents.push({ channel, event });
      },
    } as unknown as WebContents;

    const chatRequestId = "e2e-oidc-chat-0001";
    result.details.oidcChatReturnedRequestId = startChat(gatewayWebContents, {
      requestId: chatRequestId,
      model: "drsai",
      messages: [{ role: "user", content: "oidc chat bearer check" }],
    });
    await waitForHeadlessGatewayTerminal(gatewayEvents, chatRequestId);
    const chatEvents = gatewayEvents
      .filter((item) => item.channel === "desktop:chat-event" && item.event.requestId === chatRequestId)
      .map((item) => item.event);
    result.details.oidcChatEvents = summarizeHeadlessGatewayEvents(chatEvents);
    result.checks.oidcChatStart = chatEvents.some((event) => event.type === "start");
    result.checks.oidcChatChunk = chatEvents.some(
      (event) => event.type === "chunk" && String(event.content || "").includes("oidc chat bearer ok"),
    );
    result.checks.oidcChatDone = chatEvents.some((event) => event.type === "done");
    result.checks.oidcChatNoError = !chatEvents.some((event) => event.type === "error" || event.type === "aborted");

    const agentRequestId = "e2e-oidc-agent-0001";
    result.details.oidcAgentReturned = await startAgentRun(gatewayWebContents, {
      requestId: agentRequestId,
      sessionId: "e2e-oidc-agent-session",
      runId: "e2e-oidc-agent-run",
      task: "oidc agent bearer check",
      model: "drsai",
      metadata: { source: "e2e-oidc" },
    });
    await waitForHeadlessGatewayTerminal(gatewayEvents, agentRequestId);
    const agentEvents = gatewayEvents
      .filter((item) => item.channel === "desktop:agent-run-event" && item.event.requestId === agentRequestId)
      .map((item) => item.event);
    result.details.oidcAgentEvents = summarizeHeadlessGatewayEvents(agentEvents);
    result.checks.oidcAgentStart = agentEvents.some((event) => event.type === "start");
    result.checks.oidcAgentChunk = agentEvents.some(
      (event) => event.type === "chunk" && String(event.content || "").includes("oidc agent bearer ok"),
    );
    result.checks.oidcAgentDone = agentEvents.some((event) => event.type === "done");
    result.checks.oidcAgentNoError = !agentEvents.some((event) => event.type === "error" || event.type === "aborted");

    const storage = readHeadlessOidcStorage();
    result.details.storage = storage.details;
    result.checks.sessionFileExists = storage.checks.exists;
    result.checks.sessionUsesEncryptedTokens =
      storage.checks.usesEncryptedTokens;
    result.checks.sessionOmitsPlainTokens = storage.checks.omitsPlainTokens;

    const logoutResult = await logout({ clearLocalData: false });
    result.details.logout = logoutResult;
    result.checks.logoutOk = Boolean(logoutResult.ok);
    const afterLogout = await getAuthSession();
    result.details.afterLogout = afterLogout;
    result.checks.afterLogoutAnonymous = Boolean(
      afterLogout.authenticated === false,
    );
    result.checks.logoutClearsSessionFile = !existsSync(
      join(DRSAI_HOME, "auth", "auth.json"),
    );

    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  app.exit(result.ok ? 0 : 1);
}

async function waitForHeadlessGatewayTerminal(
  events: Array<{ event: Record<string, unknown> }>,
  requestId: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      events.some(
        (item) =>
          item.event.requestId === requestId &&
          (item.event.type === "done" ||
            item.event.type === "error" ||
            item.event.type === "aborted"),
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function summarizeHeadlessGatewayEvents(
  events: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return events.map((event) => ({
    type: event.type,
    requestId: event.requestId,
    content: event.content,
    error: event.error,
  }));
}

function publicSessionLooksHeadlessOidc(
  session: Awaited<ReturnType<typeof getAuthSession>> | null,
): boolean {
  if (!session) return false;
  const asRecord = session as unknown as Record<string, unknown>;
  const strictFakeUser =
    !process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER &&
    session.user?.id === "e2e-hai-user" &&
    session.user?.email === "e2e-hai-user@ihep.ac.cn";
  const externalIssuerUser =
    Boolean(process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER) &&
    Boolean(session.user?.id) &&
    Boolean(session.user?.name || session.user?.email);
  return Boolean(
    session.authenticated === true &&
    session.authMode === "oidc" &&
    session.authProvider === "hai" &&
    session.user &&
    (strictFakeUser || externalIssuerUser) &&
    session.refreshable === true &&
    !("accessToken" in asRecord) &&
    !("refreshToken" in asRecord) &&
    !("idToken" in asRecord),
  );
}

function readHeadlessOidcStorage(): {
  checks: {
    exists: boolean;
    usesEncryptedTokens: boolean;
    omitsPlainTokens: boolean;
  };
  details: Record<string, unknown>;
} {
  const sessionPath = join(DRSAI_HOME, "auth", "auth.json");
  if (!existsSync(sessionPath)) {
    return {
      checks: {
        exists: false,
        usesEncryptedTokens: false,
        omitsPlainTokens: false,
      },
      details: { sessionPath, exists: false },
    };
  }
  const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<
    string,
    unknown
  >;
  return {
    checks: {
      exists: true,
      usesEncryptedTokens: Boolean(
        parsed.encryptedAccessToken &&
        parsed.encryptedRefreshToken &&
        parsed.encryptedIdToken,
      ),
      omitsPlainTokens:
        !("accessToken" in parsed) &&
        !("refreshToken" in parsed) &&
        !("idToken" in parsed),
    },
    details: {
      sessionPath,
      exists: true,
      keys: Object.keys(parsed).sort(),
      authMode: parsed.authMode,
      authProvider: parsed.authProvider,
      hasEncryptedAccessToken: Boolean(parsed.encryptedAccessToken),
      hasEncryptedRefreshToken: Boolean(parsed.encryptedRefreshToken),
      hasEncryptedIdToken: Boolean(parsed.encryptedIdToken),
      hasPlainAccessToken: "accessToken" in parsed,
      hasPlainRefreshToken: "refreshToken" in parsed,
      hasPlainIdToken: "idToken" in parsed,
    },
  };
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let gatewayShutdownComplete = false;
let gatewayShutdownStarted = false;

app.on("before-quit", (event) => {
  stopScheduledTaskWorker();
  killAllTerminalSessions();
  if (gatewayShutdownComplete) return;
  event.preventDefault();
  if (gatewayShutdownStarted) return;
  gatewayShutdownStarted = true;
  void shutdownGateway()
    .catch((error) => {
      console.error("[desktop] Failed to stop gateway during shutdown:", error);
    })
    .finally(() => {
      gatewayShutdownComplete = true;
      app.quit();
    });
});
