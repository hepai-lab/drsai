import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DesktopCustomCommand, DesktopCustomCommandDeleteResult, DesktopCustomCommandListRequest, DesktopCustomCommandUpsertRequest } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";

const RESERVED = new Set(["agent", "commit", "compact", "diff", "fix", "fork", "goal", "mcp", "memory", "mention", "model", "permissions", "plan", "review", "skills", "status", "test", "command"]);
type Store = { schemaVersion: 2; workspaces: Record<string, DesktopCustomCommand[]> };

export class CustomCommandStore {
  #queue = Promise.resolve();
  constructor(readonly filePath: string) {}
  list(raw: unknown): Promise<DesktopCustomCommand[]> { return this.#run(async () => { const request = listRequest(raw); const store = await this.#read(); return (store.workspaces[key(request.workspacePath)] ?? []).slice().sort(compare).slice(0, request.limit ?? 50); }); }
  upsert(raw: unknown): Promise<DesktopCustomCommand> {
    return this.#run(async () => {
      const request = upsertRequest(raw); const store = await this.#read(); const workspaceKey = key(request.workspacePath); const entries = store.workspaces[workspaceKey] ?? []; const existing = entries.find((item) => item.name === request.name); const now = new Date().toISOString();
      const entry: DesktopCustomCommand = { id: existing?.id ?? `command-${randomUUID()}`, workspacePath: request.workspacePath, name: request.name, title: request.title ?? existing?.title ?? request.name, prompt: request.prompt, createdAt: existing?.createdAt ?? now, updatedAt: now, source: request.source ?? existing?.source ?? "manual" };
      store.workspaces[workspaceKey] = [entry, ...entries.filter((item) => item.name !== entry.name)].sort(compare).slice(0, 100); await this.#write(store); return entry;
    });
  }
  delete(raw: unknown): Promise<DesktopCustomCommandDeleteResult> {
    return this.#run(async () => { const request = deleteRequest(raw); const store = await this.#read(); const workspaceKey = key(request.workspacePath); const entries = store.workspaces[workspaceKey] ?? []; const selector = request.commandIdOrName.toLowerCase(); const next = entries.filter((item) => item.id !== request.commandIdOrName && item.name !== selector); if (next.length) store.workspaces[workspaceKey] = next; else delete store.workspaces[workspaceKey]; if (next.length !== entries.length) await this.#write(store); return { workspacePath: request.workspacePath, removedCount: entries.length - next.length }; });
  }
  async #read(): Promise<Store> { try { const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { workspaces?: unknown }; const workspaces: Record<string, DesktopCustomCommand[]> = {}; if (parsed.workspaces && typeof parsed.workspaces === "object") for (const [workspaceKey, entries] of Object.entries(parsed.workspaces)) if (/^[a-f0-9]{64}$/.test(workspaceKey) && Array.isArray(entries)) { const valid = entries.filter(isCommand).sort(compare).slice(0, 100); if (valid.length) workspaces[workspaceKey] = valid; } return { schemaVersion: 2, workspaces }; } catch { return { schemaVersion: 2, workspaces: {} }; } }
  async #write(store: Store): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, `${JSON.stringify({ ...store, schemaVersion: 2 }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await replaceFileSafely(temporary, this.filePath); await chmod(this.filePath, 0o600).catch(() => undefined); } finally { await rm(temporary, { force: true }); } }
  #run<T>(operation: () => Promise<T>): Promise<T> { const run = this.#queue.catch(() => undefined).then(operation); this.#queue = run.then(() => undefined, () => undefined); return run; }
}

function workspacePath(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 2048 || /[\r\n\0]/.test(value)) throw new Error("Custom command workspace path is invalid."); return value.trim(); }
function name(value: unknown): string { if (typeof value !== "string") throw new Error("Custom command name is required."); const result = value.trim().toLowerCase(); if (!/^[a-z][a-z0-9_-]{1,31}$/.test(result)) throw new Error("Custom command name must be 2-32 letters, numbers, dashes, or underscores."); if (RESERVED.has(result)) throw new Error(`/${result} is reserved by a built-in command.`); return result; }
function prompt(value: unknown): string { if (typeof value !== "string" || !value.trim()) throw new Error("Custom command prompt is required."); if (value.length > 8000) throw new Error("Custom command prompt is too long."); return value.trim(); }
function title(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined; }
function listRequest(raw: unknown): DesktopCustomCommandListRequest { if (!raw || typeof raw !== "object") throw new Error("Custom command list request must be an object."); const value = raw as Record<string, unknown>; return { workspacePath: workspacePath(value.workspacePath), ...(Number.isFinite(value.limit) ? { limit: Math.max(1, Math.min(100, Math.floor(Number(value.limit)))) } : {}) }; }
function upsertRequest(raw: unknown): DesktopCustomCommandUpsertRequest { if (!raw || typeof raw !== "object") throw new Error("Custom command upsert request must be an object."); const value = raw as Record<string, unknown>; return { workspacePath: workspacePath(value.workspacePath), name: name(value.name), prompt: prompt(value.prompt), title: title(value.title), source: value.source === "chat_command" ? "chat_command" : "manual" }; }
function deleteRequest(raw: unknown): { workspacePath: string; commandIdOrName: string } { if (!raw || typeof raw !== "object") throw new Error("Custom command delete request must be an object."); const value = raw as Record<string, unknown>; if (typeof value.commandIdOrName !== "string" || !value.commandIdOrName.trim() || value.commandIdOrName.length > 80 || /[\r\n\0]/.test(value.commandIdOrName)) throw new Error("Custom command selector is invalid."); return { workspacePath: workspacePath(value.workspacePath), commandIdOrName: value.commandIdOrName.trim() }; }
function key(path: string): string { return createHash("sha256").update(path.trim().toLowerCase()).digest("hex"); }
function compare(a: DesktopCustomCommand, b: DesktopCustomCommand): number { return b.updatedAt.localeCompare(a.updatedAt); }
function isCommand(value: unknown): value is DesktopCustomCommand { const item = value as DesktopCustomCommand; return Boolean(item && typeof item.id === "string" && /^command-[A-Za-z0-9-]{36}$/.test(item.id) && typeof item.workspacePath === "string" && typeof item.name === "string" && typeof item.title === "string" && typeof item.prompt === "string" && typeof item.createdAt === "string" && typeof item.updatedAt === "string" && (item.source === "manual" || item.source === "chat_command")); }

const dataRoot = process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai");
export const customCommandStore = new CustomCommandStore(join(dataRoot, "desktop", "custom-commands.json"));
export const listCustomCommands = (request: unknown) => customCommandStore.list(request);
export const upsertCustomCommand = (request: unknown) => customCommandStore.upsert(request);
export const deleteCustomCommand = (request: unknown) => customCommandStore.delete(request);
