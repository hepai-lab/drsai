import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_DISPLAY_NAME,
  DEFAULT_WORKSPACE_FOLDER_NAME,
  DEFAULT_WORKSPACE_VERSION,
  resolveDefaultWorkspaceDisplayName,
} from "../../shared/api/workspaceDefaults.ts";
import { ensureDefaultWorkspaceDirectory, migrateLegacyDefaultWorkspaceDirectory } from "../../shared/main/defaultWorkspace.ts";

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
  const legacyPath = join(temporaryRoot, ".drsai", "workspaces", "default");
  await mkdir(join(legacyPath, "nested"), { recursive: true });
  await writeFile(join(legacyPath, "nested", "preserved.txt"), "legacy", "utf8");
  assert.equal(await migrateLegacyDefaultWorkspaceDirectory(legacyPath, workspacePath), true);
  assert.equal(await readFile(join(workspacePath, "nested", "preserved.txt"), "utf8"), "legacy");

  const conflictingLegacyPath = join(temporaryRoot, ".drsai", "workspaces", "conflicting-default");
  await mkdir(conflictingLegacyPath, { recursive: true });
  await writeFile(join(conflictingLegacyPath, "conflict.txt"), "legacy", "utf8");
  await writeFile(join(workspacePath, "conflict.txt"), "canonical", "utf8");
  assert.equal(await migrateLegacyDefaultWorkspaceDirectory(conflictingLegacyPath, workspacePath), false);
  assert.equal(await readFile(join(workspacePath, "conflict.txt"), "utf8"), "canonical", "existing canonical files must never be overwritten");
  assert.equal(await readFile(join(conflictingLegacyPath, "conflict.txt"), "utf8"), "legacy", "conflicting legacy files must remain recoverable");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Default workspace naming verification passed.");
