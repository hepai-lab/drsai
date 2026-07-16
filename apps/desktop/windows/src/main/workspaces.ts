import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, realpath, stat, writeFile } from "fs/promises";
import { dirname, join, normalize } from "path";
import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  WorkspaceGitStatus,
  WorkspaceInstructionSummary,
  WorkspaceProject,
  RemoteSshWorkspaceDescriptor,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { backupLegacyWorkspaceDataOnce, migrateLegacyWorkspaceRecords, migrateWorkspaceToAuthoritativeId, recordWorkspaceIdMigration } from "./workspaceMigrations";
import { LocalRuntimeClient } from "./runtimeClient";

const WORKSPACES_FILE = join(DRSAI_HOME, "desktop", "workspaces.json");
const WORKSPACES_LEGACY_BACKUP_FILE = join(DRSAI_HOME, "desktop", "workspaces.legacy-v1.backup.json");
const WORKSPACE_ID_MIGRATIONS_FILE = join(DRSAI_HOME, "desktop", "workspace-id-migrations.json");
const MAX_WORKSPACES = 100;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 240;
const MAX_PATH_CHARS = 2048;
const MAX_INSTRUCTION_CHARS = 8000;
const MAX_REPO_URL_CHARS = 2048;
const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const FOLDER_NAME_PATTERN = /^[^<>:"/\\|?*\u0000-\u001f]+$/;

export async function listWorkspaces(): Promise<WorkspaceProject[]> {
  const workspaces = await readWorkspaces();
  const refreshed = await Promise.all(workspaces.map(refreshWorkspaceStatus));
  await writeWorkspaces(refreshed);
  return sortWorkspaces(refreshed);
}

export async function createWorkspace(rawRequest: unknown): Promise<WorkspaceProject> {
  const request = await validateCreateWorkspaceRequest(rawRequest);
  const now = new Date().toISOString();
  const workspacePath = await prepareWorkspacePath(request);
  const runtimeWorkspace = await (await LocalRuntimeClient.connect()).openWorkspace(workspacePath);
  const existing = (await readWorkspaces()).filter((workspace) => !samePath(workspace.path, workspacePath));
  const workspace: WorkspaceProject = await refreshWorkspaceStatus({
    id: runtimeWorkspace.workspace_id,
    name: request.name || getWorkspaceName(workspacePath),
    path: runtimeWorkspace.path,
    location: "local",
    type: "local",
    description: request.description,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    trusted: request.trusted ?? false,
    pinned: request.pinned,
    metadata: request.metadata,
  });
  await writeWorkspaces([workspace, ...existing].slice(0, MAX_WORKSPACES));
  return workspace;
}

export async function updateWorkspace(rawRequest: unknown): Promise<WorkspaceProject> {
  const request = validateUpdateWorkspaceRequest(rawRequest);
  const workspaces = await readWorkspaces();
  const existing = workspaces.find((workspace) => workspace.id === request.id);
  if (!existing) {
    throw new Error("Workspace not found.");
  }
  const now = new Date().toISOString();
  const next = await refreshWorkspaceStatus({
    ...existing,
    name: request.name ?? existing.name,
    description: request.description ?? existing.description,
    trusted: request.trusted ?? existing.trusted,
    pinned: request.pinned ?? existing.pinned,
    lastOpenedAt: request.lastOpenedAt ?? existing.lastOpenedAt,
    metadata: request.metadata ?? existing.metadata,
    updatedAt: now,
  });
  await writeWorkspaces([next, ...workspaces.filter((workspace) => workspace.id !== request.id)]);
  return next;
}

export async function deleteWorkspace(rawId: unknown): Promise<boolean> {
  if (typeof rawId !== "string" || !WORKSPACE_ID_PATTERN.test(rawId) || /[\r\n]/.test(rawId)) {
    throw new Error("Workspace id is invalid.");
  }
  const workspaces = await readWorkspaces();
  const existing = workspaces.find((workspace) => workspace.id === rawId);
  if (existing?.location !== "remote") {
    await (await LocalRuntimeClient.connect()).closeWorkspace(rawId);
  }
  const next = workspaces.filter((workspace) => workspace.id !== rawId);
  await writeWorkspaces(next);
  return next.length !== workspaces.length;
}

export async function findWorkspaceById(id: string): Promise<WorkspaceProject | undefined> {
  return (await readWorkspaces()).find((workspace) => workspace.id === id);
}

export async function createRemoteWorkspace(request: {
  id: string;
  name?: string;
  path: string;
  trusted?: boolean;
  remote: RemoteSshWorkspaceDescriptor;
}): Promise<WorkspaceProject> {
  const now = new Date().toISOString();
  const workspaces = await readWorkspaces();
  const previous = workspaces.find((item) => item.id === request.id || (
    item.location === "remote" &&
    item.remote?.hostAlias === request.remote.hostAlias &&
    item.remote.canonicalPath === request.remote.canonicalPath
  ));
  let workspace: WorkspaceProject = {
    id: request.id,
    name: request.name?.trim().slice(0, MAX_NAME_CHARS) || getWorkspaceName(request.path),
    path: request.path,
    location: "remote",
    transport: "ssh",
    type: "remote-ssh",
    remote: request.remote,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    lastOpenedAt: now,
    trusted: request.trusted ?? false,
  };
  workspace = migrateWorkspaceToAuthoritativeId(previous, workspace);
  if (previous && previous.id !== request.id) {
    await recordWorkspaceIdMigration(WORKSPACE_ID_MIGRATIONS_FILE, {
      legacyId: previous.id,
      workspaceId: request.id,
      hostAlias: request.remote.hostAlias,
      canonicalPath: request.remote.canonicalPath,
      migratedAt: now,
    });
  }
  await writeWorkspaces([workspace, ...workspaces.filter((item) => item.id !== request.id && item !== previous)].slice(0, MAX_WORKSPACES));
  return workspace;
}

async function readWorkspaces(): Promise<WorkspaceProject[]> {
  try {
    const raw = await readFile(WORKSPACES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const migration = migrateLegacyWorkspaceRecords(parsed);
    if (migration.changed) await backupLegacyWorkspaceDataOnce(WORKSPACES_LEGACY_BACKUP_FILE, raw);
    return migration.records.filter(isWorkspace).slice(0, MAX_WORKSPACES);
  } catch {
    return [];
  }
}

async function writeWorkspaces(workspaces: WorkspaceProject[]): Promise<void> {
  await mkdir(dirname(WORKSPACES_FILE), { recursive: true });
  const persisted = sortWorkspaces(workspaces).map((workspace) => workspace.remote ? {
    ...workspace,
    remote: {
      hostAlias: workspace.remote.hostAlias,
      canonicalPath: workspace.remote.canonicalPath,
      workspaceId: workspace.remote.workspaceId,
      runtimeId: workspace.remote.runtimeId,
      instanceId: workspace.remote.instanceId,
      connectionState: "disconnected" as const,
      gatewayVersion: workspace.remote.gatewayVersion,
    },
  } : workspace);
  await writeFile(WORKSPACES_FILE, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

async function validateCreateWorkspaceRequest(rawRequest: unknown): Promise<CreateWorkspaceRequest> {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workspace request must be an object.");
  }
  const request = rawRequest as Partial<CreateWorkspaceRequest>;
  const source = request.source ?? "existing";
  if (source !== "existing" && source !== "empty" && source !== "git") {
    throw new Error("Workspace source is invalid.");
  }
  const name = sanitizeName(request.name);
  return {
    source,
    path: request.path === undefined ? undefined : await sanitizeWorkspacePath(request.path),
    parentPath: request.parentPath === undefined ? undefined : await sanitizeWorkspacePath(request.parentPath),
    repoUrl: request.repoUrl === undefined ? undefined : sanitizeRepoUrl(request.repoUrl),
    name,
    description: sanitizeDescription(request.description),
    trusted: typeof request.trusted === "boolean" ? request.trusted : undefined,
    pinned: typeof request.pinned === "boolean" ? request.pinned : undefined,
    metadata: sanitizeMetadata(request.metadata),
  };
}

async function prepareWorkspacePath(request: CreateWorkspaceRequest): Promise<string> {
  const source = request.source ?? "existing";
  if (source === "existing") {
    if (!request.path) throw new Error("Workspace path is required.");
    return request.path;
  }

  const parentPath = request.parentPath;
  const folderName = sanitizeFolderName(request.name);
  if (!parentPath) {
    throw new Error("Workspace parent folder is required.");
  }
  const targetPath = join(parentPath, folderName);
  if (existsSync(targetPath)) {
    throw new Error("Workspace folder already exists.");
  }

  if (source === "empty") {
    await mkdir(targetPath, { recursive: false });
    return realpath(targetPath);
  }

  if (!request.repoUrl) {
    throw new Error("Git repository URL is required.");
  }
  await runGitOrThrow(parentPath, ["clone", request.repoUrl, folderName], 120_000);
  return realpath(targetPath);
}

function validateUpdateWorkspaceRequest(rawRequest: unknown): UpdateWorkspaceRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workspace update must be an object.");
  }
  const request = rawRequest as Partial<UpdateWorkspaceRequest>;
  if (typeof request.id !== "string" || !WORKSPACE_ID_PATTERN.test(request.id) || /[\r\n]/.test(request.id)) {
    throw new Error("Workspace id is invalid.");
  }
  return {
    id: request.id,
    name: request.name === undefined ? undefined : sanitizeName(request.name),
    description: request.description === undefined ? undefined : sanitizeDescription(request.description),
    trusted: typeof request.trusted === "boolean" ? request.trusted : undefined,
    pinned: typeof request.pinned === "boolean" ? request.pinned : undefined,
    lastOpenedAt: sanitizeIsoDate(request.lastOpenedAt),
    metadata: request.metadata === undefined ? undefined : sanitizeMetadata(request.metadata),
  };
}

async function sanitizeWorkspacePath(value: unknown): Promise<string> {
  if (typeof value !== "string" || /[\r\n]/.test(value) || value.trim().length === 0) {
    throw new Error("Workspace path is invalid.");
  }
  if (value.length > MAX_PATH_CHARS) {
    throw new Error("Workspace path is too long.");
  }
  const normalized = normalize(value.trim());
  const stats = await stat(normalized);
  if (!stats.isDirectory()) {
    throw new Error("Workspace path must be a directory.");
  }
  return realpath(normalized);
}

function sanitizeName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    throw new Error("Workspace name is invalid.");
  }
  return value.trim().slice(0, MAX_NAME_CHARS) || undefined;
}

