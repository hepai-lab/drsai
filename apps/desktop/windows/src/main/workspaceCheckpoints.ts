import { createHash } from "crypto";
import { execFile } from "child_process";
import { existsSync } from "fs";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { DRSAI_HOME } from "./paths";
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointCreateRequest,
  WorkspaceCheckpointEntry,
  WorkspaceCheckpointPreviewEntry,
  WorkspaceCheckpointPreviewRequest,
  WorkspaceCheckpointPreviewResult,
  WorkspaceCheckpointRestoreRequest,
  WorkspaceCheckpointRestoreResult,
  WorkspaceFileGitStatus,
} from "../shared/desktopApi";

const CHECKPOINT_ROOT = join(DRSAI_HOME, "desktop", "workspace-checkpoints");
const INDEX_PATH = join(DRSAI_HOME, "desktop", "workspace-checkpoints.json");
const DEFAULT_MAX_FILES = 80;
const DEFAULT_MAX_BYTES_PER_FILE = 600_000;
const DEFAULT_PREVIEW_MAX_FILES = 20;
const DEFAULT_PREVIEW_MAX_CHARS = 4000;
const MAX_CHECKPOINTS_PER_WORKSPACE = 20;

interface WorkspaceCheckpointIndex {
  version: 1;
  checkpoints: WorkspaceCheckpoint[];
}

export async function listWorkspaceCheckpoints(
  rawWorkspacePath: unknown,
): Promise<WorkspaceCheckpoint[]> {
  const workspacePath = await resolveWorkspaceRoot(rawWorkspacePath);
  const index = await readIndex();
  return index.checkpoints
    .filter((checkpoint) => checkpoint.workspacePath === workspacePath)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createWorkspaceCheckpoint(
  rawRequest: unknown,
): Promise<WorkspaceCheckpoint> {
  const request = validateCreateRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const maxFiles = clampInt(request.maxFiles, 1, 200, DEFAULT_MAX_FILES);
  const maxBytesPerFile = clampInt(
    request.maxBytesPerFile,
    8_000,
    2_000_000,
    DEFAULT_MAX_BYTES_PER_FILE,
  );
  const changedFiles = (await getGitChangedFiles(workspacePath)).slice(0, maxFiles);
  const id = `wcp-${Date.now().toString(36)}-${hashString(workspacePath).slice(0, 8)}`;
  const checkpointDir = join(CHECKPOINT_ROOT, id);
  await mkdir(checkpointDir, { recursive: true });

  const entries: WorkspaceCheckpointEntry[] = [];
  for (const [index, changedFile] of changedFiles.entries()) {
    const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, changedFile.path);
    const relativePath = normalizeRel(relative(workspacePath, target));
    if (!existsSync(target)) {
      entries.push({
        path: target,
        relativePath,
        status: changedFile.status,
        size: 0,
        stored: false,
        existed: false,
      });
      continue;
    }

    const fileStat = await stat(target);
    if (!fileStat.isFile()) {
      entries.push({
        path: target,
        relativePath,
        status: changedFile.status,
        size: 0,
        stored: false,
        existed: true,
        skippedReason: "not a regular file",
      });
      continue;
    }
    if (fileStat.size > maxBytesPerFile) {
      entries.push({
        path: target,
        relativePath,
        status: changedFile.status,
        size: fileStat.size,
        stored: false,
        existed: true,
        skippedReason: `larger than ${maxBytesPerFile} bytes`,
      });
      continue;
    }

    const fileHash = await hashFile(target);
    await copyFile(target, join(checkpointDir, snapshotFileName(index, relativePath)));
    entries.push({
      path: target,
      relativePath,
      status: changedFile.status,
      size: fileStat.size,
      fileHash,
      stored: true,
      existed: true,
    });
  }

  const checkpoint: WorkspaceCheckpoint = {
    id,
    workspacePath,
    label: normalizeLabel(request.label),
    createdAt: new Date().toISOString(),
    baseRef: await getGitHead(workspacePath),
    changedFileCount: changedFiles.length,
    storedFileCount: entries.filter((entry) => entry.stored).length,
    skippedFileCount: entries.filter((entry) => !entry.stored && entry.existed).length,
    entries,
  };
  await upsertCheckpoint(checkpoint);
  return checkpoint;
}

