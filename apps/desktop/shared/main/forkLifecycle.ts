import { execFile } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesktopForkLifecycleAction, DesktopThreadForkMetadata } from "../api/desktopApi";
import { DRSAI_HOME } from "./paths";
import { connectRuntimeClientForWorkspace, type RuntimeClient, type RuntimeWorktree } from "./runtimeClient";

const MAX_PATH = 2_048;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const FORK_ROOT = resolve(DRSAI_HOME, "desktop", "fork-worktrees");
const TIMEOUT = 60_000;

export type ForkLifecycleExecutionResult = Pick<DesktopThreadForkMetadata,
  "lifecycleStatus" | "lifecycleMessage" | "lifecycleUpdatedAt" | "mergedCommit" |
  "branchCleanupStatus" | "branchCleanupMessage" | "archivedBranch">;

export async function executeForkLifecycleAction(fork: DesktopThreadForkMetadata, action: DesktopForkLifecycleAction): Promise<ForkLifecycleExecutionResult> {
  if (fork.worktreeId && fork.sourceWorkspaceId) return executeRuntime(fork, action);
  return action === "merge_back" ? mergeForkWorktree(fork) : cleanupForkWorktree(fork);
}

async function executeRuntime(fork: DesktopThreadForkMetadata, action: DesktopForkLifecycleAction): Promise<ForkLifecycleExecutionResult> {
  const client = await runtimeClient(fork);
  if (action === "merge_back") return runtimeMergeResult(await client.mergeWorktree(fork.sourceWorkspaceId!, fork.worktreeId!, `desktop:${fork.worktreeId}:merge`));
  let record = await client.describeWorktree(fork.sourceWorkspaceId!, fork.worktreeId!);
  const merged = record.status === "merged";
  if (!merged && record.status !== "archived") record = await client.archiveWorktree(fork.sourceWorkspaceId!, fork.worktreeId!, `desktop:${fork.worktreeId}:archive`);
  record = await client.removeWorktree(fork.sourceWorkspaceId!, fork.worktreeId!, merged ? "merged" : "archived", `desktop:${fork.worktreeId}:remove:${merged ? "merged" : "archived"}`);
  return {
    lifecycleStatus: "closed", lifecycleUpdatedAt: record.updated_at,
    lifecycleMessage: merged ? "Runtime removed the merged Worktree and safely deleted its merged branch." : "Runtime removed the Worktree and retained its unmerged branch under opendrsai/archive.",
    branchCleanupStatus: merged ? "deleted" : "archived",
    branchCleanupMessage: merged ? "Merged branch was deleted with git branch -d." : `Unmerged work is retained on ${record.branch}.`,
    ...(merged ? {} : { archivedBranch: record.branch }),
  };
}

async function runtimeClient(fork: DesktopThreadForkMetadata): Promise<RuntimeClient> {
  return (await connectRuntimeClientForWorkspace(fork.sourceWorkspacePath, fork.sourceWorkspaceId)).client;
}
function runtimeMergeResult(record: RuntimeWorktree): ForkLifecycleExecutionResult {
  if (record.status === "merge_pending") return { lifecycleStatus: "merge_pending", lifecycleUpdatedAt: record.updated_at, lifecycleMessage: record.last_error_message || "Runtime detected a merge conflict." };
  if (record.status !== "merged") throw new Error(`Runtime returned unexpected Worktree merge status: ${record.status}.`);
  return { lifecycleStatus: "merged", lifecycleUpdatedAt: record.updated_at, lifecycleMessage: "Runtime merged the Worktree branch into the Source Workspace.", branchCleanupStatus: "pending", branchCleanupMessage: "Merged branch is retained until cleanup is approved." };
}

export async function mergeForkWorktree(fork: DesktopThreadForkMetadata): Promise<ForkLifecycleExecutionResult> {
  const now = new Date().toISOString();
  const value = validateFork(fork);
  const sourceStatus = await status(value.repoRoot);
  if (sourceStatus) return pending(now, `Merge-back is waiting: source workspace has uncommitted changes. ${sourceStatus}`);
  const forkStatus = await status(value.worktreePath);
  if (forkStatus) return pending(now, `Merge-back is waiting: fork worktree has uncommitted changes. ${forkStatus}`);
  await git(value.repoRoot, ["rev-parse", "--verify", value.branch]);
  try {
    await git(value.repoRoot, ["merge", "--no-ff", "--no-edit", value.branch]);
    const mergedCommit = (await git(value.repoRoot, ["rev-parse", "--short=12", "HEAD"])).trim();
    return { lifecycleStatus: "merged", lifecycleUpdatedAt: now, lifecycleMessage: "Fork branch was merged into the source workspace; cleanup remains approval-gated.", mergedCommit, branchCleanupStatus: "pending", branchCleanupMessage: "Merged fork branch is retained until cleanup is approved." };
  } catch (error) {
    await git(value.repoRoot, ["merge", "--abort"]).catch(() => undefined);
    return pending(now, `Merge-back needs manual conflict resolution: ${message(error)}`);
  }
}

