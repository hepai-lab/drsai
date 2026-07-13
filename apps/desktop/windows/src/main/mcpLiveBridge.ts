import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  DesktopMcpActiveSession,
  DesktopMcpActiveSessionListRequest,
  DesktopMcpLiveEnumerationRequest,
  DesktopMcpLiveEnumerationResult,
  DesktopMcpLiveServerSummary,
  DesktopMcpReusableSession,
  DesktopMcpReusableSessionCloseRequest,
  DesktopMcpReusableSessionCloseResult,
  DesktopMcpReusableSessionListRequest,
  DesktopMcpSessionCancelRequest,
  DesktopMcpSessionCancelResult,
  DesktopMcpSessionAuditEntry,
  DesktopMcpSessionAuditListRequest,
  DesktopMcpSessionAuditPhase,
  DesktopMcpSessionAuditStatus,
  DesktopMcpToolExecutionAuditEntry,
  DesktopMcpToolExecutionAuditListRequest,
  DesktopMcpToolExecutionAuditStatus,
  DesktopMcpToolExecutionApprovalRequest,
  DesktopMcpToolExecutionApprovalResult,
} from "../shared/desktopApi";

const MCP_SERVERS_RELATIVE_PATH = join(".drsai", "mcp-servers.json");
const MCP_CONTEXT_RELATIVE_PATH = join(".drsai", "mcp-context.json");
const MCP_EXECUTION_AUDIT_RELATIVE_PATH = join(".drsai", "mcp-execution-audit.json");
const MCP_SESSION_AUDIT_RELATIVE_PATH = join(".drsai", "mcp-session-audit.json");
const MAX_MCP_SERVERS_BYTES = 48 * 1024;
const MAX_MCP_EXECUTION_AUDIT_BYTES = 160 * 1024;
const MAX_MCP_SESSION_AUDIT_BYTES = 160 * 1024;
const MAX_MCP_STDIO_BYTES = 256 * 1024;
const MAX_MCP_ITEMS_PER_KIND = 24;
const MAX_MCP_EXECUTION_AUDIT_ITEMS = 60;
const MAX_MCP_SESSION_AUDIT_ITEMS = 80;
const MAX_MCP_ENUMERATION_MS = 8_000;
const MAX_MCP_TOOL_EXECUTION_MS = 15_000;
const MAX_MCP_REUSABLE_SESSION_IDLE_MS = 120_000;
const MAX_MCP_TOOL_RESULT_CHARS = 12_000;
const MAX_MCP_AUDIT_PREVIEW_CHARS = 2_000;

interface RawMcpServersFile {
  servers?: unknown;
}

interface NormalizedMcpServer {
  name: string;
  workspacePath: string;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  description?: string;
}

export interface DesktopMcpSmokeReadinessServer {
  name: string;
  command: string;
  status: "ready" | "review_required" | "blocked";
  runner: "local" | "node" | "python" | "package_runner" | "container" | "unknown";
  thirdParty: boolean;
  reusableSessionEligible: boolean;
  cwdScope: "workspace" | "default";
  envKeys: string[];
  checks: string[];
  risks: string[];
  verification: string;
}