export async function previewWorkspaceCheckpoint(
  rawRequest: unknown,
): Promise<WorkspaceCheckpointPreviewResult> {
  const request = validatePreviewRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const checkpoint = (await listWorkspaceCheckpoints(workspacePath)).find(
    (item) => item.id === request.checkpointId,
  );
  if (!checkpoint) {
    throw new Error("Workspace checkpoint was not found for this workspace.");
  }

  const maxFiles = clampInt(request.maxFiles, 1, 80, DEFAULT_PREVIEW_MAX_FILES);
  const maxCharsPerFile = clampInt(
    request.maxCharsPerFile,
    500,
    20_000,
    DEFAULT_PREVIEW_MAX_CHARS,
  );
  const checkpointDir = join(CHECKPOINT_ROOT, checkpoint.id);
  const entries: WorkspaceCheckpointPreviewEntry[] = [];

  for (const [index, entry] of checkpoint.entries.slice(0, maxFiles).entries()) {
    entries.push(
      await previewCheckpointEntry(workspacePath, checkpointDir, index, entry, maxCharsPerFile),
    );
  }

  const changedEntryCount = entries.filter(
    (entry) => entry.change !== "unchanged" && entry.change !== "skipped",
  ).length;
  const skippedEntryCount = entries.filter((entry) => entry.change === "skipped").length;
  const truncated = checkpoint.entries.length > entries.length;
  return {
    workspacePath,
    checkpointId: checkpoint.id,
    label: checkpoint.label,
    createdAt: checkpoint.createdAt,
    totalEntries: checkpoint.entries.length,
    changedEntryCount,
    skippedEntryCount,
    truncated,
    entries,
    message: truncated
      ? `Previewed ${entries.length}/${checkpoint.entries.length} checkpoint entrie(s); ${changedEntryCount} differ from the checkpoint.`
      : `Previewed ${entries.length} checkpoint entrie(s); ${changedEntryCount} differ from the checkpoint.`,
  };
}

export async function restoreWorkspaceCheckpoint(
  rawRequest: unknown,
): Promise<WorkspaceCheckpointRestoreResult> {
  const request = validateRestoreRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const checkpoint = (await listWorkspaceCheckpoints(workspacePath)).find(
    (item) => item.id === request.checkpointId,
  );
  if (!checkpoint) {
    throw new Error("Workspace checkpoint was not found for this workspace.");
  }

  let restoredFileCount = 0;
  let removedFileCount = 0;
  let skippedFileCount = 0;
  const checkpointDir = join(CHECKPOINT_ROOT, checkpoint.id);
  for (const [index, entry] of checkpoint.entries.entries()) {
    const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, entry.relativePath);
    if (entry.stored && entry.existed) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(checkpointDir, snapshotFileName(index, entry.relativePath)), target);
      restoredFileCount += 1;
      continue;
    }
    if (!entry.existed) {
      if (existsSync(target)) {
        const targetStat = await stat(target);
        if (targetStat.isFile()) {
          await unlink(target);
          removedFileCount += 1;
          continue;
        }
      }
      skippedFileCount += 1;
      continue;
    }
    skippedFileCount += 1;
  }

  return {
    workspacePath,
    checkpointId: checkpoint.id,
    restored: true,
    restoredFileCount,
    removedFileCount,
    skippedFileCount,
    message: `Restored ${restoredFileCount} file(s), removed ${removedFileCount}, skipped ${skippedFileCount}.`,
  };
}

function validateCreateRequest(rawRequest: unknown): WorkspaceCheckpointCreateRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workspace checkpoint request is invalid.");
  }
  const request = rawRequest as WorkspaceCheckpointCreateRequest;
  if (typeof request.workspacePath !== "string") {
    throw new Error("Workspace path is required.");
  }
  return request;
}

function validateRestoreRequest(rawRequest: unknown): WorkspaceCheckpointRestoreRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workspace checkpoint restore request is invalid.");
  }
  const request = rawRequest as WorkspaceCheckpointRestoreRequest;
  if (typeof request.workspacePath !== "string") {
    throw new Error("Workspace path is required.");
  }
  if (typeof request.checkpointId !== "string" || !request.checkpointId.trim()) {
    throw new Error("Checkpoint id is required.");
  }
  return request;
}

function validatePreviewRequest(rawRequest: unknown): WorkspaceCheckpointPreviewRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workspace checkpoint preview request is invalid.");
  }
  const request = rawRequest as WorkspaceCheckpointPreviewRequest;
  if (typeof request.workspacePath !== "string") {
    throw new Error("Workspace path is required.");
  }
  if (typeof request.checkpointId !== "string" || !request.checkpointId.trim()) {
    throw new Error("Checkpoint id is required.");
  }
  return request;
}

async function previewCheckpointEntry(
  workspacePath: string,
  checkpointDir: string,
  index: number,
  entry: WorkspaceCheckpointEntry,
  maxCharsPerFile: number,
): Promise<WorkspaceCheckpointPreviewEntry> {
  const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, entry.relativePath);
  const current = await readOptionalFile(target, maxCharsPerFile);
  if (!entry.stored) {
    return {
      path: target,
      relativePath: entry.relativePath,
      checkpointStatus: entry.status,
      change: current.exists && !entry.existed ? "added" : "skipped",
      stored: false,
      existedAtCheckpoint: entry.existed,
      currentExists: current.exists,
      currentHash: current.hash,
      currentSize: current.size,
      currentSnippet: current.snippet,
      message: entry.skippedReason
        ? `Checkpoint did not store this file: ${entry.skippedReason}.`
        : "Checkpoint did not store this file.",
    };
  }

  const checkpointFile = join(checkpointDir, snapshotFileName(index, entry.relativePath));
  const snapshot = await readOptionalFile(checkpointFile, maxCharsPerFile);
  if (!snapshot.exists) {
    return {
      path: target,
      relativePath: entry.relativePath,
      checkpointStatus: entry.status,
      change: "skipped",
      stored: true,
      existedAtCheckpoint: entry.existed,
      currentExists: current.exists,
      checkpointHash: entry.fileHash,
      currentHash: current.hash,
      currentSize: current.size,
      currentSnippet: current.snippet,
      message: "Stored checkpoint content is missing from the checkpoint directory.",
    };
  }

  const change = !current.exists
    ? "deleted"
    : snapshot.hash !== current.hash
      ? "modified"
      : "unchanged";
  return {
    path: target,
    relativePath: entry.relativePath,
    checkpointStatus: entry.status,
    change,
    stored: true,
    existedAtCheckpoint: entry.existed,
    currentExists: current.exists,
    checkpointHash: snapshot.hash,
    currentHash: current.hash,
    checkpointSize: snapshot.size,
    currentSize: current.size,
    checkpointSnippet: snapshot.snippet,
    currentSnippet: current.snippet,
    message:
      change === "unchanged"
        ? "Current file matches the checkpoint snapshot."
        : change === "deleted"
          ? "Current file is missing and would be restored from the checkpoint."
          : "Current file differs from the checkpoint snapshot.",
  };
}

