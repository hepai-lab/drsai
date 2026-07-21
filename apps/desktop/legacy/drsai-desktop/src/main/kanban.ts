/**
 * Kanban via DrSai API Gateway (/v1/kanban/*).
 *
 * The gateway uses a per-user JSON store (no native drsai kanban runtime yet),
 * so this is essentially shared persistence: any client (desktop, future TUI,
 * future CLI) that talks to the same gateway sees the same boards / tasks.
 */

import http from "http";
import { getUserName } from "./config";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "18642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  tenant?: string;
  workspace?: string;
  triage?: boolean;
  skills?: string[];
  maxRetries?: number;
}

interface Board {
  slug: string;
  name: string;
  archived?: boolean;
  created_at?: string;
}

interface Task {
  id: string;
  board: string;
  title: string;
  body?: string;
  assignee?: string | null;
  priority?: number;
  status: string;
  blocked?: boolean;
  block_reason?: string | null;
  archived?: boolean;
  skills?: string[];
  comments?: Array<{ id: string; body: string; created_at: string }>;
  created_at?: string;
  updated_at?: string;
}

function userQuery(extraParams: Record<string, string | number | boolean | undefined> = {}): string {
  const params = new URLSearchParams();
  const u = getUserName();
  if (u) params.set("user_id", u);
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL}${path}`;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 8000,
        headers: bodyStr
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(bodyStr)),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.parse(data).detail || data; } catch { /* keep */ }
            reject(new Error(detail));
            return;
          }
          try { resolve(data ? (JSON.parse(data) as T) : ({} as T)); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Kanban API request timed out"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Boards ───────────────────────────────────────────

export async function listBoards(
  includeArchived: boolean = false,
  _profile?: string,
): Promise<Board[]> {
  try {
    return await apiRequest<Board[]>(
      "GET",
      `/v1/kanban/boards${userQuery({ include_archived: includeArchived })}`,
    );
  } catch (err) {
    console.warn("[kanban] listBoards failed:", (err as Error).message);
    return [];
  }
}

export async function currentBoard(_profile?: string): Promise<Board | null> {
  try {
    return await apiRequest<Board>("GET", `/v1/kanban/board${userQuery()}`);
  } catch (err) {
    console.warn("[kanban] currentBoard failed:", (err as Error).message);
    return null;
  }
}

export async function switchBoard(
  slug: string,
  _profile?: string,
): Promise<boolean> {
  try {
    await apiRequest(
      "POST",
      `/v1/kanban/boards/${encodeURIComponent(slug)}/switch${userQuery()}`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function createBoard(
  slug: string,
  name?: string,
  switchAfter?: boolean,
  _profile?: string,
): Promise<Board | null> {
  try {
    return await apiRequest<Board>(
      "POST",
      `/v1/kanban/boards${userQuery()}`,
      { slug, name, switch: !!switchAfter },
    );
  } catch (err) {
    console.warn("[kanban] createBoard failed:", (err as Error).message);
    return null;
  }
}

export async function removeBoard(
  slug: string,
  hardDelete?: boolean,
  _profile?: string,
): Promise<boolean> {
  try {
    await apiRequest(
      "DELETE",
      `/v1/kanban/boards/${encodeURIComponent(slug)}${userQuery({ hard_delete: !!hardDelete })}`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── Tasks ────────────────────────────────────────────

interface ListFilters {
  status?: string;
  assignee?: string;
  tenant?: string;
  includeArchived?: boolean;
  board?: string;
}

export async function listTasks(filters: ListFilters = {}): Promise<Task[]> {
  try {
    return await apiRequest<Task[]>(
      "GET",
      `/v1/kanban/tasks${userQuery({
        board: filters.board,
        status: filters.status,
        assignee: filters.assignee,
        include_archived: filters.includeArchived,
      })}`,
    );
  } catch (err) {
    console.warn("[kanban] listTasks failed:", (err as Error).message);
    return [];
  }
}

export async function getTask(
  taskId: string,
  _profile?: string,
): Promise<Task | null> {
  try {
    return await apiRequest<Task>(
      "GET",
      `/v1/kanban/tasks/${encodeURIComponent(taskId)}${userQuery()}`,
    );
  } catch {
    return null;
  }
}

export async function createTask(
  input: CreateTaskInput,
  _profile?: string,
): Promise<Task | null> {
  try {
    return await apiRequest<Task>(
      "POST",
      `/v1/kanban/tasks${userQuery()}`,
      {
        title: input.title,
        body: input.body,
        assignee: input.assignee,
        priority: input.priority,
        tenant: input.tenant,
        workspace: input.workspace,
        triage: !!input.triage,
        skills: input.skills || [],
        max_retries: input.maxRetries || 0,
      },
    );
  } catch (err) {
    console.warn("[kanban] createTask failed:", (err as Error).message);
    return null;
  }
}

async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    await apiRequest(
      "PATCH",
      `/v1/kanban/tasks/${encodeURIComponent(taskId)}${userQuery()}`,
      patch,
    );
    return true;
  } catch (err) {
    console.warn("[kanban] patchTask failed:", (err as Error).message);
    return false;
  }
}

export async function assignTask(
  taskId: string,
  assignee: string | null,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { assignee });
}

export async function completeTask(
  taskId: string,
  _result?: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { status: "done" });
}

export async function blockTask(
  taskId: string,
  reason?: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { blocked: true, block_reason: reason ?? null });
}

export async function unblockTask(
  taskId: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { blocked: false, block_reason: null });
}

export async function archiveTask(
  taskId: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { archived: true });
}

export async function specifyTask(
  taskId: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { status: "open" });
}

export async function reclaimTask(
  taskId: string,
  _reason?: string,
  _profile?: string,
): Promise<boolean> {
  return patchTask(taskId, { status: "open" });
}

export async function commentTask(
  taskId: string,
  body: string,
  _profile?: string,
): Promise<boolean> {
  try {
    await apiRequest(
      "POST",
      `/v1/kanban/tasks/${encodeURIComponent(taskId)}/comments${userQuery()}`,
      { body },
    );
    return true;
  } catch {
    return false;
  }
}

export async function dispatchOnce(
  _dryRun?: boolean,
  _profile?: string,
): Promise<boolean> {
  // drsai has no auto-dispatcher; this is a no-op so the renderer button stays
  // alive without erroring out.
  return true;
}
