import type { WebContents } from "electron";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentRunEvent, AgentRunFileEvent, AgentRunRequest } from "../shared/desktopApi";
import { invalidateAuthSession, requireAuthContext, type AuthContext } from "./auth";
import { getGatewayRequestHeaders, startGateway } from "./gateway";
import { getDefaultModelAlias } from "./modelDefaults";
import {
  ChatSseError,
  isCompletionDoneFrame,
  parseAgentRunSseFileEvents,
  parseAgentRunSseFrame,
} from "./sseParser";
import { listThreads, updateThread, upsertThreadFromRun } from "./threads";
import { createWorkspaceCheckpoint } from "./workspaceCheckpoints";

const GATEWAY_BASE_URL = `http://127.0.0.1:${getGatewayPort()}`;
const MAX_ACTIVE_RUNS = 3;
const MAX_TASK_CHARS = 80_000;
const MAX_MODEL_CHARS = 120;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_SSE_BUFFER_CHARS = 1_000_000;
const MAX_ERROR_BODY_BYTES = 64_000;
const AGENT_RUN_TIMEOUT_MS = getPositiveIntEnv("OPENDRSAI_AGENT_RUN_TIMEOUT_MS", 120_000);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const RUN_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const activeRuns = new Map<string, AbortController>();

export async function startAgentRun(
  webContents: WebContents,
  rawRequest: unknown,
): Promise<{ requestId: string; sessionId: string; runId: string }> {
  if (activeRuns.size >= MAX_ACTIVE_RUNS) {
    throw new Error("Too many active agent runs. Stop one before starting another.");
  }
  const request = validateAgentRunRequest(rawRequest);
  const requestId = request.requestId || randomUUID();
  const sessionId = request.threadId || request.sessionId || requestId;
  const runId = request.runId || requestId;
  if (activeRuns.has(requestId)) {
    throw new Error("Agent run request is already active.");
  }

  const auth = await requireAuthContext();
  const controller = new AbortController();
  activeRuns.set(requestId, controller);

  runAgent(webContents, requestId, sessionId, runId, request, auth, controller).catch((error) => {
    activeRuns.delete(requestId);
    const timedOut = controller.signal.aborted && controller.signal.reason === "timeout";
    emit(webContents, {
      requestId,
      sessionId,
      runId,
      type: controller.signal.aborted && !timedOut ? "aborted" : "error",
      error: timedOut
        ? `Gateway agent run timed out after ${Math.round(AGENT_RUN_TIMEOUT_MS / 1000)} seconds. Check model/API key configuration.`
        : error instanceof Error ? error.message : String(error),
    });
  });

  return { requestId, sessionId, runId };
}

export function abortAgentRun(requestId: string): boolean {
  if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
    return false;
  }
  const controller = activeRuns.get(requestId);
  if (!controller) return false;
  controller.abort("user");
  activeRuns.delete(requestId);
  return true;
}

function validateAgentRunRequest(rawRequest: unknown): AgentRunRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Agent run request must be an object.");
  }
  const request = rawRequest as Partial<AgentRunRequest>;
  if (
    request.requestId !== undefined &&
    (typeof request.requestId !== "string" || !REQUEST_ID_PATTERN.test(request.requestId))
  ) {
    throw new Error("Agent run request id is invalid.");
  }
  for (const [name, value] of [
    ["thread id", request.threadId],
    ["session id", request.sessionId],
    ["run id", request.runId],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || !RUN_ID_PATTERN.test(value))) {
      throw new Error(`Agent run ${name} is invalid.`);
    }
  }
  if (typeof request.task !== "string" || !request.task.trim()) {
    throw new Error("Agent run task is required.");
  }
  if (request.task.length > MAX_TASK_CHARS) {
    throw new Error(`Agent run task cannot exceed ${MAX_TASK_CHARS} characters.`);
  }
  if (
    request.model !== undefined &&
    (typeof request.model !== "string" ||
      request.model.length > MAX_MODEL_CHARS ||
      /[\r\n]/.test(request.model))
  ) {
    throw new Error("Agent run model is invalid.");
  }
  if (
    request.workspacePath !== undefined &&
    (typeof request.workspacePath !== "string" ||
      request.workspacePath.length > MAX_WORKSPACE_PATH_CHARS ||
      /[\r\n]/.test(request.workspacePath))
  ) {
    throw new Error("Agent run workspace path is invalid.");
  }
  return {
    requestId: request.requestId,
    threadId: request.threadId?.trim() || undefined,
    sessionId: request.sessionId?.trim() || undefined,
    runId: request.runId?.trim() || undefined,
    task: request.task.trim(),
    model: request.model?.trim() || undefined,
    workspacePath: request.workspacePath?.trim() || undefined,
    files: Array.isArray(request.files) ? request.files : undefined,
    teamConfig: isRecord(request.teamConfig) ? request.teamConfig : null,
    settingsConfig: isRecord(request.settingsConfig) ? request.settingsConfig : null,
    metadata: isRecord(request.metadata) ? request.metadata : undefined,
  };
}

