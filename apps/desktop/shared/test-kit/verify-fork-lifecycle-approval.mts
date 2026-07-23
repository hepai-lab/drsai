import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopThreadForkMetadata } from "../api/desktopApi.ts";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "opendrsai-fork-lifecycle-"));
process.env.DRSAI_HOME = root;
try {
  const repo = join(root, "source");
  const worktree = join(root, "desktop", "fork-worktrees", "case-001");
  await mkdir(repo, { recursive: true });
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "desktop-test@example.invalid"]);
  await exec("git", ["-C", repo, "config", "user.name", "Desktop Test"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  await exec("git", ["-C", repo, "add", "base.txt"]);
  await exec("git", ["-C", repo, "commit", "-m", "base"]);
  const baseRef = (await exec("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
  await mkdir(join(root, "desktop", "fork-worktrees"), { recursive: true });
  await exec("git", ["-C", repo, "worktree", "add", "-b", "drsai/fork/test-case", worktree, "HEAD"]);
  await writeFile(join(worktree, "fork.txt"), "fork result\n");
  await exec("git", ["-C", worktree, "add", "fork.txt"]);
  await exec("git", ["-C", worktree, "commit", "-m", "fork result"]);
  const metadata: DesktopThreadForkMetadata = { sourceWorkspacePath: repo, repoRoot: repo, worktreePath: worktree, branch: "drsai/fork/test-case", baseRef, createdAt: new Date().toISOString(), sourceHasChanges: false, lifecycleStatus: "active" };
  const lifecycle = await import("../main/forkLifecycle.ts");
  const merged = await lifecycle.executeForkLifecycleAction(metadata, "merge_back");
  assert.equal(merged.lifecycleStatus, "merged");
  assert.equal((await exec("git", ["-C", repo, "show", "HEAD:fork.txt"])).stdout, "fork result\n");
  const closed = await lifecycle.executeForkLifecycleAction({ ...metadata, ...merged }, "discard");
  assert.equal(closed.lifecycleStatus, "closed");
  assert.equal(closed.branchCleanupStatus, "deleted");
  await assert.rejects(() => access(worktree));
  await assert.rejects(() => lifecycle.executeForkLifecycleAction({ ...metadata, worktreePath: repo }, "discard"), /desktop-managed/);
  console.log("Fork merge, managed cleanup, branch deletion and path-boundary verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