function sanitizeFolderName(value: unknown): string {
  const name = sanitizeName(value);
  if (!name || !FOLDER_NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error("Workspace folder name is invalid.");
  }
  return name;
}

function sanitizeRepoUrl(value: unknown): string {
  if (typeof value !== "string" || /[\r\n]/.test(value) || value.trim().length === 0) {
    throw new Error("Git repository URL is invalid.");
  }
  const url = value.trim();
  if (url.length > MAX_REPO_URL_CHARS) {
    throw new Error("Git repository URL is too long.");
  }
  const allowed =
    /^https:\/\/[^\s]+$/i.test(url) ||
    /^git@[a-zA-Z0-9_.-]+:[^\s]+$/.test(url) ||
    /^ssh:\/\/[^\s]+$/i.test(url);
  if (!allowed) {
    throw new Error("Git repository URL must be https, ssh, or git@host:path.");
  }
  return url;
}

function sanitizeDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    throw new Error("Workspace description is invalid.");
  }
  return value.trim().slice(0, MAX_DESCRIPTION_CHARS) || undefined;
}

function sanitizeIsoDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Workspace date is invalid.");
  }
  return new Date(value).toISOString();
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace metadata is invalid.");
  }
  return value as Record<string, unknown>;
}

async function refreshWorkspaceStatus(workspace: WorkspaceProject): Promise<WorkspaceProject> {
  if (workspace.location === "remote") return workspace;
  const git = await getGitStatus(workspace.path);
  const instructions = await readWorkspaceInstructions(workspace.path);
  return {
    ...workspace,
    git,
    hasAgentInstructions: instructions.length > 0,
    instructions,
  };
}

