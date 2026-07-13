import { existsSync } from "fs";
import { readFile, realpath, stat } from "fs/promises";
import { basename, isAbsolute, join, normalize, relative, resolve } from "path";
import type {
  DesktopIdeContextFile,
  DesktopIdeContextSelection,
  DesktopIdeContextSnapshot,
  DesktopIdeContextSource,
} from "../shared/desktopApi";

const DEFAULT_IDE_CONTEXT_RELATIVE_PATH = join(".drsai", "ide-context.json");
const MAX_SELECTION_CHARS = 12_000;
const MAX_CONTEXT_FILE_BYTES = 240_000;

export async function getIdeContext(
  rawWorkspacePath: unknown,
): Promise<DesktopIdeContextSnapshot> {
  const workspacePath = await resolveWorkspaceRoot(rawWorkspacePath);
  const contextPath = resolveIdeContextPath(workspacePath);
  if (!contextPath) {
    return emptyIdeContext(
      workspacePath,
      "No IDE context handoff file is configured for this workspace.",
    );
  }
  if (!existsSync(contextPath)) {
    return emptyIdeContext(
      workspacePath,
      `No IDE context handoff found at ${DEFAULT_IDE_CONTEXT_RELATIVE_PATH}.`,
    );
  }

  try {
    const fileStat = await stat(contextPath);
    if (!fileStat.isFile() || fileStat.size > MAX_CONTEXT_FILE_BYTES) {
      return emptyIdeContext(
        workspacePath,
        "IDE context handoff is not a readable small JSON file.",
      );
    }
    const parsed = JSON.parse(await readFile(contextPath, "utf8")) as Record<
      string,
      unknown
    >;
    const currentFile = await normalizeIdeCurrentFile(workspacePath, parsed);
    const currentSelection = await normalizeIdeCurrentSelection(
      workspacePath,
      parsed,
      currentFile,
    );
    const source = normalizeIdeSource(parsed.source);
    const capturedAt = normalizeIsoDate(parsed.capturedAt);
    return {
      available: Boolean(currentFile || currentSelection),
      workspacePath,
      source,
      ...(capturedAt ? { capturedAt } : {}),
      ...(currentFile ? { currentFile } : {}),
      ...(currentSelection ? { currentSelection } : {}),
      message: currentFile || currentSelection
        ? "IDE current file/selection context is ready to attach."
        : "IDE context handoff did not include a usable current file or selection.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyIdeContext(workspacePath, `IDE context handoff could not be read: ${message}`);
  }
}

async function normalizeIdeCurrentFile(
  workspacePath: string,
  parsed: Record<string, unknown>,
): Promise<DesktopIdeContextFile | undefined> {
  const rawFile = getRecord(parsed.currentFile) ?? getRecord(parsed.activeFile);
  if (!rawFile) return undefined;
  const resolvedPath = await resolveWorkspaceFilePath(workspacePath, rawFile);
  if (!resolvedPath) return undefined;
  return {
    path: resolvedPath.path,
    name: basename(resolvedPath.path),
    relativePath: resolvedPath.relativePath,
    language: normalizeShortString(rawFile.language, 80),
    line: normalizePositiveInt(rawFile.line),
    column: normalizePositiveInt(rawFile.column),
  };
}

async function normalizeIdeCurrentSelection(
  workspacePath: string,
  parsed: Record<string, unknown>,
  currentFile?: DesktopIdeContextFile,
): Promise<DesktopIdeContextSelection | undefined> {
  const rawSelection =
    getRecord(parsed.currentSelection) ?? getRecord(parsed.selection);
  if (!rawSelection) return undefined;
  const rawText = typeof rawSelection.text === "string" ? rawSelection.text : "";
  const normalizedText = rawText.replace(/\u0000/g, "").trim();
  if (!normalizedText) return undefined;
  const resolvedPath =
    (await resolveWorkspaceFilePath(workspacePath, rawSelection)) ??
    (currentFile
      ? { path: currentFile.path, relativePath: currentFile.relativePath }
      : undefined);
  if (!resolvedPath) return undefined;
  const text = normalizedText.slice(0, MAX_SELECTION_CHARS);
  return {
    path: resolvedPath.path,
    name: basename(resolvedPath.path),
    relativePath: resolvedPath.relativePath,
    text,
    startLine: normalizePositiveInt(rawSelection.startLine),
    endLine: normalizePositiveInt(rawSelection.endLine),
    language: normalizeShortString(rawSelection.language, 80) ?? currentFile?.language,
    truncated: normalizedText.length > MAX_SELECTION_CHARS,
  };
}

async function resolveWorkspaceRoot(rawWorkspacePath: unknown): Promise<string> {
  if (typeof rawWorkspacePath !== "string" || /[\r\n]/.test(rawWorkspacePath)) {
    throw new Error("Workspace path is invalid.");
  }
  const workspacePath = normalize(rawWorkspacePath.trim());
  if (!workspacePath) throw new Error("Workspace path is required.");
  const workspaceStat = await stat(workspacePath);
  if (!workspaceStat.isDirectory()) {
    throw new Error("Workspace path must be a directory.");
  }
  return realpath(workspacePath);
}

function resolveIdeContextPath(workspacePath: string): string | null {
  const configured = process.env.DRSAI_IDE_CONTEXT_FILE?.trim();
  const candidate = configured
    ? isAbsolute(configured)
      ? normalize(configured)
      : resolve(workspacePath, configured)
    : join(workspacePath, DEFAULT_IDE_CONTEXT_RELATIVE_PATH);
  if (!isInsidePath(workspacePath, candidate)) return null;
  return candidate;
}

async function resolveWorkspaceFilePath(
  workspacePath: string,
  raw: Record<string, unknown>,
): Promise<{ path: string; relativePath: string } | undefined> {
  const rawPath = normalizeShortString(raw.path, 2048);
  const rawRelativePath = normalizeShortString(raw.relativePath, 2048);
  const candidate = rawPath
    ? isAbsolute(rawPath)
      ? normalize(rawPath)
      : resolve(workspacePath, rawPath)
    : rawRelativePath
      ? resolve(workspacePath, rawRelativePath)
      : undefined;
  if (!candidate || !isInsidePath(workspacePath, candidate)) return undefined;
  let finalPath = candidate;
  try {
    finalPath = await realpath(candidate);
  } catch {
    finalPath = candidate;
  }
  if (!isInsidePath(workspacePath, finalPath)) return undefined;
  return {
    path: finalPath,
    relativePath: normalizeRelativePath(relative(workspacePath, finalPath)),
  };
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeIdeSource(value: unknown): DesktopIdeContextSource {
  if (
    value === "vscode" ||
    value === "jetbrains" ||
    value === "visual_studio" ||
    value === "manual"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return Math.min(value, 1_000_000);
}

function normalizeShortString(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return undefined;
  const normalized = value.replace(/\u0000/g, "").trim();
  return normalized ? normalized.slice(0, maxChars) : undefined;
}

function emptyIdeContext(
  workspacePath: string,
  message: string,
): DesktopIdeContextSnapshot {
  return {
    available: false,
    workspacePath,
    source: "unknown",
    message,
  };
}