export interface DesktopMcpSmokeReadinessResult {
  workspacePath: string;
  configPath: string;
  serverCount: number;
  thirdPartyCount: number;
  readyCount: number;
  reviewRequiredCount: number;
  blockedCount: number;
  servers: DesktopMcpSmokeReadinessServer[];
  verification: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface McpEnumerationOutput {
  resources: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  status: "completed" | "failed" | "timed_out" | "cancelled";
  message: string;
  reusedSession: boolean;
  sessionReuseKey?: string;
}

interface ActiveMcpRuntimeSession {
  sessionId: string;
  workspacePath: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  startedAt: string;
  approvalId?: string;
  command: string;
  child: ChildProcessWithoutNullStreams;
  cancelled: boolean;
  reusable?: boolean;
  sessionReuseKey?: string;
}

const activeMcpRuntimeSessions = new Map<string, ActiveMcpRuntimeSession>();

interface PendingPooledMcpRequest {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PooledMcpSession {
  key: string;
  workspacePath: string;
  server: NormalizedMcpServer;
  command: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  lastUsedAt: string;
  nextId: number;
  stdoutBuffer: string;
  stderrPreview: string;
  pending: Map<number, PendingPooledMcpRequest>;
  initialized: Promise<void>;
  closing: boolean;
  idleTimer?: NodeJS.Timeout;
  idleExpiresAt?: string;
}

const reusableMcpSessions = new Map<string, PooledMcpSession>();

export function inspectMcpLiveServers(
  workspacePath: string,
): {
  workspacePath: string;
  configPath: string;
  servers: DesktopMcpLiveServerSummary[];
} {
  const workspace = resolveWorkspacePath(workspacePath);
  const configPath = resolveWorkspaceFile(workspace, MCP_SERVERS_RELATIVE_PATH, {
    mustExist: true,
    maxBytes: MAX_MCP_SERVERS_BYTES,
    label: "MCP live server config",
  });
  const servers = readMcpServers(configPath, workspace);
  return {
    workspacePath: workspace,
    configPath,
    servers: servers.map(toServerSummary),
  };
}

export function inspectMcpSmokeReadiness(
  workspacePath: string,
): DesktopMcpSmokeReadinessResult {
  const workspace = resolveWorkspacePath(workspacePath);
  const configPath = resolveWorkspaceFile(workspace, MCP_SERVERS_RELATIVE_PATH, {
    mustExist: true,
    maxBytes: MAX_MCP_SERVERS_BYTES,
    label: "MCP live server config",
  });
  const servers = readMcpServers(configPath, workspace).map(toSmokeReadinessServer);
  const thirdPartyCount = servers.filter((server) => server.thirdParty).length;
  const readyCount = servers.filter((server) => server.status === "ready").length;
  const reviewRequiredCount = servers.filter(
    (server) => server.status === "review_required",
  ).length;
  const blockedCount = servers.filter((server) => server.status === "blocked").length;
  return {
    workspacePath: workspace,
    configPath,
    serverCount: servers.length,
    thirdPartyCount,
    readyCount,
    reviewRequiredCount,
    blockedCount,
    servers,
    verification:
      "MCP smoke readiness is local-only: it parses bounded .drsai/mcp-servers.json metadata, classifies runner risk, and does not spawn servers, resolve packages, open containers, call networks, read secrets, or write MCP context.",
  };
}

export async function enumerateMcpLiveServer(
  request: DesktopMcpLiveEnumerationRequest,
): Promise<DesktopMcpLiveEnumerationResult> {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const configPath = resolveWorkspaceFile(workspace, MCP_SERVERS_RELATIVE_PATH, {
    mustExist: true,
    maxBytes: MAX_MCP_SERVERS_BYTES,
    label: "MCP live server config",
  });
  const servers = selectMcpServers(readMcpServers(configPath, workspace), request.server);
  if (!servers.length) {
    throw new Error("No MCP live server matched the enumeration request.");
  }

  const enumeratedAt = new Date().toISOString();
  const serverResults: Awaited<ReturnType<typeof enumerateOneServer>>[] = [];
  for (const server of servers.slice(0, 4)) {
    serverResults.push(await enumerateOneServer(server, Boolean(request.reuseSession)));
  }
  const sourcePath = writeMcpContext(workspace, serverResults);
  const resourceCount = serverResults.reduce(
    (total, server) => total + server.resources.length,
    0,
  );
  const toolCount = serverResults.reduce((total, server) => total + server.tools.length, 0);
  const reusedSession = serverResults.some((server) => server.reusedSession);
  const sessionReuseKey = serverResults.find((server) => server.sessionReuseKey)?.sessionReuseKey;
  return {
    workspacePath: workspace,
    configPath,
    sourcePath,
    status: "completed",
    servers: serverResults.map((server) => server.summary),
    resourceCount,
    toolCount,
    approvalQueued: false,
    ...(reusedSession ? { reusedSession: true } : {}),
    ...(sessionReuseKey ? { sessionReuseKey } : {}),
    message: `Enumerated ${resourceCount} MCP resource(s) and ${toolCount} MCP tool(s) into .drsai/mcp-context.json.`,
    verification:
      request.reuseSession
        ? "Live MCP enumeration ran after Approval Center permission through an explicit reusable stdio session; reviewed context still flows through the existing handoff path."
        : "Live MCP enumeration ran only after Approval Center permission and wrote reviewed context into the existing handoff path; tool execution remains a separate approval.",
    enumeratedAt,
  };
}

export function createMcpEnumerationQueuedResult(
  request: DesktopMcpLiveEnumerationRequest,
  approvalId: string,
  reason: string,
): DesktopMcpLiveEnumerationResult {
  return {
    workspacePath: request.workspacePath,
    configPath: join(request.workspacePath, MCP_SERVERS_RELATIVE_PATH),
    sourcePath: join(request.workspacePath, MCP_CONTEXT_RELATIVE_PATH),
    status: "approval_queued",
    servers: [],
    resourceCount: 0,
    toolCount: 0,
    approvalId,
    approvalQueued: true,
    ...(request.reuseSession ? { reusedSession: false } : {}),
    message: "MCP live enumeration is waiting in Approval Center.",
    verification: reason,
  };
}

export function createMcpEnumerationBlockedResult(
  request: DesktopMcpLiveEnumerationRequest,
  reason: string,
): DesktopMcpLiveEnumerationResult {
  return {
    workspacePath: request.workspacePath,
    configPath: join(request.workspacePath, MCP_SERVERS_RELATIVE_PATH),
    sourcePath: join(request.workspacePath, MCP_CONTEXT_RELATIVE_PATH),
    status: "blocked",
    servers: [],
    resourceCount: 0,
    toolCount: 0,
    approvalQueued: false,
    ...(request.reuseSession ? { reusedSession: false } : {}),
    message: "MCP live enumeration was blocked by the execution policy.",
    verification: reason,
  };
}

export function createMcpToolExecutionApprovalResult(
  request: DesktopMcpToolExecutionApprovalRequest,
  approvalId: string | undefined,
  reason: string,
  queued: boolean,
  blocked: boolean,
): DesktopMcpToolExecutionApprovalResult {
  return {
    workspacePath: request.workspacePath,
    server: sanitizeName(request.server, 120),
    tool: sanitizeName(request.tool, 160),
    status: queued ? "approval_queued" : blocked ? "blocked" : undefined,
    approvalId,
    queued,
    blocked,
    allowed: !blocked,
    ...(request.reuseSession ? { reusedSession: false } : {}),
    message: queued
      ? "MCP tool execution is waiting in Approval Center."
      : blocked
        ? "MCP tool execution was blocked by the execution policy."
        : "MCP tool execution was allowed by policy.",
    verification:
      `${reason} Tool execution remains separate from resource/tool enumeration and is never performed by the context import path.`,
  };
}

export async function executeMcpToolAfterApproval(
  request: DesktopMcpToolExecutionApprovalRequest,
  approvalId?: string,
): Promise<DesktopMcpToolExecutionApprovalResult> {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const tool = sanitizeName(request.tool, 160);
  const serverName = sanitizeName(request.server, 120);
  const sessionId = createMcpSessionId({
    approvalId,
    phase: "tool_execution",
    server: serverName,
    tool,
  });
  try {
    const configPath = resolveWorkspaceFile(workspace, MCP_SERVERS_RELATIVE_PATH, {
      mustExist: true,
      maxBytes: MAX_MCP_SERVERS_BYTES,
      label: "MCP live server config",
    });
    const server = selectMcpServers(readMcpServers(configPath, workspace), request.server)[0];
    if (!server) {
      throw new Error("No configured MCP server matched the tool execution request.");
    }
    if (!tool) {
      throw new Error("MCP tool execution requires a tool name.");
    }
    const input = parseMcpToolInput(request.input);
    const executedAt = new Date().toISOString();
    recordMcpSessionAudit({
      workspacePath: workspace,
      approvalId,
      sessionId,
      phase: "tool_execution",
      server: server.name,
      tool,
      status: "started",
      message: `Started approved MCP tools/call ${server.name}/${tool}.`,
      verification:
        "MCP tool session lifecycle is recorded before the bounded stdio runtime starts.",
      createdAt: executedAt,
    });
    const output = await callMcpTool(server, tool, input, {
      sessionId,
      approvalId,
      reuseSession: Boolean(request.reuseSession),
    });
    const outputPreview = sanitizeToolResult(output.result);
    const resultContextName = `${tool} result ${executedAt}`;
    const sourcePath = writeMcpToolExecutionContext(workspace, {
      server: server.name,
      tool,
      input,
      outputPreview,
      executedAt,
      resultContextName,
    });
    const message = `Executed MCP tool ${server.name}/${tool} and wrote a reviewed result to .drsai/mcp-context.json.`;
    const verification =
      "MCP tool execution ran only after Approval Center permission; the result is recorded as reviewed MCP tool context for explicit /mcp tool import.";
    recordMcpToolExecutionAudit({
      workspacePath: workspace,
      approvalId,
      server: server.name,
      tool,
      status: "completed",
      resultContextName,
      sourcePath,
      input,
      outputPreview,
      reusedSession: output.reusedSession,
      sessionReuseKey: output.sessionReuseKey,
      message,
      verification:
        output.reusedSession && output.sessionReuseKey
          ? `${verification} The approved call used an explicit reusable MCP stdio session (${output.sessionReuseKey}).`
          : verification,
      createdAt: executedAt,
    });
    recordMcpSessionAudit({
      workspacePath: workspace,
      approvalId,
      sessionId,
      phase: "tool_execution",
      server: server.name,
      tool,
      status: "completed",
      reusedSession: output.reusedSession,
      sessionReuseKey: output.sessionReuseKey,
      message: `Completed approved MCP tools/call ${server.name}/${tool}.`,
      verification:
        output.reusedSession && output.sessionReuseKey
          ? `MCP tool session lifecycle completed through explicit reusable stdio session ${output.sessionReuseKey}; the reviewed result still requires explicit /mcp tool import.`
          : "MCP tool session lifecycle completed and the reviewed result still requires explicit /mcp tool import.",
      createdAt: new Date().toISOString(),
    });
    return {
      workspacePath: workspace,
      server: server.name,
      tool,
      status: "completed",
      queued: false,
      blocked: false,
      allowed: true,
      sourcePath,
      resultContextName,
      outputPreview,
      reusedSession: output.reusedSession,
      ...(output.sessionReuseKey ? { sessionReuseKey: output.sessionReuseKey } : {}),
      executedAt,
      message,
      verification:
        output.reusedSession && output.sessionReuseKey
          ? `${verification} Explicit session reuse was requested and satisfied by ${output.sessionReuseKey}.`
          : verification,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MCP tool execution failed.";
    const sessionStatus: DesktopMcpSessionAuditStatus = message
      .toLowerCase()
      .includes("cancelled")
      ? "cancelled"
      : message.toLowerCase().includes("timed out")
        ? "timed_out"
        : "failed";
    recordMcpSessionAudit({
      workspacePath: workspace,
      approvalId,
      sessionId,
      phase: "tool_execution",
      server: serverName,
      tool,
      status: sessionStatus,
      message,
      verification:
        "MCP tool session lifecycle records failed, timed-out, or cancelled approved runtimes for Approval Center review.",
      createdAt: new Date().toISOString(),
    });
    recordMcpToolExecutionAudit({
      workspacePath: workspace,
      approvalId,
      server: serverName,
      tool,
      status: message.toLowerCase().includes("cancelled") ? "cancelled" : "failed",
      input: request.input ?? "",
      message,
      verification:
        message.toLowerCase().includes("cancelled")
          ? "The approved MCP tool execution was cancelled while running and recorded for Approval Center review."
          : "The approved MCP tool execution reached the runtime boundary, failed, and was recorded for Approval Center review.",
      createdAt: new Date().toISOString(),
    });
    throw error;
  }
}

export function listMcpToolExecutionAudits(
  request: DesktopMcpToolExecutionAuditListRequest,
): DesktopMcpToolExecutionAuditEntry[] {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const limit = Math.max(1, Math.min(80, Math.floor(Number(request.limit) || 12)));
  return readMcpToolExecutionAuditFile(workspace).slice(0, limit);
}

export function listMcpSessionAudits(
  request: DesktopMcpSessionAuditListRequest,
): DesktopMcpSessionAuditEntry[] {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const limit = Math.max(1, Math.min(80, Math.floor(Number(request.limit) || 12)));
  return readMcpSessionAuditFile(workspace).slice(0, limit);
}

export function listMcpActiveSessions(
  request: DesktopMcpActiveSessionListRequest,
): DesktopMcpActiveSession[] {
  const workspace = resolveWorkspacePath(request.workspacePath);
  return [...activeMcpRuntimeSessions.values()]
    .filter((session) => sameWorkspacePath(session.workspacePath, workspace))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map(toActiveSessionSummary);
}

export function listMcpReusableSessions(
  request: DesktopMcpReusableSessionListRequest,
): DesktopMcpReusableSession[] {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const sessions = [...reusableMcpSessions.values()]
    .filter((session) => sameWorkspacePath(session.workspacePath, workspace))
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
    .map(toReusableSessionSummary);
  if (sessions.length > 0) return sessions;
  const recoveryDiagnostic = getReusableSessionRestartDiagnostic(workspace);
  return recoveryDiagnostic ? [recoveryDiagnostic] : [];
}

export function closeMcpReusableSession(
  request: DesktopMcpReusableSessionCloseRequest,
): DesktopMcpReusableSessionCloseResult {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const sessionReuseKey = sanitizeName(request.sessionReuseKey, 180);
  const session = reusableMcpSessions.get(sessionReuseKey);
  if (!session || !sameWorkspacePath(session.workspacePath, workspace)) {
    return {
      workspacePath: workspace,
      sessionReuseKey,
      closed: false,
      message: "No reusable MCP session matched the close request.",
      verification:
        "Reusable MCP session close only targets pooled sessions started by the current desktop process for this workspace.",
    };
  }
  closeReusableMcpSession(session, "closed from Approval Center");
  return {
    workspacePath: workspace,
    sessionReuseKey,
    closed: true,
    message: `Closed reusable MCP session ${session.server.name}.`,
    verification:
      "The desktop app closed only the selected reusable MCP stdio child process; it did not start, enumerate, or execute MCP work.",
  };
}

export function cancelMcpActiveSession(
  request: DesktopMcpSessionCancelRequest,
): DesktopMcpSessionCancelResult {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const sessionId = sanitizeName(request.sessionId, 180);
  const session = activeMcpRuntimeSessions.get(sessionId);
  if (!session || !sameWorkspacePath(session.workspacePath, workspace)) {
    return {
      workspacePath: workspace,
      sessionId,
      cancelled: false,
      message: "No running MCP session matched the cancellation request.",
      verification:
        "MCP cancellation only targets sessions started by the current desktop process for this workspace.",
    };
  }
  session.cancelled = true;
  session.child.kill();
  return {
    workspacePath: workspace,
    sessionId,
    cancelled: true,
    message: `Cancellation requested for MCP ${session.phase} session ${session.server}${session.tool ? `/${session.tool}` : ""}.`,
    verification:
      "The desktop app sent a kill signal only to the tracked MCP stdio child process; lifecycle audit is finalized by the running session handler.",
  };
}

export function recordRejectedMcpToolExecutionAudit(
  request: DesktopMcpToolExecutionApprovalRequest,
  approvalId?: string,
): DesktopMcpToolExecutionAuditEntry {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const server = sanitizeName(request.server, 120);
  const tool = sanitizeName(request.tool, 160);
  recordMcpSessionAudit({
    workspacePath: workspace,
    approvalId,
    sessionId: createMcpSessionId({
      approvalId,
      phase: "tool_execution",
      server,
      tool,
    }),
    phase: "tool_execution",
    server,
    tool,
    status: "rejected",
    message: "MCP tool execution was rejected before any server session started.",
    verification:
      "Rejected MCP tool approvals are recorded in the session lifecycle ledger without starting stdio.",
    createdAt: new Date().toISOString(),
  });
  return recordMcpToolExecutionAudit({
    workspacePath: workspace,
    approvalId,
    server,
    tool,
    status: "rejected",
    input: request.input ?? "",
    message: "MCP tool execution was rejected in Approval Center.",
    verification:
      "Rejected MCP tool executions are recorded for audit and do not start a server or update reviewed MCP context.",
    createdAt: new Date().toISOString(),
  });
}

export function recordCancelledMcpLiveEnumerationAudit(
  request: DesktopMcpLiveEnumerationRequest,
  approvalId?: string,
): DesktopMcpSessionAuditEntry {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const server = sanitizeName(request.server, 120) || "all";
  return recordMcpSessionAudit({
    workspacePath: workspace,
    approvalId,
    sessionId: createMcpSessionId({
      approvalId,
      phase: "enumeration",
      server,
    }),
    phase: "enumeration",
    server,
    status: "cancelled",
    message: "MCP live enumeration was cancelled before any server session started.",
    verification:
      "Cancelled MCP enumeration approvals are recorded in the session lifecycle ledger without starting stdio or writing reviewed context.",
    createdAt: new Date().toISOString(),
  });
}

export function recordCancelledMcpToolExecutionAudit(
  request: DesktopMcpToolExecutionApprovalRequest,
  approvalId?: string,
): DesktopMcpToolExecutionAuditEntry {
  const workspace = resolveWorkspacePath(request.workspacePath);
  const server = sanitizeName(request.server, 120);
  const tool = sanitizeName(request.tool, 160);
  recordMcpSessionAudit({
    workspacePath: workspace,
    approvalId,
    sessionId: createMcpSessionId({
      approvalId,
      phase: "tool_execution",
      server,
      tool,
    }),
    phase: "tool_execution",
    server,
    tool,
    status: "cancelled",
    message: "MCP tool execution was cancelled before any server session started.",
    verification:
      "Cancelled MCP tool approvals are recorded in the session lifecycle ledger without starting stdio or writing reviewed context.",
    createdAt: new Date().toISOString(),
  });
  return recordMcpToolExecutionAudit({
    workspacePath: workspace,
    approvalId,
    server,
    tool,
    status: "cancelled",
    input: request.input ?? "",
    message: "MCP tool execution was cancelled before Approval Center execution.",
    verification:
      "Cancelled MCP tool executions are recorded for audit and do not start a server or update reviewed MCP context.",
    createdAt: new Date().toISOString(),
  });
}

function readMcpServers(configPath: string, workspacePath: string): NormalizedMcpServer[] {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as RawMcpServersFile;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("MCP live server config must contain a JSON object.");
  }
  const rawServers = parsed.servers;
  const records = Array.isArray(rawServers)
    ? rawServers.map((value, index) => [String(index + 1), value] as const)
    : rawServers && typeof rawServers === "object"
      ? Object.entries(rawServers)
      : [];
  const servers = records
    .map(([fallbackName, value]) => normalizeServer(fallbackName, value, workspacePath))
    .filter((server): server is NormalizedMcpServer => Boolean(server));
  if (!servers.length) {
    throw new Error("MCP live server config does not define any usable servers.");
  }
  return servers.slice(0, 8);
}

function normalizeServer(
  fallbackName: string,
  value: unknown,
  workspacePath: string,
): NormalizedMcpServer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = sanitizeName(record.name ?? fallbackName, 120);
  const command = sanitizeCommand(record.command);
  if (!name || !command) return null;
  const args = Array.isArray(record.args)
    ? record.args.map((arg) => sanitizeArg(arg)).filter((arg): arg is string => Boolean(arg)).slice(0, 24)
    : [];
  const cwdValue = typeof record.cwd === "string" ? record.cwd.trim() : "";
  const cwd = cwdValue ? resolveWorkspaceChild(workspacePath, cwdValue) : undefined;
  const env = normalizeEnv(record.env);
  return {
    name,
    workspacePath,
    command,
    args,
    cwd,
    env,
    description: sanitizeDescription(record.description),
  };
}

function selectMcpServers(
  servers: NormalizedMcpServer[],
  requestedServer?: string,
): NormalizedMcpServer[] {
  const selector = sanitizeName(requestedServer, 120).toLowerCase();
  if (!selector) return servers;
  return servers.filter((server) => server.name.toLowerCase().includes(selector));
}

async function enumerateOneServer(server: NormalizedMcpServer, reuseSession: boolean): Promise<{
  summary: DesktopMcpLiveServerSummary;
  resources: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  reusedSession: boolean;
  sessionReuseKey?: string;
}> {
  const workspacePath = server.workspacePath;
  const sessionId = createMcpSessionId({
    phase: "enumeration",
    server: server.name,
  });
  if (workspacePath) {
    recordMcpSessionAudit({
      workspacePath,
      sessionId,
      phase: "enumeration",
      server: server.name,
      status: "started",
      message: `Started MCP resources/list and tools/list enumeration for ${server.name}.`,
      verification:
        "MCP enumeration session lifecycle is recorded before the bounded stdio runtime starts.",
      createdAt: new Date().toISOString(),
    });
  }
  const enumeration = await callMcpEnumeration(server, sessionId, reuseSession);
  if (workspacePath) {
    recordMcpSessionAudit({
      workspacePath,
      sessionId,
      phase: "enumeration",
      server: server.name,
      status: enumeration.status,
      resourceCount: enumeration.resources.length,
      toolCount: enumeration.tools.length,
      reusedSession: enumeration.reusedSession,
      sessionReuseKey: enumeration.sessionReuseKey,
      message: enumeration.message,
      verification:
        enumeration.reusedSession && enumeration.sessionReuseKey
          ? `MCP enumeration session lifecycle records explicit reusable stdio session ${enumeration.sessionReuseKey} separately from reviewed context import.`
          : "MCP enumeration session lifecycle records completion, failure, or timeout separately from reviewed context import.",
      createdAt: new Date().toISOString(),
    });
  }
  return {
    summary: {
      name: server.name,
      command: [server.command, ...server.args].join(" "),
      status: "enumerated",
      resourceCount: enumeration.resources.length,
      toolCount: enumeration.tools.length,
      description: server.description,
    },
    resources: enumeration.resources,
    tools: enumeration.tools,
    reusedSession: enumeration.reusedSession,
    ...(enumeration.sessionReuseKey ? { sessionReuseKey: enumeration.sessionReuseKey } : {}),
  };
}

function callMcpEnumeration(
  server: NormalizedMcpServer,
  sessionId: string,
  reuseSession: boolean,
): Promise<McpEnumerationOutput> {
  if (reuseSession) {
    return callMcpEnumerationWithReusableSession(server, sessionId);
  }
  return new Promise((resolvePromise) => {
    const child = spawn(server.command, server.args, {
      cwd: server.cwd,
      env: { ...process.env, ...server.env },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    registerActiveMcpSession({
      sessionId,
      workspacePath: server.workspacePath,
      phase: "enumeration",
      server: server.name,
      command: [server.command, ...server.args].join(" "),
      child,
    });
    let output = "";
    let settled = false;
    const settle = (outputValue: McpEnumerationOutput): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregisterActiveMcpSession(sessionId);
      resolvePromise(outputValue);
    };
    const timer = setTimeout(() => {
      const session = activeMcpRuntimeSessions.get(sessionId);
      child.kill();
      if (session?.cancelled) {
        settle({
          resources: [],
          tools: [],
          status: "cancelled",
          reusedSession: false,
          message: `MCP enumeration was cancelled for ${server.name}.`,
        });
        return;
      }
      settle({
        resources: [],
        tools: [],
        status: "timed_out",
        reusedSession: false,
        message: `MCP enumeration timed out for ${server.name}.`,
      });
    }, MAX_MCP_ENUMERATION_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_MCP_STDIO_BYTES) {
        child.kill();
      }
    });
    child.on("error", () => {
      settle({
        resources: [],
        tools: [],
        status: "failed",
        reusedSession: false,
        message: `MCP enumeration failed to start for ${server.name}.`,
      });
    });
    child.on("exit", () => {
      const session = activeMcpRuntimeSessions.get(sessionId);
      if (session?.cancelled) {
        settle({
          resources: [],
          tools: [],
          status: "cancelled",
          reusedSession: false,
          message: `MCP enumeration was cancelled for ${server.name}.`,
        });
        return;
      }
      const resources = parseMcpListOutput(output, "resources/list");
      const tools = parseMcpListOutput(output, "tools/list");
      settle({
        resources,
        tools,
        status: "completed",
        reusedSession: false,
        message: `MCP enumeration completed for ${server.name}: ${resources.length} resource(s), ${tools.length} tool(s).`,
      });
    });
    const initializeRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "drsai-windows-desktop", version: "1.4.2" },
      },
    };
    const initializedNotification: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    };
    const resourcesRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
      params: {},
    };
    const toolsRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    };
    child.stdin.end(
      [
        initializeRequest,
        initializedNotification,
        resourcesRequest,
        toolsRequest,
      ].map((message) => JSON.stringify(message)).join("\n") + "\n",
    );
  });
}