async function readWorkspaceInstructions(workspacePath: string): Promise<WorkspaceInstructionSummary[]> {
  const summaries: WorkspaceInstructionSummary[] = [];
  for (const name of ["AGENTS.md", "DRSAI.md"] as const) {
    const filePath = join(workspacePath, name);
    if (!existsSync(filePath)) continue;
    try {
      const raw = await readFile(filePath, "utf8");
      const normalized = raw.replace(/\u0000/g, "").trim();
      summaries.push({
        name,
        path: filePath,
        content: normalized.slice(0, MAX_INSTRUCTION_CHARS),
        truncated: normalized.length > MAX_INSTRUCTION_CHARS,
      });
    } catch {
      // Ignore unreadable project instruction files; status refresh should remain best effort.
    }
  }
  return summaries;
}

async function getGitStatus(workspacePath: string): Promise<WorkspaceGitStatus | undefined> {
  const repoRoot = await runGit(workspacePath, ["rev-parse", "--show-toplevel"]);
  if (!repoRoot) return undefined;
  const branch = await runGit(workspacePath, ["branch", "--show-current"]);
  const status = await runGit(workspacePath, ["status", "--porcelain"]);
  return {
    repoRoot,
    branch: branch || undefined,
    hasChanges: Boolean(status),
  };
}

function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

function runGitOrThrow(cwd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function isWorkspace(value: unknown): value is WorkspaceProject {
  const workspace = value as WorkspaceProject;
  return Boolean(
    workspace &&
      typeof workspace.id === "string" &&
      WORKSPACE_ID_PATTERN.test(workspace.id) &&
      (workspace.location === "local" || workspace.location === "remote") &&
      (workspace.location !== "remote" || workspace.transport === "ssh") &&
      typeof workspace.name === "string" &&
      typeof workspace.path === "string" &&
      typeof workspace.createdAt === "string" &&
      typeof workspace.updatedAt === "string" &&
      typeof workspace.lastOpenedAt === "string" &&
      typeof workspace.trusted === "boolean" &&
      (workspace.location !== "remote" || Boolean(workspace.remote?.hostAlias && workspace.remote?.canonicalPath)),
  );
}


function sortWorkspaces(workspaces: WorkspaceProject[]): WorkspaceProject[] {
  return [...workspaces].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
  });
}

function samePath(left: string, right: string): boolean {
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function getWorkspaceName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "Workspace";
}
