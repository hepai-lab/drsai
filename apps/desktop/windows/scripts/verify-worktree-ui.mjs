import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-worktree-ui-"));
const bundle = join(temp, "presentation.mjs");
try {
  await build({ entryPoints: [join(root, "src/renderer/src/components/worktreePresentation.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { buildWorktreeReview, getWorktreeActions, getWorktreeListMode, getWorktreeVisualState } = await import(pathToFileURL(bundle).href);
  assert(getWorktreeListMode(0, false, null) === "empty", "empty state failed");
  assert(getWorktreeListMode(0, false, "Runtime offline") === "offline", "offline state failed");
  assert(getWorktreeVisualState({ status: "creating" }) === "creating", "creating state failed");
  assert(getWorktreeVisualState({ status: "active" }) === "active", "active state failed");
  assert(getWorktreeVisualState({ status: "active", dirty: true }) === "dirty", "dirty state failed");
  assert(getWorktreeVisualState({ status: "merge_pending" }) === "conflict", "conflict state failed");
  assert(getWorktreeVisualState({ status: "merged" }) === "merged", "merged state failed");
  assert(getWorktreeVisualState({ status: "archived" }) === "archived", "archived state failed");
  assert(getWorktreeActions({ status: "active" }, true).canMerge, "linked active Worktree should merge");
  assert(!getWorktreeActions({ status: "active" }, false).canRemove, "unlinked Worktree must not bypass Thread approval flow");
  const ready = buildWorktreeReview(
    { status: "review", branch: "feature", baseCommit: "base", headCommit: "head" },
    { queueStatus: "completed", queueMessage: "tests passed" },
    { diff: "+change", truncated: false },
  );
  assert(ready.readiness.status === "ready", "clean tested Worktree should be merge-ready");
  assert(ready.commitRange === "base..head" && ready.tests.status === "completed", "Review must aggregate commits and tests");
  const blocked = buildWorktreeReview(
    { status: "merge_pending", branch: "feature", baseCommit: "base", headCommit: "head", dirty: true, lastErrorCode: "merge_conflict", lastErrorMessage: "conflict in app.ts" },
    { queueStatus: "blocked", queueMessage: "tests blocked" },
    { diff: "+change" },
  );
  assert(blocked.readiness.status === "blocked" && blocked.conflict.active, "conflict must block merge readiness");
  const shell = readFileSync(join(root, "src/renderer/src/components/WorkspaceShell.tsx"), "utf8");
  assert(shell.includes("onListWorktreeEvents"), "Worktree UI does not consume Runtime events");
  assert(shell.includes("worktreeEventCursor.current"), "Worktree UI does not maintain an incremental event cursor");
  assert(!shell.includes("git worktree list"), "Renderer must not poll Git to infer Worktree state");
  assert(shell.includes('data-testid="worktree-review-panel"'), "unified Worktree Review panel is missing");
  assert(shell.includes("onGetWorktreeDiff"), "Review panel does not use the shared local/remote workspace operation");
  console.log("Runtime Worktree UI state verification passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assert(value, message) { if (!value) throw new Error(message); }
