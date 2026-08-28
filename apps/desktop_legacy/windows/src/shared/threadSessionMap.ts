import type { DesktopThread } from "./desktopApi";

/**
 * Gateway / shared-DB session row shape (loose).
 * Field names match current GET /v1/threads payloads; extras are ignored.
 * Do not widen DesktopThread until backend fields stabilize.
 */
export interface GatewaySession {
  thread_id?: string;
  session_id?: string;
  id?: string;
  name?: string;
  title?: string;
  workspace_id?: string;
  workspace_path?: string;
  workdir?: string;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
  pinned?: boolean;
  archived?: boolean;
  status?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface MapSessionToThreadOptions {
  /** Fallback workspace path when the session row omits one. */
  workspacePath?: string;
  /** Default kind when the row does not specify a recognized kind. */
  defaultKind?: DesktopThread["kind"];
}

/**
 * Map a gateway session / remote thread row → DesktopThread.
 * Pure mapping only — listThreads UI stays on DesktopThread; swap the list
 * source in main later without touching the renderer.
 */
export function mapSessionToThread(
  session: GatewaySession | Record<string, unknown> | null | undefined,
  options: MapSessionToThreadOptions = {},
): DesktopThread | null {
  if (!session || typeof session !== "object") return null;

  const row = session as GatewaySession;
  const id = pickString(row.thread_id) || pickString(row.session_id) || pickString(row.id);
  if (!id) return null;

  const updatedAt =
    pickIsoTimestamp(row.updated_at) ||
    pickIsoTimestamp(row.created_at) ||
    new Date().toISOString();
  const createdAt = pickIsoTimestamp(row.created_at) || updatedAt;
  const title =
    pickString(row.name) ||
    pickString(row.title) ||
    "Untitled session";
  const workspacePath =
    pickString(row.workspace_path) ||
    pickString(row.workdir) ||
    options.workspacePath;
  const kind = row.kind === "agent_run" ? "agent_run" : options.defaultKind ?? "chat";
  const status = normalizeStatus(row.status);

  return {
    id,
    kind,
    title,
    // Keep original casing; compare via normalizeWorkspacePath at filter sites.
    workspacePath,
    createdAt,
    updatedAt,
    status,
    messageCount: typeof row.message_count === "number" ? row.message_count : 0,
    pinned: row.pinned === true ? true : undefined,
    archived: row.archived === true ? true : undefined,
  };
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function normalizeStatus(value: unknown): DesktopThread["status"] {
  if (value === "running" || value === "error" || value === "idle") return value;
  return "idle";
}