function callMcpTool(
  server: NormalizedMcpServer,
  tool: string,
  input: Record<string, unknown>,
  options: { sessionId: string; approvalId?: string; reuseSession: boolean },
): Promise<{ result: unknown; reusedSession: boolean; sessionReuseKey?: string }> {
  if (options.reuseSession) {
    return callMcpToolWithReusableSession(server, tool, input, options);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(server.command, server.args, {
      cwd: server.cwd,
      env: { ...process.env, ...server.env },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    registerActiveMcpSession({
      sessionId: options.sessionId,
      workspacePath: server.workspacePath,
      phase: "tool_execution",
      server: server.name,
      tool,
      approvalId: options.approvalId,
      command: [server.command, ...server.args].join(" "),
      child,
    });
    let output = "";
    let errorOutput = "";
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregisterActiveMcpSession(options.sessionId);
      callback();
    };
    const timer = setTimeout(() => {
      const session = activeMcpRuntimeSessions.get(options.sessionId);
      child.kill();
      settle(() =>
        rejectPromise(
          new Error(
            session?.cancelled
              ? "MCP tool execution was cancelled."
              : "MCP tool execution timed out.",
          ),
        ),
      );
    }, MAX_MCP_TOOL_EXECUTION_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_MCP_STDIO_BYTES) {
        child.kill();
        settle(() => rejectPromise(new Error("MCP tool execution output exceeded the safety limit.")));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8").slice(0, 4000);
    });
    child.on("error", (error) => {
      settle(() => rejectPromise(error));
    });
    child.on("exit", () => {
      const session = activeMcpRuntimeSessions.get(options.sessionId);
      settle(() => {
        if (session?.cancelled) {
          rejectPromise(new Error("MCP tool execution was cancelled."));
          return;
        }
        const message = parseMcpToolOutput(output, 4);
        if (message?.error) {
          rejectPromise(new Error(`MCP tool execution failed: ${sanitizeDescription(message.error) ?? "unknown error"}`));
          return;
        }
        if (message && "result" in message) {
          resolvePromise({ result: message.result, reusedSession: false });
          return;
        }
        rejectPromise(
          new Error(
            errorOutput.trim()
              ? `MCP tool execution produced no result. stderr: ${errorOutput.trim()}`
              : "MCP tool execution produced no result.",
          ),
        );
      });
    });
    const initializeRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "drsai-windows-desktop", version: "1.4.2" },
      },
    };
    const initializedNotification: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    };
    const toolRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: tool,
        arguments: input,
      },
    };
    child.stdin.end(
      [initializeRequest, initializedNotification, toolRequest]
        .map((message) => JSON.stringify(message))
        .join("\n") + "\n",
    );
  });
}

