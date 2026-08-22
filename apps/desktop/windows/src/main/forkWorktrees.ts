import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { mkdir, realpath, rm } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import type {
  DesktopForkLifecycleAction,
  DesktopForkWorktreeRequest,
  DesktopForkWorktreeResult,
  DesktopWorktreeListRequest,
  DesktopWorktreeSummary,
  DesktopWorktreeEventRequest,
  DesktopWorktreeEventBatch,
  DesktopWorktreeMigrationDiagnostic,
  DesktopThreadForkMetadata,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { LocalRuntimeClient, connectRuntimeClientForWorkspace, isLocalRuntimeUnavailableError, type RuntimeClient, type RuntimeWorktree } from "./runtimeClient";

const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_INTENT_CHARS = 180;
const GIT_TIMEOUT_MS = 20_000;
const GIT_LIFECYCLE_TIMEOUT_MS = 60_000;
const FORK_WORKTREE_ROOT = join(DRSAI_HOME, "desktop", "fork-worktrees");
const FORK_BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export type ForkLifecycleExecutionResult = Pick<
  DesktopThreadForkMetadata,
  | "lifecycleStatus"
  | "lifecycleMessage"
  | "lifecycleUpdatedAt"
  | "mergedCommit"
  | "branchCleanupStatus"
  | "branchCleanupMessage"
  | "archivedBranch"
>;

export async function prepareForkWorktree(rawRequest: unknown): Promise<DesktopForkWorktreeResult> {
  const request = validateRequest(rawRequest);
  if (process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE === "1") {
    return prepareLegacyForkWorktree(request);
  }
  const client = await LocalRuntimeClient.connect();
  const source = await client.openWorkspace(resolve(request.workspacePath));
  const created = await client.createWorktree(
    source.workspace_id,
    request.intent || "subtask",
    `desktop-${randomUUID()}`,
  );
  return {
    worktreeId: created.worktree_id,
    sourceWorkspaceId: source.workspace_id,
    workspaceId: created.workspace_id,
    location: "local",
    sourceWorkspacePath: created.source_workspace_path,
    repoRoot: created.repo_root,
    worktreePath: created.worktree_path,
    branch: created.branch,
    baseRef: created.base_ref,
    sourceHasChanges: created.source_has_changes,
    sourceStatusSummary: created.source_status_summary || undefined,
  };
}

export async function listRuntimeWorktrees(request: DesktopWorktreeListRequest): Promise<DesktopWorktreeSummary[]> {
  if (!request?.workspacePath?.trim()) throw new Error("Workspace path is required to list Worktrees.");
  const { client, sourceWorkspaceId } = await runtimeForWorkspace(request.workspacePath, request.workspaceId);
  await migrateLegacyForks(request.workspacePath, client, sourceWorkspaceId);
  return (await client.listWorktrees(sourceWorkspaceId, request.includeRemoved ?? false)).map((record) => ({
    worktreeId: record.worktree_id,
    sourceWorkspaceId: record.source_workspace_id,
    workspaceId: record.workspace_id,
    repoRoot: record.repo_root,
    canonicalPath: record.canonical_path,
    branch: record.branch,
    baseCommit: record.base_commit,
    headCommit: record.head_commit,
    status: record.status,
    location: record.location,
    dirty: record.dirty,
    ahead: record.ahead,
    behind: record.behind,
    activity: record.activity ?? { sessions: 0, runs: 0, terminals: 0, total: 0 },
    lastErrorCode: record.last_error_code,
    lastErrorMessage: record.last_error_message,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }));
}

const worktreeMigrationDiagnostics = new Map<string, DesktopWorktreeMigrationDiagnostic[]>();

export function getWorktreeMigrationDiagnostics(request: DesktopWorktreeListRequest): DesktopWorktreeMigrationDiagnostic[] {
  return [...(worktreeMigrationDiagnostics.get(normalizeMigrationPath(request.workspacePath)) ?? [])];
}

async function migrateLegacyForks(workspacePath: string, client: RuntimeClient, sourceWorkspaceId: string): Promise<void> {
  const { listThreads, updateThread } = await import("./threads");
  const key = normalizeMigrationPath(workspacePath);
  const diagnostics: DesktopWorktreeMigrationDiagnostic[] = [];
  for (const thread of await listThreads()) {
    const fork = thread.fork;
    if (!fork || fork.worktreeId || fork.lifecycleStatus === "closed") continue;
    if (![fork.sourceWorkspacePath, fork.repoRoot].some((value) => normalizeMigrationPath(value) === key)) continue;
    try {
      const record = await client.adoptWorktree(sourceWorkspaceId, {
        idempotencyKey: `legacy-thread:${thread.id}`,
        canonicalPath: fork.worktreePath,
        branch: fork.branch,
        baseRef: fork.baseRef,
      });
      if (!record.workspace_id) throw new Error("Runtime adopted Worktree without an execution Workspace.");
      await updateThread({
        id: thread.id,
        fork: { ...fork, worktreeId: record.worktree_id, sourceWorkspaceId, workspaceId: record.workspace_id },
        execution: {
          sourceWorkspaceId,
          workspaceId: record.workspace_id,
          worktreeId: record.worktree_id,
          canonicalPath: record.canonical_path,
        },
      });
      diagnostics.push({
        threadId: thread.id, status: "migrated", retryable: false,
        worktreeId: record.worktree_id, workspaceId: record.workspace_id,
        message: "Legacy Fork was registered in the owning Runtime.",
      });
    } catch (error) {
      const failure = error as { code?: string; retryable?: boolean; message?: string };
      diagnostics.push({
        threadId: thread.id, status: "pending", code: failure.code,
        retryable: failure.retryable !== false,
        message: failure.message || String(error),
      });
    }
  }
  worktreeMigrationDiagnostics.set(key, diagnostics);
}

function normalizeMigrationPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export async function listRuntimeWorktreeEvents(request: DesktopWorktreeEventRequest): Promise<DesktopWorktreeEventBatch> {
  if (!request?.workspacePath?.trim()) throw new Error("Workspace path is required to list Worktree events.");
  const afterSequence = Math.max(0, request.afterSequence ?? 0);
  try {
    const { client, sourceWorkspaceId } = await runtimeForWorkspace(request.workspacePath, request.workspaceId);
    const batch = await client.listWorkspaceEvents(sourceWorkspaceId, afterSequence);
    return {
      events: batch.events.filter((event) => event.type.startsWith("worktree.")).map((event) => ({
        eventId: event.event_id,
        workspaceId: event.workspace_id,
        sequence: event.sequence,
        type: event.type,
        data: event.data,
      })),
      nextSequence: batch.nextSequence,
    };
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

async function runtimeForWorkspace(workspacePath: string, workspaceId?: string): Promise<{ client: RuntimeClient; sourceWorkspaceId: string }> {
  const resolved = await connectRuntimeClientForWorkspace(workspacePath, workspaceId);
  return { client: resolved.client, sourceWorkspaceId: resolved.workspaceId };
}

async function prepareLegacyForkWorktree(request: DesktopForkWorktreeRequest): Promise<DesktopForkWorktreeResult> {
  const sourceWorkspacePath = resolve(request.workspacePath);
  const repoRoot = await requireGitOutput(sourceWorkspacePath, ["rev-parse", "--show-toplevel"], "Workspace is not a Git repository.");
  const resolvedRepoRoot = resolve(repoRoot);
  const baseRef = await requireGitOutput(resolvedRepoRoot, ["rev-parse", "--short=12", "HEAD"], "Unable to resolve the current Git commit.");
  const status = await runGit(resolvedRepoRoot, ["status", "--porcelain=v1"]);
  const sourceHasChanges = Boolean(status.trim());
  const sourceStatusSummary = sourceHasChanges ? summarizeStatus(status) : undefined;
  const slug = slugify(request.intent || "subtask");
  const id = randomUUID().slice(0, 8);
  const repoKey = `${slugify(basename(resolvedRepoRoot) || "repo")}-${hashPath(resolvedRepoRoot)}`;
  const branch = `drsai/fork/${slug}-${id}`;
  const worktreePath = join(FORK_WORKTREE_ROOT, repoKey, `${slug}-${id}`);

  await mkdir(dirname(worktreePath), { recursive: true });
  await requireGitOutput(
    resolvedRepoRoot,
    ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
    "Unable to create an isolated Git worktree for the fork.",
  );

  return {
    location: "local",
    sourceWorkspacePath,
    repoRoot: resolvedRepoRoot,
    worktreePath,
    branch,
    baseRef,
    sourceHasChanges,
    sourceStatusSummary,
  };
}

export async function executeForkLifecycleAction(
  fork: DesktopThreadForkMetadata,
  action: DesktopForkLifecycleAction,
): Promise<ForkLifecycleExecutionResult> {
  if (fork.worktreeId && fork.sourceWorkspaceId) {
    return executeRuntimeWorktreeLifecycle(fork, action);
  }
  return action === "merge_back" ? mergeForkWorktree(fork) : cleanupForkWorktree(fork);
}

async function executeRuntimeWorktreeLifecycle(
  fork: DesktopThreadForkMetadata,
  action: DesktopForkLifecycleAction,
): Promise<ForkLifecycleExecutionResult> {
  const client = await runtimeClientForFork(fork);
  const sourceWorkspaceId = fork.sourceWorkspaceId!;
  const worktreeId = fork.worktreeId!;
  if (action === "merge_back") {
    const record = await client.mergeWorktree(sourceWorkspaceId, worktreeId, `desktop:${worktreeId}:merge`);
    return runtimeLifecycleResult(record);
  }
  let record = await client.describeWorktree(sourceWorkspaceId, worktreeId);
  const merged = record.status === "merged";
  if (!merged && record.status !== "archived") {
    record = await client.archiveWorktree(sourceWorkspaceId, worktreeId, `desktop:${worktreeId}:archive`);
  }
  const expectedStatus = merged ? "merged" : "archived";
  record = await client.removeWorktree(sourceWorkspaceId, worktreeId, expectedStatus, `desktop:${worktreeId}:remove:${expectedStatus}`);
  return {
    lifecycleStatus: "closed",
    lifecycleUpdatedAt: record.updated_at,
    lifecycleMessage: merged
      ? "Runtime removed the merged Worktree and safely deleted its merged branch."
      : "Runtime removed the Worktree and retained its unmerged branch under opendrsai/archive.",
    branchCleanupStatus: merged ? "deleted" : "archived",
    branchCleanupMessage: merged
      ? "Merged branch was deleted with git branch -d."
      : `Unmerged work is retained on ${record.branch}.`,
    ...(merged ? {} : { archivedBranch: record.branch }),
  };
}

async function runtimeClientForFork(fork: DesktopThreadForkMetadata): Promise<RuntimeClient> {
  return (await connectRuntimeClientForWorkspace(fork.sourceWorkspacePath, fork.sourceWorkspaceId)).client;
}

function runtimeLifecycleResult(record: RuntimeWorktree): ForkLifecycleExecutionResult {
  if (record.status === "merge_pending") {
    return {
      lifecycleStatus: "merge_pending",
      lifecycleUpdatedAt: record.updated_at,
      lifecycleMessage: record.last_error_message || "Runtime detected a merge conflict; review both Workspaces before retrying.",
    };
  }
  if (record.status !== "merged") {
    throw new Error(`Runtime returned unexpected Worktree merge status: ${record.status}.`);
  }
  return {
    lifecycleStatus: "merged",
    lifecycleUpdatedAt: record.updated_at,
    lifecycleMessage: "Runtime merged the Worktree branch into the Source Workspace. Cleanup remains approval-gated.",
    branchCleanupStatus: "pending",
    branchCleanupMessage: "Merged branch is retained until cleanup is approved.",
  };
}

export async function mergeForkWorktree(fork: DesktopThreadForkMetadata): Promise<ForkLifecycleExecutionResult> {
  const now = new Date().toISOString();
  const normalized = await validateForkForLifecycle(fork);
  const sourceStatus = await getGitStatusSummary(normalized.repoRoot);
  if (sourceStatus) {
    return {
      lifecycleStatus: "merge_pending",
      lifecycleUpdatedAt: now,
      lifecycleMessage: `Merge-back is waiting: source workspace has uncommitted changes. ${sourceStatus}`,
    };
  }
  const forkStatus = await getGitStatusSummary(normalized.worktreePath);
  if (forkStatus) {
    return {
      lifecycleStatus: "merge_pending",
      lifecycleUpdatedAt: now,
      lifecycleMessage: `Merge-back is waiting: fork worktree has uncommitted changes. ${forkStatus}`,
    };
  }
  await requireGitOutput(
    normalized.repoRoot,
    ["rev-parse", "--verify", normalized.branch],
    "Fork branch no longer exists.",
  );

  try {
    await runGit(
      normalized.repoRoot,
      ["merge", "--no-ff", "--no-edit", normalized.branch],
      GIT_LIFECYCLE_TIMEOUT_MS,
    );
    const mergedCommit = await requireGitOutput(
      normalized.repoRoot,
      ["rev-parse", "--short=12", "HEAD"],
      "Unable to resolve the merged commit.",
    );
    return {
      lifecycleStatus: "merged",
      lifecycleUpdatedAt: now,
      lifecycleMessage:
        "Fork branch was merged back into the source workspace. The isolated worktree is retained until discard cleanup is approved; cleanup will remove the worktree and delete the merged fork branch with git branch -d.",
      mergedCommit,
      branchCleanupStatus: "pending",
      branchCleanupMessage: "Merged fork branch is retained until discard cleanup is approved.",
    };
  } catch (error) {
    await runGit(normalized.repoRoot, ["merge", "--abort"], GIT_LIFECYCLE_TIMEOUT_MS).catch(() => undefined);
    const conflictStatus = await getGitStatusSummary(normalized.repoRoot);
    return {
      lifecycleStatus: "merge_pending",
      lifecycleUpdatedAt: now,
      lifecycleMessage: [
        `Merge-back needs manual conflict resolution: ${formatError(error)}`,
        conflictStatus ? `Source status: ${conflictStatus}` : "",
      ].filter(Boolean).join("\n"),
    };
  }
}

export async function cleanupForkWorktree(fork: DesktopThreadForkMetadata): Promise<ForkLifecycleExecutionResult> {
  const now = new Date().toISOString();
  const normalized = await validateForkForLifecycle(fork);
  await requireForkWorktreePath(normalized.worktreePath);
  try {
    await runGit(
      normalized.repoRoot,
      ["worktree", "remove", "--force", normalized.worktreePath],
      GIT_LIFECYCLE_TIMEOUT_MS,
    );
  } catch (error) {
    const message = formatError(error).toLowerCase();
    if (
      !message.includes("not a working tree") &&
      !message.includes("is not a working tree") &&
      !message.includes("no such file")
    ) {
      return {
        lifecycleStatus: "cleanup_pending",
        lifecycleUpdatedAt: now,
        lifecycleMessage: `Cleanup is waiting: ${formatError(error)}`,
      };
    }
  }
  await rm(normalized.worktreePath, { recursive: true, force: true });
  const branchCleanup = await cleanupForkBranch(normalized.repoRoot, normalized.branch, fork);
  return {
    lifecycleStatus: "closed",
    lifecycleUpdatedAt: now,
    lifecycleMessage: [
      "Fork worktree was removed from the Git worktree registry and the controlled fork directory was deleted.",
      branchCleanup.branchCleanupMessage,
    ].filter(Boolean).join(" "),
    ...branchCleanup,
  };
}

function validateRequest(rawRequest: unknown): DesktopForkWorktreeRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Fork worktree request must be an object.");
  }
  const request = rawRequest as Partial<DesktopForkWorktreeRequest>;
  if (
    typeof request.workspacePath !== "string" ||
    !request.workspacePath.trim() ||
    request.workspacePath.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(request.workspacePath)
  ) {
    throw new Error("Fork workspace path is invalid.");
  }
  if (
    request.intent !== undefined &&
    (typeof request.intent !== "string" ||
      request.intent.length > MAX_INTENT_CHARS ||
      /[\r\n]/.test(request.intent))
  ) {
    throw new Error("Fork intent is invalid.");
  }
  return {
    workspacePath: request.workspacePath.trim(),
    intent: request.intent?.trim() || undefined,
  };
}

async function requireGitOutput(cwd: string, args: string[], fallback: string): Promise<string> {
  const result = await runGit(cwd, args);
  if (!result.trim()) {
    throw new Error(fallback);
  }
  return result.trim();
}

function runGit(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile("git", args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || "").trim();
        reject(new Error(detail ? `${detail}` : "Git command failed."));
        return;
      }
      resolveOutput(String(stdout || ""));
    });
  });
}

