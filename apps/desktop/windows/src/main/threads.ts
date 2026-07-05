import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { CreateThreadRequest, DesktopThread, UpdateThreadRequest } from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const THREADS_FILE = join(DRSAI_HOME, "desktop", "threads.json");
const MAX_THREADS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const THREAD_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;

export async function listThreads(): Promise<DesktopThread[]> {
  return (await readThreads()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateCreateThreadRequest(rawRequest);
  const now = new Date().toISOString();
  const thread: DesktopThread = {
    id: `thread-${randomUUID()}`,
    kind: request.kind,
    title: request.title || defaultTitle(request.kind),
    workspacePath: request.workspacePath,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    messageCount: 0,
  };
  const threads = [thread, ...(await readThreads())].slice(0, MAX_THREADS);
  await writeThreads(threads);
  return thread;
}

export async function updateThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateUpdateThreadRequest(rawRequest);
  const threads = await readThreads();
  const now = new Date().toISOString();
  const existing = threads.find((thread) => thread.id === request.id);
  const next: DesktopThread = {
    id: request.id,
    kind: request.kind || existing?.kind || "chat",
    title: request.title || existing?.title || defaultTitle(request.kind || existing?.kind || "chat"),
    workspacePath: request.workspacePath ?? existing?.workspacePath,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastRunId: request.lastRunId ?? existing?.lastRunId,
    lastRequestId: request.lastRequestId ?? existing?.lastRequestId,
    status: request.status ?? existing?.status ?? "idle",
    messageCount: request.messageCount ?? existing?.messageCount,
  };
  const withoutCurrent = threads.filter((thread) => thread.id !== request.id);
  await writeThreads([next, ...withoutCurrent].slice(0, MAX_THREADS));
  return next;
}

export async function upsertThreadFromRun(input: {
  id: string;
  kind: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  lastRunId?: string;
  lastRequestId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
}): Promise<DesktopThread> {
  return updateThread(input);
}

async function readThreads(): Promise<DesktopThread[]> {
  try {
    const parsed = JSON.parse(await readFile(THREADS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isThread).slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

async function writeThreads(threads: DesktopThread[]): Promise<void> {
  await mkdir(dirname(THREADS_FILE), { recursive: true });
  await writeFile(THREADS_FILE, `${JSON.stringify(threads, null, 2)}\n`, "utf8");
}

function validateCreateThreadRequest(rawRequest: unknown): CreateThreadRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread request must be an object.");
  }
  const request = rawRequest as Partial<CreateThreadRequest>;
  if (request.kind !== "chat" && request.kind !== "agent_run") {
    throw new Error("Thread kind is invalid.");
  }
  return {
    kind: request.kind,
    title: sanitizeTitle(request.title),
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
  };
}

function validateUpdateThreadRequest(rawRequest: unknown): UpdateThreadRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread update must be an object.");
  }
  const request = rawRequest as Partial<UpdateThreadRequest>;
  if (typeof request.id !== "string" || !THREAD_ID_PATTERN.test(request.id) || /[\r\n]/.test(request.id)) {
    throw new Error("Thread id is invalid.");
  }
  if (request.kind !== undefined && request.kind !== "chat" && request.kind !== "agent_run") {
    throw new Error("Thread kind is invalid.");
  }
  if (
    request.status !== undefined &&
    request.status !== "idle" &&
    request.status !== "running" &&
    request.status !== "error"
  ) {
    throw new Error("Thread status is invalid.");
  }
  return {
    id: request.id,
    kind: request.kind,
    title: sanitizeTitle(request.title),
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    lastRunId: sanitizeOptionalId(request.lastRunId, "Thread run id is invalid."),
    lastRequestId: sanitizeOptionalId(request.lastRequestId, "Thread request id is invalid."),
    status: request.status,
    messageCount: Number.isFinite(request.messageCount) ? Math.max(0, Number(request.messageCount)) : undefined,
  };
}

function sanitizeTitle(title: unknown): string | undefined {
  if (title === undefined) return undefined;
  if (typeof title !== "string" || /[\r\n]/.test(title)) {
    throw new Error("Thread title is invalid.");
  }
  return title.trim().slice(0, MAX_TITLE_CHARS) || undefined;
}

function sanitizeWorkspacePath(path: unknown): string | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== "string" || path.length > MAX_WORKSPACE_PATH_CHARS || /[\r\n]/.test(path)) {
    throw new Error("Thread workspace path is invalid.");
  }
  return path.trim() || undefined;
}

function sanitizeOptionalId(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !THREAD_ID_PATTERN.test(value) || /[\r\n]/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function isThread(value: unknown): value is DesktopThread {
  const thread = value as DesktopThread;
  return Boolean(
    thread &&
      typeof thread.id === "string" &&
      THREAD_ID_PATTERN.test(thread.id) &&
      (thread.kind === "chat" || thread.kind === "agent_run") &&
      typeof thread.title === "string" &&
      typeof thread.createdAt === "string" &&
      typeof thread.updatedAt === "string",
  );
}

function defaultTitle(kind: DesktopThread["kind"]): string {
  return kind === "agent_run" ? "Agent run" : "New chat";
}
