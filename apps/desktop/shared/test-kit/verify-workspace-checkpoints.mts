import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const home = await mkdtemp(join(tmpdir(), "opendrsai-checkpoint-home-"));
const workspace = join(home, "workspace");
process.env.DRSAI_HOME = home;
try {
  await exec("git", ["init", workspace]);
  await exec("git", ["-C", workspace, "config", "user.email", "desktop-test@example.invalid"]);
  await exec("git", ["-C", workspace, "config", "user.name", "Desktop Test"]);
  const file = join(workspace, "result.txt"); await writeFile(file, "base\n");
  await exec("git", ["-C", workspace, "add", "result.txt"]); await exec("git", ["-C", workspace, "commit", "-m", "base"]);
  await writeFile(file, "checkpoint version\n");
  const checkpoints = await import("../main/workspaceCheckpoints.ts");
  const checkpoint = await checkpoints.createWorkspaceCheckpoint({ workspacePath: workspace, label: "Before rewrite", kind: "manual" });
  assert.equal(checkpoint.entries.some((entry) => entry.relativePath === "result.txt" && entry.stored), true);
  await writeFile(file, "later version\n");
  const preview = await checkpoints.previewWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: checkpoint.id });
  assert.equal(preview.changedEntryCount, 1);
  const restored = await checkpoints.restoreWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: checkpoint.id, operationId: "restore-test-001", includePaths: [file] });
  assert.equal(restored.restored, true); assert.equal(await readFile(file, "utf8"), "checkpoint version\n");
  await writeFile(file, "later again\n");
  const relativeRestore = await checkpoints.restoreWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: checkpoint.id, operationId: "restore-test-002", includePaths: ["result.txt"] });
  assert.equal(relativeRestore.restored, true); assert.equal(await readFile(file, "utf8"), "checkpoint version\n");
  await assert.rejects(() => checkpoints.restoreWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: checkpoint.id, includePaths: [join(workspace, "..", "outside.txt")] }), /escapes the active workspace/);
  assert.equal((await checkpoints.listWorkspaceCheckpoints(workspace))[0]?.id, checkpoint.id);
  const baseline = await checkpoints.createWorkspaceCheckpoint({ workspacePath: workspace, label: "Agent baseline", kind: "agent_run_baseline", runId: "run-test-001" });
  assert.equal((await checkpoints.acceptWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: baseline.id })).reviewStatus, "accepted");
  await assert.rejects(() => checkpoints.restoreWorkspaceCheckpoint({ workspacePath: workspace, checkpointId: baseline.id }), /already been reviewed/);
  console.log("Workspace checkpoint create/list/preview/restore/accept and review-state verification passed.");
} finally { await rm(home, { recursive: true, force: true }); }