async function cleanupForkBranch(
  repoRoot: string,
  branch: string,
  fork: DesktopThreadForkMetadata,
): Promise<Pick<DesktopThreadForkMetadata, "branchCleanupStatus" | "branchCleanupMessage" | "archivedBranch">> {
  const exists = await gitSucceeds(repoRoot, ["rev-parse", "--verify", branch]);
  if (!exists) {
    return {
      branchCleanupStatus: "retained",
      branchCleanupMessage: "Fork branch no longer exists; no branch cleanup was performed.",
    };
  }
  const merged = fork.lifecycleStatus === "merged" || Boolean(fork.mergedCommit) || await isBranchMerged(repoRoot, branch);
  if (merged) {
    try {
      await runGit(repoRoot, ["branch", "-d", branch], GIT_LIFECYCLE_TIMEOUT_MS);
      return {
        branchCleanupStatus: "deleted",
        branchCleanupMessage: "Merged fork branch was deleted with git branch -d after worktree cleanup.",
      };
    } catch (error) {
      return {
        branchCleanupStatus: "pending",
        branchCleanupMessage: `Merged fork branch cleanup is pending: ${formatError(error)}`,
      };
    }
  }
  const archivedBranch = await createArchiveBranchName(repoRoot, branch);
  try {
    await runGit(repoRoot, ["branch", "-m", branch, archivedBranch], GIT_LIFECYCLE_TIMEOUT_MS);
    return {
      branchCleanupStatus: "archived",
      branchCleanupMessage: `Unmerged fork branch was archived as ${archivedBranch}; no work was discarded.`,
      archivedBranch,
    };
  } catch (error) {
    return {
      branchCleanupStatus: "pending",
      branchCleanupMessage: `Unmerged fork branch archive is pending: ${formatError(error)}`,
    };
  }
}