async function runAgent(
  webContents: WebContents,
  requestId: string,
  sessionId: string,
  runId: string,
  request: AgentRunRequest,
  auth: AuthContext,
  controller: AbortController,
): Promise<void> {
  emit(webContents, { requestId, sessionId, runId, type: "start" });
  await upsertThreadFromRun({
    id: sessionId,
    kind: "agent_run",
    title: request.task.slice(0, 80),
    workspacePath: request.workspacePath,
    lastRunId: runId,
    lastRequestId: requestId,
    status: "running",
  });

  const timeout = setTimeout(() => controller.abort("timeout"), AGENT_RUN_TIMEOUT_MS);
  const changeSetCheckpointId = await prepareAgentChangeSetCheckpoint(request, runId);
  const beforeFiles = await readWorkspaceFileSnapshot(request.workspacePath);
  try {
    const ready = await startGateway();
    if (!ready) {
      throw new Error("Gateway is not ready. Install or start OpenDrSai first.");
    }

    const model =
      request.model ||
      resolveModelFromSettings(request.settingsConfig) ||
      getDefaultModelAlias() ||
      "drsai";
    const send = async (authContext: AuthContext): Promise<boolean> => {
      const response = await fetch(`${GATEWAY_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getGatewayRequestHeaders(),
          "X-OpenDrSai-User": authContext.userId,
          "X-OpenDrSai-Auth-Mode": authContext.authMode,
          ...(request.workspacePath ? { "X-OpenDrSai-Workspace": request.workspacePath } : {}),
          ...(authContext.accessToken ? { Authorization: `Bearer ${authContext.accessToken}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: request.task }],
          stream: true,
          user_id: authContext.userId,
          thread_id: sessionId,
          work_dir: request.workspacePath,
          metadata: {
            ...(request.metadata || {}),
            files: request.files || [],
            team_config: request.teamConfig,
            settings_config: request.settingsConfig,
            auth_mode: authContext.authMode,
            run_id: runId,
            desktop_request_id: requestId,
            ...(changeSetCheckpointId ? { change_set_checkpoint_id: changeSetCheckpointId } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw await formatHttpError(response);
      return readSse(webContents, requestId, sessionId, runId, response.body, controller.signal);
    };

    let sawDone: boolean;
    try {
      sawDone = await send(auth);
    } catch (error) {
      if (error instanceof ChatSseError && error.code === "invalid_token") {
        invalidateAuthSession();
        webContents.send("desktop:auth-session-invalidated");
      }
      if (!(error instanceof ChatSseError) || error.code !== "token_expired" || !error.retryable) throw error;
      auth = await requireAuthContext();
      sawDone = await send(auth);
    }
    if (controller.signal.aborted) {
      throw new Error("Agent run was aborted.");
    }
    if (!sawDone) {
      throw new Error("Gateway agent stream ended before data: [DONE].");
    }
    activeRuns.delete(requestId);
    await upsertThreadFromRun({
      id: sessionId,
      kind: "agent_run",
      title: request.task.slice(0, 80),
      workspacePath: request.workspacePath,
      lastRunId: runId,
      lastRequestId: requestId,
      status: "idle",
    });
    await markForkQueueRunState(request, sessionId, "completed", "Fork queue subtask completed.");
    await emitWorkspaceSnapshotEvents(webContents, requestId, sessionId, runId, request.workspacePath, beforeFiles);
    emit(webContents, { requestId, sessionId, runId, type: "done" });
  } catch (error) {
    await upsertThreadFromRun({
      id: sessionId,
      kind: "agent_run",
      title: request.task.slice(0, 80),
      workspacePath: request.workspacePath,
      lastRunId: runId,
      lastRequestId: requestId,
      status: "error",
    });
    await markForkQueueRunState(
      request,
      sessionId,
      "blocked",
      `Fork queue subtask blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
    await emitWorkspaceSnapshotEvents(webContents, requestId, sessionId, runId, request.workspacePath, beforeFiles);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareAgentChangeSetCheckpoint(
  request: AgentRunRequest,
  runId: string,
): Promise<string | undefined> {
  const existingCheckpointId =
    typeof request.metadata?.change_set_checkpoint_id === "string"
      ? request.metadata.change_set_checkpoint_id.trim()
      : "";
  if (existingCheckpointId) return existingCheckpointId;
  if (!request.workspacePath || !existsSync(request.workspacePath)) return undefined;

  const checkpoint = await createWorkspaceCheckpoint({
    workspacePath: request.workspacePath,
    label: `Before agent run ${runId}`,
    kind: "agent_run_baseline",
    runId,
    maxFiles: 200,
    maxBytesPerFile: 2_000_000,
  });
  if (checkpoint.truncated || checkpoint.skippedFileCount > 0) {
    throw new Error(
      "The pre-run state could not be captured completely because existing changes exceed checkpoint limits or include files larger than 2 MB. The agent was not started to protect user work.",
    );
  }
  return checkpoint.id;
}

async function readSse(
  webContents: WebContents,
  requestId: string,
  sessionId: string,
  runId: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let emittedContent = false;

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > MAX_SSE_BUFFER_CHARS) {
      throw new Error("Gateway agent stream exceeded the maximum buffered response size.");
    }

    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (isCompletionDoneFrame(frame)) {
        sawDone = true;
      }
      try {
        parseAgentRunSseFrame(frame).forEach((content) => {
          emittedContent = true;
          emit(webContents, { requestId, sessionId, runId, type: "chunk", content });
        });
      } catch (error) {
        if (error instanceof ChatSseError && emittedContent) error.retryable = false;
        throw error;
      }
      parseAgentRunSseFileEvents(frame).forEach((fileEvent) => {
        emit(webContents, { requestId, sessionId, runId, type: "file_event", fileEvent });
      });
    }
  }

  if (!signal.aborted) {
    if (isCompletionDoneFrame(buffer)) {
      sawDone = true;
    }
    try {
      parseAgentRunSseFrame(buffer).forEach((content) => {
        emittedContent = true;
        emit(webContents, { requestId, sessionId, runId, type: "chunk", content });
      });
    } catch (error) {
      if (error instanceof ChatSseError && emittedContent) error.retryable = false;
      throw error;
    }
    parseAgentRunSseFileEvents(buffer).forEach((fileEvent) => {
      emit(webContents, { requestId, sessionId, runId, type: "file_event", fileEvent });
    });
  }
  return sawDone;
}

async function markForkQueueRunState(
  request: AgentRunRequest,
  threadId: string,
  queueStatus: "completed" | "blocked",
  queueMessage: string,
): Promise<void> {
  if (request.metadata?.fork_queue_dispatch !== true) return;
  const now = new Date().toISOString();
  const thread = (await listThreads()).find((item) => item.id === threadId);
  if (!thread?.fork) return;
  await updateThread({
    id: threadId,
    status: queueStatus === "completed" ? "idle" : "error",
    fork: {
      ...thread.fork,
      queueStatus,
      queueMessage,
      queueUpdatedAt: now,
    },
  }).catch(() => undefined);
}

interface WorkspaceFileSnapshotItem {
  hash: string | null;
  path: string;
  status: string;
}

async function readWorkspaceFileSnapshot(
  workspacePath: string | undefined,
): Promise<Map<string, WorkspaceFileSnapshotItem>> {
  if (!workspacePath) return new Map();
  const statusOutput = await runGit(workspacePath, ["status", "--porcelain=v1"], 8000);
  if (!statusOutput) return new Map();
  const entries = await Promise.all(
    statusOutput
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(async (line): Promise<WorkspaceFileSnapshotItem | null> => {
        const status = line.slice(0, 2).trim() || "modified";
        const rawPath = line.slice(3).trim();
        const path = normalizeGitStatusPath(rawPath);
        if (!path) return null;
        return {
          hash: await hashWorkspaceFile(workspacePath, path),
          path,
          status,
        };
      }),
  );
  return new Map(
    entries
      .filter(isSnapshotItem)
      .map((entry) => [entry.path, entry] as const),
  );
}

function isSnapshotItem(
  value: WorkspaceFileSnapshotItem | null,
): value is WorkspaceFileSnapshotItem {
  return value !== null;
}

async function emitWorkspaceSnapshotEvents(
  webContents: WebContents,
  requestId: string,
  sessionId: string,
  runId: string,
  workspacePath: string | undefined,
  before: Map<string, WorkspaceFileSnapshotItem>,
): Promise<void> {
  if (!workspacePath) return;
  const after = await readWorkspaceFileSnapshot(workspacePath);
  const timestamp = new Date().toISOString();
  for (const item of after.values()) {
    const previous = before.get(item.path);
    if (previous && previous.status === item.status && previous.hash === item.hash) continue;
    emit(webContents, {
      requestId,
      sessionId,
      runId,
      type: "file_event",
      fileEvent: snapshotItemToFileEvent(item, timestamp),
    });
  }
}

function snapshotItemToFileEvent(
  item: WorkspaceFileSnapshotItem,
  timestamp: string,
): AgentRunFileEvent {
  return {
    action: classifySnapshotAction(item.status),
    hash: item.hash ?? undefined,
    name: item.path,
    path: item.path,
    source: "desktop-git-snapshot",
    timestamp,
  };
}

function classifySnapshotAction(status: string): AgentRunFileEvent["action"] {
  if (status.includes("D")) return "delete";
  if (status.includes("A") || status.includes("?")) return "artifact";
  return "modify";
}

function normalizeGitStatusPath(value: string): string {
  const normalized = value.replace(/^"|"$/g, "");
  const renameTarget = normalized.includes(" -> ")
    ? normalized.split(" -> ").pop() ?? normalized
    : normalized;
  return renameTarget.replace(/\\/g, "/").trim();
}

async function hashWorkspaceFile(
  workspacePath: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const filePath = join(workspacePath, relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > 25_000_000) return null;
    return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
  } catch {
    return null;
  }
}

async function formatHttpError(response: Response): Promise<Error> {
  let body = "";
  try {
    body = (await readLimitedText(response, MAX_ERROR_BODY_BYTES)).trim();
  } catch {
    body = "";
  }
  if (!body) return new Error(`Gateway agent run failed with HTTP ${response.status}.`);
  try {
    const parsed = JSON.parse(body);
    const structured = extractStructuredError(parsed);
    if (structured) return new ChatSseError(structured.message, structured.code, structured.retryable);
    const detail = extractErrorMessage(parsed);
    if (detail) return new Error(`Gateway agent run failed: ${String(detail)}`);
  } catch {
    // Keep the raw body below.
  }
  return new Error(`Gateway agent run failed with HTTP ${response.status}: ${body.slice(0, 600)}`);
}

function extractStructuredError(value: unknown): { code: string; message: string; retryable: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = (record.error && typeof record.error === "object" ? record.error : record.detail) as Record<string, unknown> | undefined;
  if (!candidate || typeof candidate.code !== "string") return null;
  return {
    code: candidate.code,
    message: typeof candidate.message === "string" ? candidate.message : "HepAI request failed.",
    retryable: candidate.retryable === true,
  };
}

function extractErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);

  const record = value as Record<string, unknown>;
  return extractErrorMessage(record.detail) ||
    extractErrorMessage(record.message) ||
    extractErrorMessage(record.error) ||
    null;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - total;
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    total += chunk.byteLength;
    if (value.byteLength > remaining) break;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function resolveModelFromSettings(settings: Record<string, unknown> | null | undefined): string | undefined {
  const direct = settings?.defult_config_name || settings?.default_config_name;
  return typeof direct === "string" && direct.trim() ? direct.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function emit(webContents: WebContents, event: AgentRunEvent): void {
  webContents.send("desktop:agent-run-event", event);
}

function runGit(cwd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

function getPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getGatewayPort(): string {
  const rawPort = process.env.OPENDRSAI_GATEWAY_PORT || process.env.DRSAI_API_PORT || "18642";
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? String(parsed) : "18642";
}
