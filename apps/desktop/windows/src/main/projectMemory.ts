import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopProjectMemoryAddRequest,
  DesktopProjectMemoryClearRequest,
  DesktopProjectMemoryClearResult,
  DesktopProjectMemoryEntry,
  DesktopProjectMemoryListRequest,
  DesktopProjectMemoryUpdateRequest,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const PROJECT_MEMORY_FILE = join(DRSAI_HOME, "desktop", "project-memory.json");
const MAX_MEMORY_ENTRIES_PER_WORKSPACE = 200;
const MAX_MEMORY_CONTENT_CHARS = 4000;
const MAX_WORKSPACE_PATH_CHARS = 2048;

interface ProjectMemoryStore {
  workspaces: Record<string, DesktopProjectMemoryEntry[]>;
}

export async function listProjectMemory(
  rawRequest: unknown,
): Promise<DesktopProjectMemoryEntry[]> {
  const request = validateListRequest(rawRequest);
  const store = await readProjectMemoryStore();
  const key = workspaceKey(request.workspacePath);
  return (store.workspaces[key] ?? [])
    .slice()
    .sort(compareMemoryEntries)
    .slice(0, request.limit ?? 20);
}

export async function addProjectMemory(
  rawRequest: unknown,
): Promise<DesktopProjectMemoryEntry> {
  const request = validateAddRequest(rawRequest);
  const store = await readProjectMemoryStore();
  const key = workspaceKey(request.workspacePath);
  const now = new Date().toISOString();
  const entry: DesktopProjectMemoryEntry = {
    id: `memory-${randomUUID()}`,
    workspacePath: request.workspacePath,
    content: request.content,
    createdAt: now,
    updatedAt: now,
    source: request.source ?? "manual",
  };
  const entries = [entry, ...(store.workspaces[key] ?? [])]
    .sort(compareMemoryEntries)
    .slice(0, MAX_MEMORY_ENTRIES_PER_WORKSPACE);
  store.workspaces[key] = entries;
  await writeProjectMemoryStore(store);
  return entry;
}

export async function updateProjectMemory(
  rawRequest: unknown,
): Promise<DesktopProjectMemoryEntry> {
  const request = validateUpdateRequest(rawRequest);
  const store = await readProjectMemoryStore();
  const key = workspaceKey(request.workspacePath);
  const entries = store.workspaces[key] ?? [];
  const existingIndex = entries.findIndex((entry) => entry.id === request.entryId);
  if (existingIndex === -1) {
    throw new Error("Project memory entry was not found.");
  }
  const existing = entries[existingIndex];
  const updated: DesktopProjectMemoryEntry = {
    ...existing,
    content: request.content,
    source: request.source ?? existing.source,
    updatedAt: new Date().toISOString(),
  };
  const next = [...entries];
  next[existingIndex] = updated;
  store.workspaces[key] = next.sort(compareMemoryEntries);
  await writeProjectMemoryStore(store);
  return updated;
}

export async function clearProjectMemory(
  rawRequest: unknown,
): Promise<DesktopProjectMemoryClearResult> {
  const request = validateClearRequest(rawRequest);
  const store = await readProjectMemoryStore();
  const key = workspaceKey(request.workspacePath);
  const existing = store.workspaces[key] ?? [];
  if (request.entryId) {
    const next = existing.filter((entry) => entry.id !== request.entryId);
    store.workspaces[key] = next;
    await writeProjectMemoryStore(store);
    return {
      workspacePath: request.workspacePath,
      removedCount: existing.length - next.length,
    };
  }
  delete store.workspaces[key];
  await writeProjectMemoryStore(store);
  return {
    workspacePath: request.workspacePath,
    removedCount: existing.length,
  };
}

async function readProjectMemoryStore(): Promise<ProjectMemoryStore> {
  try {
    const parsed = JSON.parse(await readFile(PROJECT_MEMORY_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ProjectMemoryStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ProjectMemoryStore["workspaces"] = {};
    for (const [key, entries] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(entries)) continue;
      const validEntries = entries
        .filter(isMemoryEntry)
        .sort(compareMemoryEntries)
        .slice(0, MAX_MEMORY_ENTRIES_PER_WORKSPACE);
      if (validEntries.length) workspaces[key] = validEntries;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

async function writeProjectMemoryStore(store: ProjectMemoryStore): Promise<void> {
  await mkdir(dirname(PROJECT_MEMORY_FILE), { recursive: true });
  await writeFile(PROJECT_MEMORY_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function validateListRequest(rawRequest: unknown): DesktopProjectMemoryListRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project memory list request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectMemoryListRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    limit: sanitizeLimit(request.limit),
  };
}

function validateAddRequest(rawRequest: unknown): DesktopProjectMemoryAddRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project memory add request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectMemoryAddRequest>;
  const content = sanitizeMemoryContent(request.content);
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    content,
    source:
      request.source === "chat_command" ||
      request.source === "retrospective" ||
      request.source === "manual"
        ? request.source
        : "manual",
  };
}

function validateUpdateRequest(rawRequest: unknown): DesktopProjectMemoryUpdateRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project memory update request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectMemoryUpdateRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    entryId: requireMemoryId(request.entryId),
    content: sanitizeMemoryContent(request.content),
    source:
      request.source === "chat_command" ||
      request.source === "retrospective" ||
      request.source === "manual"
        ? request.source
        : undefined,
  };
}

function validateClearRequest(rawRequest: unknown): DesktopProjectMemoryClearRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project memory clear request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectMemoryClearRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    entryId: sanitizeMemoryId(request.entryId),
  };
}

function requireMemoryId(value: unknown): string {
  const id = sanitizeMemoryId(value);
  if (!id) {
    throw new Error("Project memory id is required.");
  }
  return id;
}

function sanitizeWorkspacePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(value)
  ) {
    throw new Error("Project memory workspace path is invalid.");
  }
  return value.trim();
}

function sanitizeMemoryContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Project memory content is required.");
  }
  if (value.length > MAX_MEMORY_CONTENT_CHARS) {
    throw new Error("Project memory content is too long.");
  }
  return value.trim();
}

function sanitizeLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(Number(value))));
}

function sanitizeMemoryId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^memory-[a-zA-Z0-9-]{36}$/.test(value)) {
    throw new Error("Project memory id is invalid.");
  }
  return value;
}

function isMemoryEntry(value: unknown): value is DesktopProjectMemoryEntry {
  const entry = value as DesktopProjectMemoryEntry;
  return Boolean(
    entry &&
      typeof entry.id === "string" &&
      /^memory-[a-zA-Z0-9-]{36}$/.test(entry.id) &&
      typeof entry.workspacePath === "string" &&
      typeof entry.content === "string" &&
      typeof entry.createdAt === "string" &&
      typeof entry.updatedAt === "string",
  );
}

function compareMemoryEntries(
  left: DesktopProjectMemoryEntry,
  right: DesktopProjectMemoryEntry,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function workspaceKey(workspacePath: string): string {
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