async function readOptionalFile(
  filePath: string,
  maxChars: number,
): Promise<{
  exists: boolean;
  size?: number;
  hash?: string;
  snippet?: string;
}> {
  if (!existsSync(filePath)) return { exists: false };
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return { exists: false };
  const content = await readFile(filePath);
  return {
    exists: true,
    size: fileStat.size,
    hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    snippet: toPreviewSnippet(content, maxChars),
  };
}

function toPreviewSnippet(content: Buffer, maxChars = DEFAULT_PREVIEW_MAX_CHARS): string {
  if (content.includes(0)) return "[binary or non-text content omitted]";
  const text = content.toString("utf8").replace(/\r\n/g, "\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

async function upsertCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
  const index = await readIndex();
  const sameWorkspace = index.checkpoints
    .filter((item) => item.workspacePath === checkpoint.workspacePath && item.id !== checkpoint.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_CHECKPOINTS_PER_WORKSPACE - 1);
  const otherWorkspaces = index.checkpoints.filter(
    (item) => item.workspacePath !== checkpoint.workspacePath,
  );
  await writeIndex({
    version: 1,
    checkpoints: [checkpoint, ...sameWorkspace, ...otherWorkspaces],
  });
}

async function readIndex(): Promise<WorkspaceCheckpointIndex> {
  try {
    const parsed = JSON.parse(await readFile(INDEX_PATH, "utf8")) as WorkspaceCheckpointIndex;
    return {
      version: 1,
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
    };
  } catch {
    return { version: 1, checkpoints: [] };
  }
}

async function writeIndex(index: WorkspaceCheckpointIndex): Promise<void> {
  await mkdir(dirname(INDEX_PATH), { recursive: true });
  await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

async function getGitChangedFiles(
  workspacePath: string,
): Promise<Array<{ path: string; status: WorkspaceFileGitStatus }>> {
  const output = await runGit(workspacePath, ["status", "--porcelain=v1"], 8000);
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3).split(" -> ").pop() ?? line.slice(3);
      return {
        path: rawPath.replace(/^"|"$/g, ""),
        status: toGitStatus(code),
      };
    });
}

function toGitStatus(code: string): WorkspaceFileGitStatus {
  if (code.includes("?")) return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("M")) return "modified";
  return "modified";
}

async function getGitHead(workspacePath: string): Promise<string | undefined> {
  try {
    return (await runGit(workspacePath, ["rev-parse", "--short", "HEAD"], 4000)).trim();
  } catch {
    return undefined;
  }
}

async function runGit(
  cwd: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr?.trim() || stdout?.trim() || error.message));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function resolveWorkspaceRoot(rawWorkspacePath: unknown): Promise<string> {
  if (typeof rawWorkspacePath !== "string" || /[\r\n]/.test(rawWorkspacePath)) {
    throw new Error("Workspace path is invalid.");
  }
  const root = await realpath(resolve(rawWorkspacePath.trim()));
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("Workspace path must be a directory.");
  return root;
}

async function resolvePossiblyMissingInsideWorkspace(
  workspacePath: string,
  rawPath: string,
): Promise<string> {
  if (!rawPath || /[\r\n]/.test(rawPath)) {
    throw new Error("Workspace file path is invalid.");
  }
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath);
  const resolved = existsSync(target) ? await realpath(target) : target;
  ensureInside(workspacePath, resolved);
  return resolved;
}

function ensureInside(workspacePath: string, target: string): void {
  const rel = relative(workspacePath, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error("Workspace path escapes the active workspace.");
}

function snapshotFileName(index: number, relativePath: string): string {
  return `${index.toString().padStart(3, "0")}-${hashString(relativePath)}-${basename(relativePath) || "file"}.bin`;
}

function normalizeLabel(label: unknown): string {
  const normalized = typeof label === "string" ? label.trim().replace(/\s+/g, " ") : "";
  return normalized.slice(0, 80) || "Manual workspace checkpoint";
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function hashFile(filePath: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
