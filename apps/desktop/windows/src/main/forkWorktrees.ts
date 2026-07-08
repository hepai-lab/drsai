import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { mkdir, realpath, rm } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import type {
  DesktopForkLifecycleAction,
  DesktopForkWorktreeRequest,
  DesktopForkWorktreeResult,
  DesktopThreadForkMetadata,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

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
  return action === "merge_back" ? mergeForkWorktree(fork) : cleanupForkWorktree(fork);
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