export async function cleanupForkWorktree(fork: DesktopThreadForkMetadata): Promise<ForkLifecycleExecutionResult> {
  const now = new Date().toISOString();
  const value = validateFork(fork);
  await requireManagedPath(value.worktreePath);
  try { await git(value.repoRoot, ["worktree", "remove", "--force", value.worktreePath]); }
  catch (error) {
    if (!/not a working tree|no such file/i.test(message(error))) return { lifecycleStatus: "cleanup_pending", lifecycleUpdatedAt: now, lifecycleMessage: `Cleanup is waiting: ${message(error)}` };
  }
  await rm(value.worktreePath, { recursive: true, force: true });
  const branch = await cleanupBranch(value.repoRoot, value.branch, fork);
  return { lifecycleStatus: "closed", lifecycleUpdatedAt: now, lifecycleMessage: `Fork worktree was removed. ${branch.branchCleanupMessage}`, ...branch };
}

function validateFork(fork: DesktopThreadForkMetadata): { repoRoot: string; worktreePath: string; branch: string } {
  if (!fork || typeof fork !== "object" || typeof fork.repoRoot !== "string" || !fork.repoRoot.trim() || fork.repoRoot.length > MAX_PATH || /[\r\n]/.test(fork.repoRoot) || typeof fork.worktreePath !== "string" || !fork.worktreePath.trim() || fork.worktreePath.length > MAX_PATH || /[\r\n]/.test(fork.worktreePath) || typeof fork.branch !== "string" || !BRANCH_PATTERN.test(fork.branch) || fork.branch.startsWith("-") || fork.branch.includes("..") || fork.branch.endsWith("/")) throw new Error("Fork metadata is invalid.");
  return { repoRoot: resolve(fork.repoRoot), worktreePath: resolve(fork.worktreePath), branch: fork.branch };
}
async function requireManagedPath(path: string): Promise<void> {
  const target = resolve(path); const rel = relative(FORK_ROOT, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Fork cleanup is limited to desktop-managed fork worktrees.");
  try {
    const [root, actual] = await Promise.all([realpath(FORK_ROOT), realpath(target)]); const realRel = relative(root, actual);
    if (!realRel || realRel.startsWith("..") || isAbsolute(realRel)) throw new Error("Fork cleanup is limited to desktop-managed fork worktrees.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function cleanupBranch(repo: string, branch: string, fork: DesktopThreadForkMetadata): Promise<Pick<DesktopThreadForkMetadata, "branchCleanupStatus" | "branchCleanupMessage" | "archivedBranch">> {
  if (!(await succeeds(repo, ["rev-parse", "--verify", branch]))) return { branchCleanupStatus: "retained", branchCleanupMessage: "Fork branch no longer exists." };
  const merged = fork.lifecycleStatus === "merged" || Boolean(fork.mergedCommit) || await succeeds(repo, ["merge-base", "--is-ancestor", branch, "HEAD"]);
  if (merged) {
    try { await git(repo, ["branch", "-d", branch]); return { branchCleanupStatus: "deleted", branchCleanupMessage: "Merged fork branch was deleted with git branch -d." }; }
    catch (error) { return { branchCleanupStatus: "pending", branchCleanupMessage: `Merged branch cleanup is pending: ${message(error)}` }; }
  }
  const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const archivedBranch = `opendrsai/archive/${branch.replace(/^drsai\//, "")}-${suffix}`.slice(0, 190);
  try { await git(repo, ["branch", "-m", branch, archivedBranch]); return { branchCleanupStatus: "archived", branchCleanupMessage: `Unmerged branch was archived as ${archivedBranch}.`, archivedBranch }; }
  catch (error) { return { branchCleanupStatus: "pending", branchCleanupMessage: `Branch archive is pending: ${message(error)}` }; }
}
function pending(at: string, text: string): ForkLifecycleExecutionResult { return { lifecycleStatus: "merge_pending", lifecycleUpdatedAt: at, lifecycleMessage: text }; }
async function status(cwd: string): Promise<string> { return (await git(cwd, ["status", "--porcelain=v1"])).trim(); }
async function succeeds(cwd: string, args: string[]): Promise<boolean> { try { await git(cwd, args); return true; } catch { return false; } }
function git(cwd: string, args: string[]): Promise<string> { return new Promise((resolve, reject) => execFile("git", args, { cwd, timeout: TIMEOUT, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || stdout.trim() || error.message)) : resolve(stdout))); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
