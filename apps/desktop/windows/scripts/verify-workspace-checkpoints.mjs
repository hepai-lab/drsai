import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Workspace checkpoint verification failed: ${message}`);
    process.exit(1);
  }
}

const sharedApi = read("src/shared/desktopApi.ts");
const policy = read("src/shared/executionPolicy.ts");
const main = read("src/main/index.ts");
const agentRuns = read("src/main/agentRuns.ts");
const checkpoints = read("src/main/workspaceCheckpoints.ts");
const preload = read("src/preload/index.ts");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const filesPanel = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const approvalCenter = read("src/renderer/src/components/ApprovalCenterView.tsx");
const styles = read("src/renderer/src/styles.css");
const e2eSmoke = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

for (const marker of [
  "WorkspaceCheckpoint",
  "WorkspaceCheckpointEntry",
  "WorkspaceCheckpointCreateRequest",
  "WorkspaceCheckpointPreviewRequest",
  "WorkspaceCheckpointPreviewResult",
  "WorkspaceCheckpointPreviewEntry",
  "WorkspaceCheckpointRestoreRequest",
  "WorkspaceCheckpointRestoreResult",
  "WorkspaceCheckpointAcceptRequest",
  "listWorkspaceCheckpoints(workspacePath: string, workspaceId?: string)",
  "createWorkspaceCheckpoint(",
  "acceptWorkspaceCheckpoint(",
  "previewWorkspaceCheckpoint(",
  "restoreWorkspaceCheckpoint(",
]) {
  assert(sharedApi.includes(marker), `shared desktop API missing ${marker}`);
}

assert(
  policy.includes('"workspace.checkpoint"') &&
    policy.includes("READ_ONLY_ACTIONS") &&
    policy.includes('"workspace.checkpoint"'),
  "execution policy does not model workspace checkpoint creation as a workspace action",
);

for (const marker of [
  "CHECKPOINT_ROOT",
  "workspace-checkpoints.json",
  "createWorkspaceCheckpoint",
  "previewWorkspaceCheckpoint",
  "restoreWorkspaceCheckpoint",
  "acceptWorkspaceCheckpoint",
  "agent_run_baseline",
  "reviewStatus",
  "markCheckpointReviewed",
  "listWorkspaceCheckpoints",
  "previewCheckpointEntry",
  "changedEntryCount",
  "getGitChangedFiles",
  "snapshotFileName",
  "resolvePossiblyMissingInsideWorkspace",
  "ensureInside",
  "MAX_CHECKPOINTS_PER_WORKSPACE",
]) {
  assert(checkpoints.includes(marker), `checkpoint store missing ${marker}`);
}

for (const marker of [
  "pendingWorkspaceCheckpointRestores",
  "requestWorkspaceCheckpointRestore",
  '"desktop:workspace-checkpoints-list"',
  '"desktop:workspace-checkpoint-create"',
  '"desktop:workspace-checkpoint-accept"',
  '"desktop:workspace-checkpoint-preview"',
  '"desktop:workspace-checkpoint-restore"',
  'actionKind: "workspace.revert"',
  'assertExecutionAllowed("workspace.checkpoint")',
  'assertExecutionAllowed("workspace.revert"',
  "restoreWorkspaceCheckpoint(pendingWorkspaceCheckpointRestore)",
]) {
  assert(main.includes(marker), `main process checkpoint bridge missing ${marker}`);
}

for (const marker of [
  "prepareAgentChangeSetCheckpoint",
  "change_set_checkpoint_id",
  'kind: "agent_run_baseline"',
  "runId",
  "maxBytesPerFile: 2_000_000",
  "checkpoint.truncated || checkpoint.skippedFileCount > 0",
]) {
  assert(agentRuns.includes(marker), `agent run checkpoint fallback missing ${marker}`);
}

for (const marker of [
  '"desktop:workspace-checkpoints-list"',
  '"desktop:workspace-checkpoint-create"',
  '"desktop:workspace-checkpoint-accept"',
  '"desktop:workspace-checkpoint-preview"',
  '"desktop:workspace-checkpoint-restore"',
]) {
  assert(preload.includes(marker), `preload bridge missing ${marker}`);
}

for (const marker of [
  "workspaceCheckpoints",
  "listWorkspaceCheckpoints",
  "createWorkspaceCheckpoint",
  "acceptWorkspaceCheckpoint",
  "previewWorkspaceCheckpoint",
  "restoreWorkspaceCheckpoint",
  "Mock checkpoint diff preview prepared",
  'title: "Restore workspace checkpoint"',
]) {
  assert(mock.includes(marker), `mock desktop API missing ${marker}`);
}

for (const marker of [
  "WorkspaceCheckpointPanel",
  "Version history",
  "createRollbackCheckpoint",
  "previewRollbackCheckpoint",
  "restoreRollbackCheckpoint",
  "listWorkspaceCheckpoints",
  "createWorkspaceCheckpoint",
  "acceptWorkspaceCheckpoint",
  "acceptAgentChangeSet",
  "Agent changes accepted",
  "previewWorkspaceCheckpoint",
  "Difference from current version",
  "Compare with current",
  "restoreWorkspaceCheckpoint",
]) {
  assert(filesPanel.includes(marker), `Files panel checkpoint UI missing ${marker}`);
}

assert(
  approvalCenter.includes('"workspace.checkpoint"') &&
    approvalCenter.includes("Create checkpoint"),
  "Approval Center policy table does not include checkpoint creation",
);
assert(
  styles.includes(".files-checkpoint-panel") &&
    styles.includes(".files-checkpoint-list") &&
    styles.includes(".files-checkpoint-preview") &&
    styles.includes(".files-checkpoint-preview-snippets"),
  "checkpoint panel styling is missing",
);
assert(
  packageJson.includes('"verify:workspace-checkpoints"'),
  "package script is not registered",
);
assert(
  roadmap.includes("Rollback checkpoint") &&
    roadmap.includes("checkpoint diff preview") &&
    roadmap.includes("verify:workspace-checkpoints"),
  "roadmap evidence does not mention workspace checkpoints",
);
assert(
  e2eSmoke.includes("agentRunChangeSetAccepted") &&
    e2eSmoke.includes("agentRunChangeSetRejectsReviewedAccept") &&
    e2eSmoke.includes("agentRunChangeSetRejectsManualCheckpointAccept"),
  "e2e smoke does not cover accepted, already-reviewed, and manual checkpoint accept boundaries",
);

console.log("Workspace checkpoint verification passed.");
