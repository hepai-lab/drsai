import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_DISPLAY_NAME,
  DEFAULT_WORKSPACE_FOLDER_NAME,
  DEFAULT_WORKSPACE_VERSION,
  resolveDefaultWorkspaceDisplayName,
} from "../../shared/api/workspaceDefaults.ts";
import { ensureDefaultWorkspaceDirectory } from "../../shared/main/defaultWorkspace.ts";

assert.equal(DEFAULT_WORKSPACE_FOLDER_NAME, "OpenDrSai Workspace");
assert.equal(DEFAULT_WORKSPACE_DISPLAY_NAME, "默认");
assert.equal(DEFAULT_WORKSPACE_VERSION, 2);

assert.equal(
  resolveDefaultWorkspaceDisplayName("OpenDrSai Workspace", 1),
  "默认",
  "the app-generated legacy display name should migrate",
);
assert.equal(
  resolveDefaultWorkspaceDisplayName("我的项目", 1),
  "我的项目",
  "an existing user-supplied display name should be preserved",
);
assert.equal(
  resolveDefaultWorkspaceDisplayName("OpenDrSai Workspace", DEFAULT_WORKSPACE_VERSION),
  "OpenDrSai Workspace",
  "the current version should not repeatedly overwrite later user edits",
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "opendrsai-default-workspace-"));
try {
  const documentsPath = join(temporaryRoot, "Documents");
  const workspacePath = await ensureDefaultWorkspaceDirectory(documentsPath);
  assert.equal(
    workspacePath,
    await realpath(join(documentsPath, "OpenDrSai Workspace")),
    "changing the display name must not change the on-disk folder",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Default workspace naming verification passed.");
