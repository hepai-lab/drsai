import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-data-cleanup-"));
const workspace = await mkdtemp(join(tmpdir(), "drsai-user-workspace-"));
process.env.DRSAI_HOME = root;
const cleanup = await import("../main/dataCleanup");
let voiceCleanups = 0;
cleanup.configureDataCleanup({ cleanupVoiceTempFiles: () => { voiceCleanups += 1; return 0; } });
await mkdir(join(root, "desktop"), { recursive: true });
await writeFile(join(root, "desktop", "workspaces.json"), JSON.stringify([{ id: "ws-1", name: "User Workspace", path: workspace }]));
await writeFile(join(workspace, "result.pdf"), "user material");
await writeFile(join(root, "desktop", "threads.json"), "[]");
await writeFile(join(root, "desktop", "user-preferences.json"), "{}");

const preview = await cleanup.previewLocalDataCleanup("all_local_data");
assert.equal(preview.preservesAllWorkspaceFiles, true);
assert.equal(preview.requiresSignInAgain, true);
assert.equal(preview.preservedUserMaterials[0].path, workspace);
assert.equal(preview.applicationData.length, 6);
await assert.rejects(() => cleanup.clearLocalData({ scope: "all_local_data", confirmation: "CLEAR_SESSIONS" }), /confirmation/);

const sessions = await cleanup.clearLocalData({ scope: "sessions", confirmation: "CLEAR_SESSIONS" });
assert.equal(sessions.ok, true);
await assert.rejects(() => stat(join(root, "desktop", "threads.json")));
assert.equal(JSON.parse(await readFile(join(root, "desktop", "user-preferences.json"), "utf8")) instanceof Object, true);
assert.equal(await readFile(join(workspace, "result.pdf"), "utf8"), "user material");
assert.equal(voiceCleanups, 0);

const all = await cleanup.clearLocalData({ scope: "all_local_data", confirmation: "DELETE_LOCAL_DATA" });
assert.equal(all.requiresSignInAgain, true);
assert.equal(voiceCleanups, 1);
assert.equal(await readFile(join(workspace, "result.pdf"), "utf8"), "user material");
assert.deepEqual(all.protectedWorkspacePaths, [workspace]);
await assert.rejects(() => stat(join(root, "desktop", "workspaces.json")));
await assert.rejects(() => cleanup.previewLocalDataCleanup("everything"), /scope/);
console.log("Local data cleanup preview, confirmation, scope, workspace preservation and voice cleanup tests passed.");
