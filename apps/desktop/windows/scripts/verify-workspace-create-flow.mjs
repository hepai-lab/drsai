import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("../shared/renderer/src/App.tsx");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const css = read("../shared/renderer/src/styles.css");

assert(app.includes('useState<"local" | "remote" | null>(null)'));
assert(app.includes('"本地" : "Local"') && app.includes('"远程" : "Remote"'));
assert(app.includes('"源文件夹" : "Source folder"'));
assert(app.includes('source: "existing"') && app.includes("path: localWorkspacePath"));
assert(app.includes("name: workspaceDraftName.trim()"));
assert(app.includes("getWorkspaceName(path) || path"));
assert(app.includes("connectRemoteWorkspace({ hostAlias: remoteHostAlias, path: remotePath.trim(), name: workspaceDraftName.trim()"));
assert(app.includes('desktopApi.listRemoteDirectories(hostAlias, path.trim())'));
assert(app.includes('className="remote-directory-list"'));
assert(shell.includes('else if (command === "newWorkspace") void onAddWorkspace()'));
assert(shell.includes("function openWorkspaceCreate(): void") && shell.includes("void onAddWorkspace();"));
assert(!shell.includes("workspaceCreateSource"));
assert(!shell.includes("空白本地项目") && !shell.includes("Empty Local Project"));
assert(!shell.includes("现有文件夹") && !shell.includes("Existing Folder"));
assert(css.includes(".remote-directory-list") && css.includes(".workspace-create-form.single-column"));

console.log("Workspace create flow verification passed (15 checks).");
