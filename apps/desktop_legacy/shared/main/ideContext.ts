import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { DesktopIdeContextFile, DesktopIdeContextSelection, DesktopIdeContextSnapshot, DesktopIdeContextSource } from "../api/desktopApi";

const DEFAULT_HANDOFF = join(".drsai", "ide-context.json");
const MAX_FILE_BYTES = 240_000;
const MAX_SELECTION_CHARS = 12_000;

export async function getIdeContext(rawWorkspacePath: unknown): Promise<DesktopIdeContextSnapshot> {
  const workspacePath = await workspaceRoot(rawWorkspacePath);
  const configured = process.env.DRSAI_IDE_CONTEXT_FILE?.trim();
  const candidate = configured ? (isAbsolute(configured) ? resolve(configured) : resolve(workspacePath, configured)) : resolve(workspacePath, DEFAULT_HANDOFF);
  if (!inside(workspacePath, candidate)) return empty(workspacePath, "IDE context handoff path escapes the workspace.");
  try {
    const info = await stat(candidate);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return empty(workspacePath, "IDE context handoff is not a readable small JSON file.");
    const parsed = JSON.parse(await readFile(candidate, "utf8")) as Record<string, unknown>;
    const currentFile = await currentFileFrom(workspacePath, record(parsed.currentFile) ?? record(parsed.activeFile));
    const currentSelection = await selectionFrom(workspacePath, record(parsed.currentSelection) ?? record(parsed.selection), currentFile);
    const capturedAt = isoDate(parsed.capturedAt);
    return {
      available: Boolean(currentFile || currentSelection), workspacePath, source: source(parsed.source),
      ...(capturedAt ? { capturedAt } : {}), ...(currentFile ? { currentFile } : {}), ...(currentSelection ? { currentSelection } : {}),
      message: currentFile || currentSelection ? "IDE current file/selection context is ready to attach." : "IDE context handoff did not include a usable current file or selection.",
    };
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    return empty(workspacePath, code === "ENOENT" ? `No IDE context handoff found at ${DEFAULT_HANDOFF}.` : "IDE context handoff could not be read or parsed.");
  }
}

async function workspaceRoot(raw: unknown): Promise<string> {
  if (typeof raw !== "string" || !raw.trim() || /[\r\n\0]/.test(raw)) throw new Error("Workspace path is invalid.");
  const root = await realpath(resolve(raw.trim())); const info = await stat(root);
  if (!info.isDirectory()) throw new Error("Workspace path must be a directory.");
  return root;
}
async function currentFileFrom(root: string, raw?: Record<string, unknown>): Promise<DesktopIdeContextFile | undefined> {
  if (!raw) return undefined; const resolved = await workspaceFile(root, raw); if (!resolved) return undefined;
  return { ...resolved, name: basename(resolved.path), language: short(raw.language, 80), line: positive(raw.line), column: positive(raw.column) };
}
async function selectionFrom(root: string, raw: Record<string, unknown> | undefined, file?: DesktopIdeContextFile): Promise<DesktopIdeContextSelection | undefined> {
  if (!raw || typeof raw.text !== "string") return undefined;
  const normalized = raw.text.replace(/\0/g, "").trim(); if (!normalized) return undefined;
  const resolved = await workspaceFile(root, raw) ?? (file ? { path: file.path, relativePath: file.relativePath } : undefined); if (!resolved) return undefined;
  return { ...resolved, name: basename(resolved.path), text: normalized.slice(0, MAX_SELECTION_CHARS), startLine: positive(raw.startLine), endLine: positive(raw.endLine), language: short(raw.language, 80) ?? file?.language, truncated: normalized.length > MAX_SELECTION_CHARS };
}
async function workspaceFile(root: string, raw: Record<string, unknown>): Promise<{ path: string; relativePath: string } | undefined> {
  const path = short(raw.path, 2_048) ?? short(raw.relativePath, 2_048); if (!path) return undefined;
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path); if (!inside(root, candidate)) return undefined;
  let canonical: string; try { canonical = await realpath(candidate); } catch { return undefined; }
  if (!inside(root, canonical) || !(await stat(canonical)).isFile()) return undefined;
  return { path: canonical, relativePath: relative(root, canonical).replace(/\\/g, "/") };
}
function inside(root: string, child: string): boolean { const value = relative(root, child); return Boolean(value) && !value.startsWith("..") && !isAbsolute(value); }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function short(value: unknown, max: number): string | undefined { if (typeof value !== "string" || /[\r\n\0]/.test(value)) return undefined; return value.trim().slice(0, max) || undefined; }
function positive(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 1_000_000) : undefined; }
function isoDate(value: unknown): string | undefined { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function source(value: unknown): DesktopIdeContextSource { return value === "vscode" || value === "jetbrains" || value === "visual_studio" || value === "manual" ? value : "unknown"; }
function empty(workspacePath: string, message: string): DesktopIdeContextSnapshot { return { available: false, workspacePath, source: "unknown", message }; }
