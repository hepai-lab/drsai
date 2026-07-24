import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DesktopThreadForkMetadata } from "../api/desktopApi.ts";

const exec = promisify(execFile);
const home = await mkdtemp(join(tmpdir(), "opendrsai-worktree-home-"));
process.env.DRSAI_HOME = home;
process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE = "1";
try {
  const repo = join(home, "repo"); await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "desktop-test@example.invalid"]); await exec("git", ["-C", repo, "config", "user.name", "Desktop Test"]);
  await writeFile(join(repo, "base.txt"), "base\n"); await exec("git", ["-C", repo, "add", "base.txt"]); await exec("git", ["-C", repo, "commit", "-m", "base"]);
  const worktrees = await import("../main/worktrees.ts");
  const created = await worktrees.prepareForkWorktree({ workspacePath: repo, intent: "Review result" });
  assert.match(created.branch, /^drsai\/fork\/review-result-/); assert.equal(created.sourceHasChanges, false);
  const listed = await worktrees.listRuntimeWorktrees({ workspacePath: repo });
  const createdCanonicalPath = await realpath(created.worktreePath);
  assert.equal(listed.some((item) => resolve(item.canonicalPath) === resolve(createdCanonicalPath) && item.branch === created.branch), true);
  assert.deepEqual(await worktrees.listRuntimeWorktreeEvents({ workspacePath: repo, afterSequence: 7 }), { events: [], nextSequence: 7 });
  assert.deepEqual(worktrees.getWorktreeMigrationDiagnostics({ workspacePath: repo }), []);
  const threads = await import("../main/threads.ts");
  const legacyThread = await threads.createThread({ kind: "agent_run", title: "Legacy fork", workspacePath: created.worktreePath, fork: { ...created, createdAt: new Date().toISOString(), lifecycleStatus: "active" } });
  await worktrees.migrateLegacyForks(repo, { adoptWorktree: async () => ({ worktree_id: "runtime-wt-1", source_workspace_id: "runtime-source-1", workspace_id: "runtime-exec-1", canonical_path: created.worktreePath }) } as never, "runtime-source-1");
  const migrated = (await threads.listThreads()).find((item) => item.id === legacyThread.id);
  assert.equal(migrated?.fork?.worktreeId, "runtime-wt-1"); assert.equal(migrated?.execution?.workspaceId, "runtime-exec-1");
  assert.equal(worktrees.getWorktreeMigrationDiagnostics({ workspacePath: repo })[0]?.status, "migrated");
  await writeFile(join(created.worktreePath, "result.txt"), "isolated result\n"); await exec("git", ["-C", created.worktreePath, "add", "result.txt"]); await exec("git", ["-C", created.worktreePath, "commit", "-m", "isolated result"]);
  const fork: DesktopThreadForkMetadata = { ...created, createdAt: new Date().toISOString(), lifecycleStatus: "active" };
  const lifecycle = await import("../main/forkLifecycle.ts"); const merged = await lifecycle.executeForkLifecycleAction(fork, "merge_back");
  assert.equal(merged.lifecycleStatus, "merged");
  const closed = await lifecycle.executeForkLifecycleAction({ ...fork, ...merged }, "discard"); assert.equal(closed.lifecycleStatus, "closed");
  const mapped = worktrees.mapRuntimeWorktree({ worktree_id: "wt-1", source_workspace_id: "source-1", workspace_id: "workspace-1", repo_root: repo, canonical_path: created.worktreePath, branch: "branch", base_commit: "base", head_commit: "head", status: "ready", location: "local", dirty: false, ahead: 1, behind: 0, created_at: "2026-01-01", updated_at: "2026-01-02" } as never);
  assert.deepEqual(mapped.activity, { sessions: 0, runs: 0, terminals: 0, total: 0 }); assert.equal(mapped.ahead, 1);
  console.log("Worktree prepare/list/events mapping and approved merge/cleanup integration verification passed.");
} finally { delete process.env.OPENDRSAI_LEGACY_DESKTOP_WORKTREE; await rm(home, { recursive: true, force: true }); }
