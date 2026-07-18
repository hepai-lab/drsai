import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopCustomCommand,
  DesktopCustomCommandDeleteRequest,
  DesktopCustomCommandDeleteResult,
  DesktopCustomCommandListRequest,
  DesktopCustomCommandUpsertRequest,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const CUSTOM_COMMANDS_FILE = join(DRSAI_HOME, "desktop", "custom-commands.json");
const MAX_CUSTOM_COMMANDS_PER_WORKSPACE = 100;
const MAX_COMMAND_PROMPT_CHARS = 8000;
const MAX_COMMAND_TITLE_CHARS = 120;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const RESERVED_COMMAND_NAMES = new Set([
  "agent",
  "commit",
  "compact",
  "diff",
  "fix",
  "fork",
  "goal",
  "mcp",
  "memory",
  "mention",
  "model",
  "permissions",
  "plan",
  "review",
  "skills",
  "status",
  "test",
  "command",
]);

interface CustomCommandStore {
  workspaces: Record<string, DesktopCustomCommand[]>;
}

export async function listCustomCommands(
  rawRequest: unknown,
): Promise<DesktopCustomCommand[]> {
  const request = validateListRequest(rawRequest);
  const store = await readCustomCommandStore();
  const key = workspaceKey(request.workspacePath);
  return (store.workspaces[key] ?? [])
    .slice()
    .sort(compareCustomCommands)
    .slice(0, request.limit ?? 50);
}

export async function upsertCustomCommand(
  rawRequest: unknown,
): Promise<DesktopCustomCommand> {
  const request = validateUpsertRequest(rawRequest);
  const store = await readCustomCommandStore();
  const key = workspaceKey(request.workspacePath);
  const now = new Date().toISOString();
  const entries = store.workspaces[key] ?? [];
  const existingIndex = entries.findIndex((entry) => entry.name === request.name);
  const existing = existingIndex >= 0 ? entries[existingIndex] : undefined;
  const entry: DesktopCustomCommand = {
    id: existing?.id ?? `command-${randomUUID()}`,
    workspacePath: request.workspacePath,
    name: request.name,
    title: request.title ?? existing?.title ?? request.name,
    prompt: request.prompt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: request.source ?? existing?.source ?? "manual",
  };
  const next = existing
    ? entries.map((item, index) => (index === existingIndex ? entry : item))
    : [entry, ...entries];
  store.workspaces[key] = next
    .sort(compareCustomCommands)
    .slice(0, MAX_CUSTOM_COMMANDS_PER_WORKSPACE);
  await writeCustomCommandStore(store);
  return entry;
}

export async function deleteCustomCommand(
  rawRequest: unknown,
): Promise<DesktopCustomCommandDeleteResult> {
  const request = validateDeleteRequest(rawRequest);
  const store = await readCustomCommandStore();
  const key = workspaceKey(request.workspacePath);
  const entries = store.workspaces[key] ?? [];
  const selector = request.commandIdOrName.toLowerCase();
  const next = entries.filter(
    (entry) => entry.id !== request.commandIdOrName && entry.name !== selector,
  );
  store.workspaces[key] = next;
  await writeCustomCommandStore(store);
  return {
    workspacePath: request.workspacePath,
    removedCount: entries.length - next.length,
  };
}

async function readCustomCommandStore(): Promise<CustomCommandStore> {
  try {
    const parsed = JSON.parse(await readFile(CUSTOM_COMMANDS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as CustomCommandStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: CustomCommandStore["workspaces"] = {};
    for (const [key, entries] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(entries)) continue;
      const validEntries = entries
        .filter(isCustomCommand)
        .sort(compareCustomCommands)
        .slice(0, MAX_CUSTOM_COMMANDS_PER_WORKSPACE);
      if (validEntries.length) workspaces[key] = validEntries;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

async function writeCustomCommandStore(store: CustomCommandStore): Promise<void> {
  await mkdir(dirname(CUSTOM_COMMANDS_FILE), { recursive: true });
  await writeFile(CUSTOM_COMMANDS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function validateListRequest(rawRequest: unknown): DesktopCustomCommandListRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Custom command list request must be an object.");
  }
  const request = rawRequest as Partial<DesktopCustomCommandListRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    limit: sanitizeLimit(request.limit),
  };
}

function validateUpsertRequest(rawRequest: unknown): DesktopCustomCommandUpsertRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Custom command upsert request must be an object.");
  }
  const request = rawRequest as Partial<DesktopCustomCommandUpsertRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    name: sanitizeCommandName(request.name),
    prompt: sanitizePrompt(request.prompt),
    title: sanitizeTitle(request.title),
    source: request.source === "chat_command" ? "chat_command" : "manual",
  };
}

function validateDeleteRequest(rawRequest: unknown): DesktopCustomCommandDeleteRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Custom command delete request must be an object.");
  }
  const request = rawRequest as Partial<DesktopCustomCommandDeleteRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    commandIdOrName: sanitizeCommandSelector(request.commandIdOrName),
  };
}

function sanitizeWorkspacePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(value)
  ) {
    throw new Error("Custom command workspace path is invalid.");
  }
  return value.trim();
}

function sanitizeCommandName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Custom command name is required.");
  }
  const name = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) {
    throw new Error("Custom command name must be 2-32 letters, numbers, dashes, or underscores.");
  }
  if (RESERVED_COMMAND_NAMES.has(name)) {
    throw new Error(`/${name} is reserved by a built-in command.`);
  }
  return name;
}

function sanitizeCommandSelector(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /[\r\n]/.test(value)) {
    throw new Error("Custom command selector is invalid.");
  }
  return value.trim();
}

function sanitizePrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Custom command prompt is required.");
  }
  if (value.length > MAX_COMMAND_PROMPT_CHARS) {
    throw new Error("Custom command prompt is too long.");
  }
  return value.trim();
}

function sanitizeTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  if (!title) return undefined;
  return title.slice(0, MAX_COMMAND_TITLE_CHARS);
}

function sanitizeLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(Number(value))));
}

function isCustomCommand(value: unknown): value is DesktopCustomCommand {
  const entry = value as DesktopCustomCommand;
  return Boolean(
    entry &&
      typeof entry.id === "string" &&
      /^command-[a-zA-Z0-9-]{36}$/.test(entry.id) &&
      typeof entry.workspacePath === "string" &&
      typeof entry.name === "string" &&
      typeof entry.title === "string" &&
      typeof entry.prompt === "string" &&
      typeof entry.createdAt === "string" &&
      typeof entry.updatedAt === "string",
  );
}

function compareCustomCommands(
  left: DesktopCustomCommand,
  right: DesktopCustomCommand,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function workspaceKey(workspacePath: string): string {
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