async function callMcpEnumerationWithReusableSession(
  server: NormalizedMcpServer,
  sessionId: string,
): Promise<McpEnumerationOutput> {
  const pooledSession = await getReusableMcpSession(server);
  registerActiveMcpSession({
    sessionId,
    workspacePath: server.workspacePath,
    phase: "enumeration",
    server: server.name,
    command: pooledSession.command,
    child: pooledSession.child,
    reusable: true,
    sessionReuseKey: pooledSession.key,
  });
  try {
    const [resourcesMessage, toolsMessage] = await Promise.all([
      sendPooledMcpRequest(
        pooledSession,
        "resources/list",
        {},
        MAX_MCP_ENUMERATION_MS,
      ),
      sendPooledMcpRequest(pooledSession, "tools/list", {}, MAX_MCP_ENUMERATION_MS),
    ]);
    const resources = extractMcpListResult(resourcesMessage, "resources");
    const tools = extractMcpListResult(toolsMessage, "tools");
    return {
      resources,
      tools,
      status: "completed",
      reusedSession: true,
      sessionReuseKey: pooledSession.key,
      message: `MCP enumeration completed for ${server.name} through reusable session ${pooledSession.key}: ${resources.length} resource(s), ${tools.length} tool(s).`,
    };
  } catch (error) {
    const session = activeMcpRuntimeSessions.get(sessionId);
    const message =
      error instanceof Error ? error.message : `MCP enumeration failed for ${server.name}.`;
    return {
      resources: [],
      tools: [],
      status: session?.cancelled
        ? "cancelled"
        : message.toLowerCase().includes("timed out")
          ? "timed_out"
          : "failed",
      reusedSession: true,
      sessionReuseKey: pooledSession.key,
      message: session?.cancelled
        ? `MCP enumeration was cancelled for ${server.name}.`
        : message,
    };
  } finally {
    unregisterActiveMcpSession(sessionId);
    scheduleReusableMcpIdleShutdown(pooledSession);
  }
}

