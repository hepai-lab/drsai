import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { DesktopForkWorktreeRequest, DesktopForkWorktreeResult, DesktopWorktreeEventBatch, DesktopWorktreeEventRequest, DesktopWorktreeListRequest, DesktopWorktreeMigrationDiagnostic, DesktopWorktreeSummary } from "../api/desktopApi";
import { DRSAI_HOME } from "./paths";
import { connectRuntimeClientForWorkspace, isLocalRuntimeUnavailableError, LocalRuntimeClient, type RuntimeClient, type RuntimeWorktree } from "./runtimeClient";
import { listThreads, updateThread } from "./threads";

const FORK_ROOT = join(DRSAI_HOME, "desktop", "fork-worktrees");
const diagnostics = new Map<string, DesktopWorktreeMigrationDiagnostic[]>();

export async function prepareForkWorktree(raw: unknown): Promise<DesktopForkWorktreeResult> {
  const request = validatePrepare(raw);
  if (process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE === "1") return prepareLegacy(request);
  const client = await LocalRuntimeClient.connect();
  const source = await client.openWorkspace(resolve(request.workspacePath));
  const created = await client.createWorktree(source.workspace_id, request.intent || "subtask", `desktop-${randomUUID()}`);
  return { worktreeId: created.worktree_id, sourceWorkspaceId: source.workspace_id, workspaceId: created.workspace_id, location: "local", sourceWorkspacePath: created.source_workspace_path, repoRoot: created.repo_root, worktreePath: created.worktree_path, branch: created.branch, baseRef: created.base_ref, sourceHasChanges: created.source_has_changes, sourceStatusSummary: created.source_status_summary || undefined };
}

export async function listRuntimeWorktrees(request: DesktopWorktreeListRequest): Promise<DesktopWorktreeSummary[]> {
  validateList(request);
  if (process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE === "1") return listLegacy(request.workspacePath);
  const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
  await migrateLegacyForks(request.workspacePath, resolved.client, resolved.workspaceId);
  return (await resolved.client.listWorktrees(resolved.workspaceId, request.includeRemoved === true)).map(mapRuntimeWorktree);
}