async function isBranchMerged(repoRoot: string, branch: string): Promise<boolean> {
  return gitSucceeds(repoRoot, ["merge-base", "--is-ancestor", branch, "HEAD"], GIT_LIFECYCLE_TIMEOUT_MS);
}

async function gitSucceeds(repoRoot: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<boolean> {
  try {
    await runGit(repoRoot, args, timeout);
    return true;
  } catch {
    return false;
  }
}

async function createArchiveBranchName(repoRoot: string, branch: string): Promise<string> {
  const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const candidate = `drsai/archive/${branch.replace(/^drsai\//, "")}-${suffix}`.slice(0, 190);
  if (!(await gitSucceeds(repoRoot, ["rev-parse", "--verify", candidate]))) {
    return candidate;
  }
  return `drsai/archive/${slugify(branch)}-${hashPath(`${branch}:${suffix}`)}`;
}

async function validateForkForLifecycle(fork: DesktopThreadForkMetadata): Promise<{
  repoRoot: string;
  worktreePath: string;
  branch: string;
}> {
  if (!fork || typeof fork !== "object") {
    throw new Error("Fork metadata is invalid.");
  }
  if (
    typeof fork.repoRoot !== "string" ||
    !fork.repoRoot.trim() ||
    fork.repoRoot.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(fork.repoRoot)
  ) {
    throw new Error("Fork repo root is invalid.");
  }
  if (
    typeof fork.worktreePath !== "string" ||
    !fork.worktreePath.trim() ||
    fork.worktreePath.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(fork.worktreePath)
  ) {
    throw new Error("Fork worktree path is invalid.");
  }
  if (
    typeof fork.branch !== "string" ||
    !FORK_BRANCH_PATTERN.test(fork.branch) ||
    fork.branch.startsWith("-") ||
    fork.branch.includes("..") ||
    fork.branch.endsWith("/")
  ) {
    throw new Error("Fork branch is invalid.");
  }
  return {
    repoRoot: resolve(fork.repoRoot),
    worktreePath: resolve(fork.worktreePath),
    branch: fork.branch,
  };
}

async function requireForkWorktreePath(worktreePath: string): Promise<void> {
  const root = resolve(FORK_WORKTREE_ROOT);
  const target = resolve(worktreePath);
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Fork cleanup is limited to desktop-managed fork worktrees.");
  }
  try {
    const actualRoot = await realpath(root);
    const actualTarget = await realpath(target);
    const actualRelativePath = relative(actualRoot, actualTarget);
    if (actualRelativePath === "" || actualRelativePath.startsWith("..") || isAbsolute(actualRelativePath)) {
      throw new Error("Fork cleanup is limited to desktop-managed fork worktrees.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function getGitStatusSummary(cwd: string): Promise<string> {
  const status = await runGit(cwd, ["status", "--porcelain=v1"]);
  return status.trim() ? summarizeStatus(status) : "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "subtask";
}

function hashPath(path: string): string {
  return createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 8);
}

function summarizeStatus(status: string): string {
  const lines = status.split(/\r?\n/).filter(Boolean);
  const preview = lines.slice(0, 5).map((line) => line.trim()).join("; ");
  const suffix = lines.length > 5 ? `; +${lines.length - 5} more` : "";
  return `${preview}${suffix}`;
}