async function callMcpToolWithReusableSession(
  server: NormalizedMcpServer,
  tool: string,
  input: Record<string, unknown>,
  options: { sessionId: string; approvalId?: string },
): Promise<{ result: unknown; reusedSession: boolean; sessionReuseKey?: string }> {
  const pooledSession = await getReusableMcpSession(server);
  registerActiveMcpSession({
    sessionId: options.sessionId,
    workspacePath: server.workspacePath,
    phase: "tool_execution",
    server: server.name,
    tool,
    approvalId: options.approvalId,
    command: pooledSession.command,
    child: pooledSession.child,
    reusable: true,
    sessionReuseKey: pooledSession.key,
  });
  try {
    const message = await sendPooledMcpRequest(
      pooledSession,
      "tools/call",
      {
        name: tool,
        arguments: input,
      },
      MAX_MCP_TOOL_EXECUTION_MS,
    );
    return {
      result: message.result,
      reusedSession: true,
      sessionReuseKey: pooledSession.key,
    };
  } finally {
    unregisterActiveMcpSession(options.sessionId);
    scheduleReusableMcpIdleShutdown(pooledSession);
  }
}

async function getReusableMcpSession(server: NormalizedMcpServer): Promise<PooledMcpSession> {
  const key = createReusableMcpSessionKey(server);
  const existing = reusableMcpSessions.get(key);
  if (existing && !existing.closing) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
      existing.idleExpiresAt = undefined;
    }
    await existing.initialized;
    existing.lastUsedAt = new Date().toISOString();
    return existing;
  }

  const child = spawn(server.command, server.args, {
    cwd: server.cwd,
    env: { ...process.env, ...server.env },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pooledSession: PooledMcpSession = {
    key,
    workspacePath: server.workspacePath,
    server,
    command: [server.command, ...server.args].join(" "),
    child,
    startedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    nextId: 10,
    stdoutBuffer: "",
    stderrPreview: "",
    pending: new Map(),
    initialized: Promise.resolve(),
    closing: false,
  };
  attachPooledMcpProcessHandlers(pooledSession);
  pooledSession.initialized = initializePooledMcpSession(pooledSession);
  reusableMcpSessions.set(key, pooledSession);
  recordMcpReusablePoolAudit(pooledSession, "started", "process started");
  try {
    await pooledSession.initialized;
    return pooledSession;
  } catch (error) {
    closeReusableMcpSession(pooledSession, "initialization failed");
    throw error;
  }
}

function attachPooledMcpProcessHandlers(session: PooledMcpSession): void {
  session.child.stdout.on("data", (chunk: Buffer) => {
    session.stdoutBuffer += chunk.toString("utf8");
    if (session.stdoutBuffer.length > MAX_MCP_STDIO_BYTES) {
      closeReusableMcpSession(session, "output exceeded the safety limit");
      return;
    }
    let lineEnd = session.stdoutBuffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = session.stdoutBuffer.slice(0, lineEnd).trim();
      session.stdoutBuffer = session.stdoutBuffer.slice(lineEnd + 1);
      if (line) handlePooledMcpLine(session, line);
      lineEnd = session.stdoutBuffer.indexOf("\n");
    }
  });
  session.child.stderr.on("data", (chunk: Buffer) => {
    session.stderrPreview = `${session.stderrPreview}${chunk.toString("utf8")}`.slice(-4000);
  });
  session.child.on("error", (error) => {
    rejectPooledMcpPending(session, error);
  });
  session.child.on("exit", () => {
    closeReusableMcpSession(session, "process exited");
  });
}

function handlePooledMcpLine(session: PooledMcpSession, line: string): void {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch {
    return;
  }
  if (typeof message.id !== "number") return;
  const pending = session.pending.get(message.id);
  if (!pending) return;
  session.pending.delete(message.id);
  clearTimeout(pending.timeout);
  if (message.error) {
    pending.reject(
      new Error(`MCP request failed: ${sanitizeDescription(message.error) ?? "unknown error"}`),
    );
    return;
  }
  pending.resolve(message);
}

async function initializePooledMcpSession(session: PooledMcpSession): Promise<void> {
  await sendPooledMcpRequest(
    session,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "drsai-windows-desktop", version: "1.4.2" },
    },
    MAX_MCP_ENUMERATION_MS,
  );
  sendPooledMcpNotification(session, "notifications/initialized", {});
}

function sendPooledMcpRequest(
  session: PooledMcpSession,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<JsonRpcMessage> {
  if (session.closing || session.child.killed) {
    return Promise.reject(new Error("MCP reusable session is closed."));
  }
  session.lastUsedAt = new Date().toISOString();
  const id = session.nextId;
  session.nextId += 1;
  const request: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      session.pending.delete(id);
      rejectPromise(new Error(`MCP reusable session request ${method} timed out.`));
      closeReusableMcpSession(session, `request ${method} timed out`);
    }, timeoutMs);
    session.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timeout });
    try {
      session.child.stdin.write(`${JSON.stringify(request)}\n`);
    } catch (error) {
      clearTimeout(timeout);
      session.pending.delete(id);
      rejectPromise(error instanceof Error ? error : new Error("MCP reusable session write failed."));
    }
  });
}

function sendPooledMcpNotification(
  session: PooledMcpSession,
  method: string,
  params: unknown,
): void {
  if (session.closing || session.child.killed) return;
  const notification: JsonRpcMessage = {
    jsonrpc: "2.0",
    method,
    params,
  };
  session.child.stdin.write(`${JSON.stringify(notification)}\n`);
}

function scheduleReusableMcpIdleShutdown(session: PooledMcpSession): void {
  if (session.closing || session.child.killed) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleExpiresAt = new Date(Date.now() + MAX_MCP_REUSABLE_SESSION_IDLE_MS).toISOString();
  session.idleTimer = setTimeout(() => {
    closeReusableMcpSession(session, "idle timeout");
  }, MAX_MCP_REUSABLE_SESSION_IDLE_MS);
}

function closeReusableMcpSession(session: PooledMcpSession, reason: string): void {
  if (session.closing) return;
  session.closing = true;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleExpiresAt = undefined;
  reusableMcpSessions.delete(session.key);
  recordMcpReusablePoolAudit(session, "closed", reason);
  rejectPooledMcpPending(session, new Error(`MCP reusable session closed: ${reason}.`));
  if (!session.child.killed) session.child.kill();
}

function recordMcpReusablePoolAudit(
  session: PooledMcpSession,
  status: Extract<DesktopMcpSessionAuditStatus, "started" | "closed">,
  reason: string,
): void {
  recordMcpSessionAudit({
    workspacePath: session.workspacePath,
    sessionId: session.key,
    phase: "reusable_pool",
    server: session.server.name,
    status,
    reusedSession: true,
    sessionReuseKey: session.key,
    message:
      status === "started"
        ? `Reusable MCP pool session started for ${session.server.name}.`
        : `Reusable MCP pool session closed for ${session.server.name}: ${reason}.`,
    verification:
      status === "started"
        ? "Reusable MCP pool startup is recorded in the workspace lifecycle ledger so restart diagnostics can distinguish an empty pool from a never-used pool."
        : "Reusable MCP pool closure is recorded in the workspace lifecycle ledger; pooled stdio children are process-local and are not silently recovered after app restart.",
    createdAt: new Date().toISOString(),
  });
}