export async function listRuntimeWorktreeEvents(request: DesktopWorktreeEventRequest): Promise<DesktopWorktreeEventBatch> {
  validateList(request);
  if (process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE === "1") return { events: [], nextSequence: Math.max(0, request.afterSequence ?? 0) };
  const afterSequence = Math.max(0, request.afterSequence ?? 0);
  try {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const batch = await resolved.client.listWorkspaceEvents(resolved.workspaceId, afterSequence);
    return { events: batch.events.filter((event) => event.type.startsWith("worktree.")).map((event) => ({ eventId: event.event_id, workspaceId: event.workspace_id, sequence: event.sequence, type: event.type, data: event.data })), nextSequence: batch.nextSequence };
  } catch (error) {
    if (!isLocalRuntimeUnavailableError(error)) throw error;
    return {
      events: [],
      nextSequence: afterSequence,
      degraded: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
}

export function getWorktreeMigrationDiagnostics(request: DesktopWorktreeListRequest): DesktopWorktreeMigrationDiagnostic[] { validateList(request); return [...(diagnostics.get(pathKey(request.workspacePath)) ?? [])]; }

export function mapRuntimeWorktree(record: RuntimeWorktree): DesktopWorktreeSummary {
  return { worktreeId: record.worktree_id, sourceWorkspaceId: record.source_workspace_id, workspaceId: record.workspace_id, repoRoot: record.repo_root, canonicalPath: record.canonical_path, branch: record.branch, baseCommit: record.base_commit, headCommit: record.head_commit, status: record.status, location: record.location, dirty: record.dirty, ahead: record.ahead, behind: record.behind, activity: record.activity ?? { sessions: 0, runs: 0, terminals: 0, total: 0 }, lastErrorCode: record.last_error_code, lastErrorMessage: record.last_error_message, createdAt: record.created_at, updatedAt: record.updated_at };
}

export async function migrateLegacyForks(workspacePath: string, client: RuntimeClient, sourceWorkspaceId: string): Promise<void> {
  const key = pathKey(workspacePath); const result: DesktopWorktreeMigrationDiagnostic[] = [];
  for (const thread of await listThreads()) {
    const fork = thread.fork;
    if (!fork || fork.worktreeId || fork.lifecycleStatus === "closed" || ![fork.sourceWorkspacePath, fork.repoRoot].some((value) => pathKey(value) === key)) continue;
    try {
      const record = await client.adoptWorktree(sourceWorkspaceId, { idempotencyKey: `legacy-thread:${thread.id}`, canonicalPath: fork.worktreePath, branch: fork.branch, baseRef: fork.baseRef });
      if (!record.workspace_id) throw new Error("Runtime adopted Worktree without an execution Workspace.");
      await updateThread({ id: thread.id, fork: { ...fork, worktreeId: record.worktree_id, sourceWorkspaceId, workspaceId: record.workspace_id }, execution: { sourceWorkspaceId, workspaceId: record.workspace_id, worktreeId: record.worktree_id, canonicalPath: record.canonical_path } });
      result.push({ threadId: thread.id, status: "migrated", retryable: false, worktreeId: record.worktree_id, workspaceId: record.workspace_id, message: "Legacy Fork was registered in the owning Runtime." });
    } catch (error) {
      const failure = error as { code?: string; retryable?: boolean; message?: string };
      result.push({ threadId: thread.id, status: "pending", code: failure.code, retryable: failure.retryable !== false, message: failure.message || String(error) });
    }
  }
  diagnostics.set(key, result);
}

async function prepareLegacy(request: DesktopForkWorktreeRequest): Promise<DesktopForkWorktreeResult> {
  const sourceWorkspacePath = resolve(request.workspacePath);
  const repoRoot = resolve((await git(sourceWorkspacePath, ["rev-parse", "--show-toplevel"])).trim());
  const baseRef = (await git(repoRoot, ["rev-parse", "--short=12", "HEAD"])).trim();
  const status = (await git(repoRoot, ["status", "--porcelain=v1"])).trim();
  const slug = slugify(request.intent || "subtask"); const id = randomUUID().slice(0, 8);
  const branch = `drsai/fork/${slug}-${id}`;
  const worktreePath = join(FORK_ROOT, `${slugify(basename(repoRoot))}-${hash(repoRoot).slice(0, 10)}`, `${slug}-${id}`);
  await mkdir(dirname(worktreePath), { recursive: true });
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  return { location: "local", sourceWorkspacePath, repoRoot, worktreePath, branch, baseRef, sourceHasChanges: Boolean(status), sourceStatusSummary: status || undefined };
}

async function listLegacy(workspacePath: string): Promise<DesktopWorktreeSummary[]> {
  const repoRoot = resolve((await git(resolve(workspacePath), ["rev-parse", "--show-toplevel"])).trim());
  const output = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  return output.trim().split(/\r?\n\r?\n/).flatMap((block) => {
    const fields = Object.fromEntries(block.split(/\r?\n/).map((line) => { const index = line.indexOf(" "); return index < 0 ? [line, "true"] : [line.slice(0, index), line.slice(index + 1)]; }));
    if (!fields.worktree) return [];
    const branch = String(fields.branch ?? "").replace(/^refs\/heads\//, ""); const at = new Date().toISOString();
    return [{ worktreeId: `legacy-${hash(fields.worktree).slice(0, 16)}`, sourceWorkspaceId: `legacy-${hash(repoRoot).slice(0, 16)}`, workspaceId: `legacy-${hash(fields.worktree).slice(0, 16)}`, repoRoot, canonicalPath: fields.worktree, branch, baseCommit: fields.HEAD ?? "", headCommit: fields.HEAD ?? "", status: "active" as const, location: "local" as const, dirty: false, ahead: 0, behind: 0, activity: { sessions: 0, runs: 0, terminals: 0, total: 0 }, createdAt: at, updatedAt: at }];
  });
}

function validatePrepare(raw: unknown): DesktopForkWorktreeRequest { if (!raw || typeof raw !== "object") throw new Error("Fork worktree request must be an object."); const value = raw as Partial<DesktopForkWorktreeRequest>; if (typeof value.workspacePath !== "string" || !value.workspacePath.trim() || value.workspacePath.length > 2_048 || /[\r\n]/.test(value.workspacePath) || (value.intent !== undefined && (typeof value.intent !== "string" || value.intent.length > 180 || /[\r\n]/.test(value.intent)))) throw new Error("Fork worktree request is invalid."); return { workspacePath: value.workspacePath.trim(), intent: value.intent?.trim() || undefined }; }
function validateList(request: DesktopWorktreeListRequest | DesktopWorktreeEventRequest): void { if (!request || typeof request.workspacePath !== "string" || !request.workspacePath.trim() || request.workspacePath.length > 2_048 || /[\r\n]/.test(request.workspacePath)) throw new Error("Workspace path is required to list Worktrees."); if ("afterSequence" in request && request.afterSequence !== undefined && (!Number.isSafeInteger(request.afterSequence) || request.afterSequence < 0)) throw new Error("Worktree event sequence is invalid."); }
function git(cwd: string, args: string[]): Promise<string> { return new Promise((ok, fail) => execFile("git", args, { cwd, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => error ? fail(new Error(stderr.trim() || stdout.trim() || error.message)) : ok(stdout))); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "subtask"; }
function pathKey(value: string): string { return resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase(); }