function rejectPooledMcpPending(session: PooledMcpSession, error: Error): void {
  for (const [id, pending] of session.pending) {
    clearTimeout(pending.timeout);
    pending.reject(error);
    session.pending.delete(id);
  }
}

function extractMcpListResult(
  message: JsonRpcMessage,
  key: "resources" | "tools",
): Array<Record<string, unknown>> {
  const result = message.result;
  if (!result || typeof result !== "object") return [];
  const list = (result as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .slice(0, MAX_MCP_ITEMS_PER_KIND);
}

function createReusableMcpSessionKey(server: NormalizedMcpServer): string {
  const seed = JSON.stringify({
    workspacePath: resolve(server.workspacePath),
    name: server.name,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    envKeys: Object.keys(server.env).sort(),
  });
  return `mcp-reuse:${stableAuditHash(seed)}`;
}

function registerActiveMcpSession(input: {
  sessionId: string;
  workspacePath: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  approvalId?: string;
  command: string;
  child: ChildProcessWithoutNullStreams;
  reusable?: boolean;
  sessionReuseKey?: string;
}): void {
  activeMcpRuntimeSessions.set(input.sessionId, {
    ...input,
    startedAt: new Date().toISOString(),
    cancelled: false,
  });
}

function unregisterActiveMcpSession(sessionId: string): void {
  activeMcpRuntimeSessions.delete(sessionId);
}

function toActiveSessionSummary(
  session: ActiveMcpRuntimeSession,
): DesktopMcpActiveSession {
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    phase: session.phase,
    server: session.server,
    ...(session.tool ? { tool: session.tool } : {}),
    startedAt: session.startedAt,
    ...(session.approvalId ? { approvalId: session.approvalId } : {}),
    command: session.command,
    ...(session.reusable ? { reusable: true } : {}),
    ...(session.sessionReuseKey ? { sessionReuseKey: session.sessionReuseKey } : {}),
  };
}

function toReusableSessionSummary(
  session: PooledMcpSession,
): DesktopMcpReusableSession {
  const pendingRequestCount = session.pending.size;
  const idleExpiresInMs = session.idleExpiresAt
    ? Math.max(0, new Date(session.idleExpiresAt).getTime() - Date.now())
    : undefined;
  return {
    sessionReuseKey: session.key,
    workspacePath: session.workspacePath,
    server: session.server.name,
    command: session.command,
    startedAt: session.startedAt,
    lastUsedAt: session.lastUsedAt,
    status: pendingRequestCount > 0 ? "busy" : session.idleTimer ? "idle" : "ready",
    pendingRequestCount,
    ...(session.idleExpiresAt ? { idleExpiresAt: session.idleExpiresAt } : {}),
    ...(typeof idleExpiresInMs === "number" ? { idleExpiresInMs } : {}),
    ...(session.stderrPreview ? { stderrPreview: session.stderrPreview.slice(-1000) } : {}),
  };
}

function getReusableSessionRestartDiagnostic(
  workspacePath: string,
): DesktopMcpReusableSession | null {
  const audits = readMcpSessionAuditFile(workspacePath)
    .filter(
      (entry) =>
        entry.phase === "reusable_pool" &&
        entry.reusedSession === true &&
        Boolean(entry.sessionReuseKey),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latestStarted = audits.find((entry) => entry.status === "started");
  if (!latestStarted?.sessionReuseKey) return null;
  const laterClosed = audits.some(
    (entry) =>
      entry.sessionReuseKey === latestStarted.sessionReuseKey &&
      entry.status === "closed" &&
      entry.createdAt >= latestStarted.createdAt,
  );
  if (laterClosed) return null;
  const now = new Date().toISOString();
  return {
    sessionReuseKey: latestStarted.sessionReuseKey,
    workspacePath,
    server: latestStarted.server,
    command: "process-local stdio session from previous app process",
    startedAt: latestStarted.createdAt,
    lastUsedAt: latestStarted.createdAt,
    status: "restart_reconnect_required",
    pendingRequestCount: 0,
    restartDetectedAt: now,
    diagnosticMessage:
      "Reusable MCP stdio sessions are process-local; this workspace has prior pool-start evidence but no live pool in the current desktop process. Re-run /mcp sync --reuse or /mcp exec --reuse after approval to reconnect explicitly.",
  };
}

function sameWorkspacePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function parseMcpListOutput(
  output: string,
  method: "resources/list" | "tools/list",
): Array<Record<string, unknown>> {
  const key = method === "resources/list" ? "resources" : "tools";
  const messages = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
  for (const line of messages) {
    try {
      const message = JSON.parse(line) as JsonRpcMessage;
      const result = message.result;
      if (result && typeof result === "object") {
        const list = (result as Record<string, unknown>)[key];
        if (Array.isArray(list)) {
          return list
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            )
            .slice(0, MAX_MCP_ITEMS_PER_KIND);
        }
      }
    } catch {
      continue;
    }
  }
  return [];
}

function parseMcpToolOutput(output: string, id: number): JsonRpcMessage | null {
  const messages = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
  for (const line of messages) {
    try {
      const message = JSON.parse(line) as JsonRpcMessage;
      if (message.id === id) return message;
    } catch {
      continue;
    }
  }
  return null;
}

function writeMcpContext(
  workspacePath: string,
  serverResults: Array<{
    summary: DesktopMcpLiveServerSummary;
    resources: Array<Record<string, unknown>>;
    tools: Array<Record<string, unknown>>;
  }>,
): string {
  const sourcePath = resolve(workspacePath, MCP_CONTEXT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath)) {
    throw new Error("MCP live enumeration handoff must stay inside the workspace.");
  }
  assertSafeMcpContextWriteTarget(sourcePath);
  mkdirSync(dirname(sourcePath), { recursive: true });
  const servers: Record<string, unknown> = {};
  for (const result of serverResults) {
    servers[result.summary.name] = {
      resources: result.resources.map((resource) => normalizeMcpContextRecord(resource, result.summary.name, "resource")),
      tools: result.tools.map((tool) => normalizeMcpContextRecord(tool, result.summary.name, "tool")),
      enumeratedBy: "desktop-live-mcp-bridge",
    };
  }
  writeFileSync(
    sourcePath,
    `${JSON.stringify({ version: 1, generatedBy: "desktop-live-mcp-bridge", servers }, null, 2)}\n`,
    "utf8",
  );
  return sourcePath;
}

function writeMcpToolExecutionContext(
  workspacePath: string,
  result: {
    server: string;
    tool: string;
    input: Record<string, unknown>;
    outputPreview: string;
    executedAt: string;
    resultContextName: string;
  },
): string {
  const sourcePath = resolve(workspacePath, MCP_CONTEXT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath)) {
    throw new Error("MCP tool execution handoff must stay inside the workspace.");
  }
  assertSafeMcpContextWriteTarget(sourcePath);
  mkdirSync(dirname(sourcePath), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(sourcePath)) {
    const stats = statSync(sourcePath);
    if (stats.isFile() && stats.size <= MAX_MCP_SERVERS_BYTES) {
      try {
        const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        existing = {};
      }
    }
  }
  const servers =
    existing.servers && typeof existing.servers === "object" && !Array.isArray(existing.servers)
      ? { ...(existing.servers as Record<string, unknown>) }
      : {};
  const serverRecord =
    servers[result.server] && typeof servers[result.server] === "object" && !Array.isArray(servers[result.server])
      ? { ...(servers[result.server] as Record<string, unknown>) }
      : {};
  const existingTools = Array.isArray(serverRecord.tools) ? serverRecord.tools : [];
  serverRecord.tools = [
    {
      server: result.server,
      name: result.resultContextName,
      title: result.resultContextName,
      description: `Reviewed result from approved MCP tools/call ${result.server}/${result.tool}.`,
      content: [
        `MCP tool result: ${result.tool}`,
        `Server: ${result.server}`,
        `Executed at: ${result.executedAt}`,
        "",
        "Input:",
        JSON.stringify(result.input, null, 2),
        "",
        "Output:",
        result.outputPreview,
      ].join("\n"),
      generatedBy: "desktop-approved-mcp-tool-execution",
    },
    ...existingTools,
  ].slice(0, MAX_MCP_ITEMS_PER_KIND);
  serverRecord.executedBy = "desktop-approved-mcp-tool-execution";
  servers[result.server] = serverRecord;
  writeFileSync(
    sourcePath,
    `${JSON.stringify(
      {
        ...existing,
        version: 1,
        generatedBy: "desktop-mcp-reviewed-handoff",
        servers,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return sourcePath;
}

function recordMcpToolExecutionAudit(input: {
  workspacePath: string;
  approvalId?: string;
  server: string;
  tool: string;
  status: DesktopMcpToolExecutionAuditStatus;
  resultContextName?: string;
  sourcePath?: string;
  input: Record<string, unknown> | string;
  outputPreview?: string;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  message: string;
  verification: string;
  createdAt: string;
}): DesktopMcpToolExecutionAuditEntry {
  const entry: DesktopMcpToolExecutionAuditEntry = {
    id: createMcpAuditId(input),
    workspacePath: input.workspacePath,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    server: input.server,
    tool: input.tool,
    status: input.status,
    ...(input.resultContextName ? { resultContextName: input.resultContextName } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    inputPreview: previewAuditValue(input.input),
    ...(input.outputPreview ? { outputPreview: input.outputPreview.slice(0, MAX_MCP_AUDIT_PREVIEW_CHARS) } : {}),
    ...(input.reusedSession ? { reusedSession: true } : {}),
    ...(input.sessionReuseKey ? { sessionReuseKey: input.sessionReuseKey } : {}),
    message: input.message,
    verification: input.verification,
    createdAt: input.createdAt,
  };
  const existing = readMcpToolExecutionAuditFile(input.workspacePath);
  writeMcpToolExecutionAuditFile(input.workspacePath, [
    entry,
    ...existing.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_MCP_EXECUTION_AUDIT_ITEMS));
  return entry;
}

function recordMcpSessionAudit(input: {
  workspacePath: string;
  approvalId?: string;
  sessionId: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  status: DesktopMcpSessionAuditStatus;
  resourceCount?: number;
  toolCount?: number;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  message: string;
  verification: string;
  createdAt: string;
}): DesktopMcpSessionAuditEntry {
  const entry: DesktopMcpSessionAuditEntry = {
    id: createMcpSessionAuditId(input),
    workspacePath: input.workspacePath,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    sessionId: input.sessionId,
    phase: input.phase,
    server: input.server,
    ...(input.tool ? { tool: input.tool } : {}),
    status: input.status,
    ...(typeof input.resourceCount === "number" ? { resourceCount: input.resourceCount } : {}),
    ...(typeof input.toolCount === "number" ? { toolCount: input.toolCount } : {}),
    ...(input.reusedSession ? { reusedSession: true } : {}),
    ...(input.sessionReuseKey ? { sessionReuseKey: input.sessionReuseKey } : {}),
    message: input.message,
    verification: input.verification,
    createdAt: input.createdAt,
  };
  const existing = readMcpSessionAuditFile(input.workspacePath);
  writeMcpSessionAuditFile(input.workspacePath, [
    entry,
    ...existing.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_MCP_SESSION_AUDIT_ITEMS));
  return entry;
}

function readMcpToolExecutionAuditFile(
  workspacePath: string,
): DesktopMcpToolExecutionAuditEntry[] {
  const sourcePath = resolve(workspacePath, MCP_EXECUTION_AUDIT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath) || !existsSync(sourcePath)) {
    return [];
  }
  const linkStats = lstatSync(sourcePath);
  if (linkStats.isSymbolicLink()) {
    throw new Error("MCP execution audit cannot be read through a symbolic link.");
  }
  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    throw new Error("MCP execution audit must be a file.");
  }
  if (stats.size > MAX_MCP_EXECUTION_AUDIT_BYTES) {
    throw new Error("MCP execution audit is too large.");
  }
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
    const entries =
      parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return entries
      .filter(isMcpToolExecutionAuditEntry)
      .slice(0, MAX_MCP_EXECUTION_AUDIT_ITEMS);
  } catch {
    return [];
  }
}

function readMcpSessionAuditFile(
  workspacePath: string,
): DesktopMcpSessionAuditEntry[] {
  const sourcePath = resolve(workspacePath, MCP_SESSION_AUDIT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath) || !existsSync(sourcePath)) {
    return [];
  }
  const linkStats = lstatSync(sourcePath);
  if (linkStats.isSymbolicLink()) {
    throw new Error("MCP session audit cannot be read through a symbolic link.");
  }
  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    throw new Error("MCP session audit must be a file.");
  }
  if (stats.size > MAX_MCP_SESSION_AUDIT_BYTES) {
    throw new Error("MCP session audit is too large.");
  }
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
    const entries =
      parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return entries
      .filter(isMcpSessionAuditEntry)
      .slice(0, MAX_MCP_SESSION_AUDIT_ITEMS);
  } catch {
    return [];
  }
}

function writeMcpToolExecutionAuditFile(
  workspacePath: string,
  entries: DesktopMcpToolExecutionAuditEntry[],
): void {
  const sourcePath = resolve(workspacePath, MCP_EXECUTION_AUDIT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath)) {
    throw new Error("MCP execution audit must stay inside the workspace.");
  }
  if (existsSync(sourcePath)) {
    const linkStats = lstatSync(sourcePath);
    if (linkStats.isSymbolicLink()) {
      throw new Error("MCP execution audit cannot be written through a symbolic link.");
    }
    if (!linkStats.isFile()) {
      throw new Error("MCP execution audit target must be a file.");
    }
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(
    sourcePath,
    `${JSON.stringify(
      {
        version: 1,
        generatedBy: "desktop-mcp-execution-audit",
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeMcpSessionAuditFile(
  workspacePath: string,
  entries: DesktopMcpSessionAuditEntry[],
): void {
  const sourcePath = resolve(workspacePath, MCP_SESSION_AUDIT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, sourcePath)) {
    throw new Error("MCP session audit must stay inside the workspace.");
  }
  if (existsSync(sourcePath)) {
    const linkStats = lstatSync(sourcePath);
    if (linkStats.isSymbolicLink()) {
      throw new Error("MCP session audit cannot be written through a symbolic link.");
    }
    if (!linkStats.isFile()) {
      throw new Error("MCP session audit target must be a file.");
    }
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(
    sourcePath,
    `${JSON.stringify(
      {
        version: 1,
        generatedBy: "desktop-mcp-session-audit",
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function isMcpToolExecutionAuditEntry(
  value: unknown,
): value is DesktopMcpToolExecutionAuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.workspacePath === "string" &&
    typeof record.server === "string" &&
    typeof record.tool === "string" &&
    (record.status === "completed" ||
      record.status === "failed" ||
      record.status === "rejected" ||
      record.status === "cancelled") &&
    typeof record.inputPreview === "string" &&
    typeof record.message === "string" &&
    typeof record.verification === "string" &&
    typeof record.createdAt === "string"
  );
}

function isMcpSessionAuditEntry(
  value: unknown,
): value is DesktopMcpSessionAuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.workspacePath === "string" &&
    typeof record.sessionId === "string" &&
    (record.phase === "enumeration" ||
      record.phase === "tool_execution" ||
      record.phase === "reusable_pool") &&
    typeof record.server === "string" &&
    (record.status === "started" ||
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "timed_out" ||
      record.status === "rejected" ||
      record.status === "cancelled" ||
      record.status === "closed") &&
    typeof record.message === "string" &&
    typeof record.verification === "string" &&
    typeof record.createdAt === "string"
  );
}

function createMcpAuditId(input: {
  approvalId?: string;
  server: string;
  tool: string;
  status: DesktopMcpToolExecutionAuditStatus;
  createdAt: string;
}): string {
  const seed = [
    input.approvalId ?? "direct",
    input.server,
    input.tool,
    input.status,
    input.createdAt,
  ].join(":");
  return `mcp-exec:${stableAuditHash(seed)}`;
}

function createMcpSessionId(input: {
  approvalId?: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
}): string {
  const seed = [
    input.approvalId ?? "direct",
    input.phase,
    input.server,
    input.tool ?? "",
    Date.now().toString(36),
  ].join(":");
  return `mcp-session:${stableAuditHash(seed)}`;
}

function createMcpSessionAuditId(input: {
  sessionId: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  status: DesktopMcpSessionAuditStatus;
  createdAt: string;
}): string {
  const seed = [
    input.sessionId,
    input.phase,
    input.server,
    input.tool ?? "",
    input.status,
    input.createdAt,
  ].join(":");
  return `mcp-session-audit:${stableAuditHash(seed)}`;
}

function stableAuditHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function previewAuditValue(value: Record<string, unknown> | string): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  return text.replace(/\r\n/g, "\n").trim().slice(0, MAX_MCP_AUDIT_PREVIEW_CHARS);
}

function assertSafeMcpContextWriteTarget(sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  const linkStats = lstatSync(sourcePath);
  if (linkStats.isSymbolicLink()) {
    throw new Error("MCP reviewed handoff cannot be written through a symbolic link.");
  }
  if (!linkStats.isFile()) {
    throw new Error("MCP reviewed handoff target must be a file.");
  }
}

function normalizeMcpContextRecord(
  record: Record<string, unknown>,
  serverName: string,
  kind: "resource" | "tool",
): Record<string, unknown> {
  return {
    server: serverName,
    name: sanitizeName(record.name ?? record.uri ?? record.title, 160) || `${kind}-${Date.now()}`,
    title: sanitizeName(record.title ?? record.name ?? record.uri, 180),
    uri: sanitizeName(record.uri, 240) || undefined,
    description: sanitizeDescription(record.description),
    inputSchema: record.inputSchema ?? record.input_schema ?? undefined,
    content: sanitizeDescription(record.text ?? record.summary ?? record.content),
  };
}

function toServerSummary(server: NormalizedMcpServer): DesktopMcpLiveServerSummary {
  return {
    name: server.name,
    command: [server.command, ...server.args].join(" "),
    status: "configured",
    resourceCount: 0,
    toolCount: 0,
    description: server.description,
  };
}

function toSmokeReadinessServer(server: NormalizedMcpServer): DesktopMcpSmokeReadinessServer {
  const runner = classifyMcpRunner(server);
  const commandLine = [server.command, ...server.args].join(" ");
  const envKeys = Object.keys(server.env).sort().slice(0, 24);
  const checks = [
    "Config parsed from bounded workspace-local .drsai/mcp-servers.json.",
    "Command will use shell:false when an approved live MCP run starts.",
    server.cwd
      ? "Configured cwd resolves inside the current workspace."
      : "No workspace cwd override is configured.",
    envKeys.length
      ? `Environment variables are referenced by key only: ${envKeys.join(", ")}.`
      : "No MCP-specific environment variables are configured.",
  ];
  const risks = collectMcpSmokeRisks(server, runner);
  const thirdParty = runner === "package_runner" || runner === "container";
  const blocked = commandLine.length > 1200 || /[\r\n]/.test(commandLine);
  const status = blocked
    ? "blocked"
    : risks.length || thirdParty
      ? "review_required"
      : "ready";
  return {
    name: server.name,
    command: commandLine,
    status,
    runner,
    thirdParty,
    reusableSessionEligible: status !== "blocked",
    cwdScope: server.cwd ? "workspace" : "default",
    envKeys,
    checks,
    risks,
    verification:
      thirdParty
        ? "Third-party MCP server smoke is readiness-only until the user approves a live enumeration or tool execution; this check did not install packages, start containers, spawn stdio, or call networks."
        : "Local MCP server smoke readiness checked configuration shape only; this check did not spawn stdio, enumerate resources, execute tools, call networks, or write reviewed context.",
  };
}

function classifyMcpRunner(
  server: NormalizedMcpServer,
): DesktopMcpSmokeReadinessServer["runner"] {
  const commandName = server.command
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/i, "") ?? "";
  if (commandName === "docker" || commandName === "podman") return "container";
  if (
    commandName === "npx" ||
    commandName === "pnpm" ||
    commandName === "yarn" ||
    commandName === "bun" ||
    commandName === "uvx" ||
    commandName === "pipx"
  ) {
    return "package_runner";
  }
  if (commandName === "node" || commandName === "nodejs" || commandName === "tsx") return "node";
  if (
    commandName === "python" ||
    commandName === "python3" ||
    commandName === "py" ||
    commandName === "uv"
  ) {
    return "python";
  }
  if (commandName) return "local";
  return "unknown";
}

function collectMcpSmokeRisks(
  server: NormalizedMcpServer,
  runner: DesktopMcpSmokeReadinessServer["runner"],
): string[] {
  const risks: string[] = [];
  const argsText = server.args.join(" ");
  if (runner === "package_runner") {
    risks.push("Package runner may download or resolve third-party MCP server code during an approved live run.");
  }
  if (runner === "container") {
    risks.push("Container runner may pull images or access mounted resources during an approved live run.");
  }
  if (runner === "unknown") {
    risks.push("Command runner could not be classified.");
  }
  if (/\b(--mount|-v|--volume)\b/i.test(argsText)) {
    risks.push("Container or runtime mount arguments need human review.");
  }
  if (/\b(http|https):\/\//i.test(argsText)) {
    risks.push("Command arguments include remote URLs.");
  }
  if (Object.keys(server.env).some((key) => /TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(key))) {
    risks.push("Environment references include credential-shaped keys; values remain hidden.");
  }
  return risks.slice(0, 12);
}

function parseMcpToolInput(input?: string): Record<string, unknown> {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("MCP tool input must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP tool input must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function sanitizeToolResult(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2) ?? "";
  return text.replace(/\r\n/g, "\n").trim().slice(0, MAX_MCP_TOOL_RESULT_CHARS);
}

function resolveWorkspacePath(workspacePath: string): string {
  if (
    typeof workspacePath !== "string" ||
    !workspacePath.trim() ||
    workspacePath.length > 2048 ||
    /[\r\n]/.test(workspacePath)
  ) {
    throw new Error("MCP live bridge workspace path is invalid.");
  }
  const resolved = resolve(workspacePath.trim());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("MCP live bridge workspace path does not exist or is not a directory.");
  }
  return resolved;
}

function resolveWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  options: { mustExist: boolean; maxBytes: number; label: string },
): string {
  const candidate = resolve(workspacePath, relativePath);
  if (!isInsideWorkspace(workspacePath, candidate)) {
    throw new Error(`${options.label} must stay inside the workspace.`);
  }
  if (!existsSync(candidate)) {
    if (options.mustExist) throw new Error(`${options.label} was not found.`);
    return candidate;
  }
  const linkStats = lstatSync(candidate);
  if (linkStats.isSymbolicLink()) {
    throw new Error(`${options.label} cannot be a symbolic link.`);
  }
  const stats = statSync(candidate);
  if (!stats.isFile()) {
    throw new Error(`${options.label} must be a file.`);
  }
  if (stats.size > options.maxBytes) {
    throw new Error(`${options.label} is too large.`);
  }
  return candidate;
}

function resolveWorkspaceChild(workspacePath: string, value: string): string | undefined {
  const candidate = resolve(workspacePath, value);
  return isInsideWorkspace(workspacePath, candidate) ? candidate : undefined;
}

function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const relativePath = relative(workspacePath, candidatePath);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !resolve(candidatePath).startsWith(`${resolve(workspacePath)}${sep}..`)
  );
}

function sanitizeCommand(value: unknown): string {
  if (typeof value !== "string") return "";
  const command = value.trim();
  if (!command || command.length > 260 || /[\r\n]/.test(command)) return "";
  return command;
}

function sanitizeArg(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const arg = String(value).trim();
  if (!arg || arg.length > 600 || /[\r\n]/.test(arg)) return undefined;
  return arg;
}

function sanitizeName(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeDescription(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).replace(/\r\n/g, "\n").trim().slice(0, 4000);
  return text || undefined;
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const safeKey = key.trim();
    if (!/^[A-Z_][A-Z0-9_]{0,80}$/i.test(safeKey)) continue;
    const safeValue = sanitizeArg(raw);
    if (safeValue) env[safeKey] = safeValue;
  }
  return env;
}
