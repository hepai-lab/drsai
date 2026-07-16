import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const shared = read("src/shared/desktopApi.ts");
const remote = read("src/main/remoteWorkspace.ts");
const main = read("src/main/index.ts");
const chat = read("src/main/chat.ts");
const terminal = read("src/main/terminal.ts");
const preload = read("src/preload/index.ts");
const app = read("src/renderer/src/App.tsx");
const files = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");

for (const contract of ["ChatRequest", "WorkspaceFileTreeRequest", "WorkspaceFilePreviewRequest", "WorkspaceFileWriteRequest", "WorkspaceGitDiffRequest", "WorkspaceCheckpointCreateRequest", "TerminalCreateOptions"]) {
  const block = interfaceBlock(shared, contract);
  assert(block.includes("workspaceId?: string"), `${contract} does not carry workspace_id`);
}
assert(remote.includes("connections.has(workspacePathOrId)"), "Runtime access does not prefer authoritative workspace_id");
assert(remote.includes("if (matches.length !== 1) return null"), "Ambiguous same-path Runtime access does not fail closed");
assert(remote.includes("getRemoteGatewayAccess(request.workspacePath, request.workspaceId)"), "Remote resource calls do not route by workspace_id");
assert(main.includes("writeRemoteWorkspaceFile(request)"), "Remote file writes are not routed to the Runtime");
assert(chat.includes("getRemoteGatewayAccess(request.workspacePath, request.workspaceId)"), "Chat routing omits workspace_id");
assert(terminal.includes("getRemoteGatewayAccess(cwd, options.workspaceId)"), "PTY creation omits workspace_id");
assert(terminal.includes("getRemoteGatewayAccess(session.cwd, session.workspaceId)"), "PTY reconnect omits workspace_id");
assert(preload.includes('ipcRenderer.invoke("desktop:workspace-context-overview", workspacePath, workspaceId)'), "Preload drops workspace_id for context overview");
assert(preload.includes('ipcRenderer.invoke("desktop:workspace-checkpoints-list", workspacePath, workspaceId)'), "Preload drops workspace_id for checkpoints");
assert(app.includes("workspaceId: effectiveWorkspace.id"), "Renderer does not bind the effective Workspace identity");
assert(files.includes("workspaceId: string") && files.includes("workspaceId,"), "Files panel is not bound to a Workspace identity");
assert(count(files, "workspaceId,") >= 10, "Files/Git/Checkpoint calls do not consistently forward workspace_id");
assert(adapter.includes("workspaceId,") && adapter.includes("workspacePath,"), "Chat adapter does not forward workspace_id with the path");

console.log("Authoritative workspace_id product routing verification passed.");

function read(relative) { return readFileSync(join(root, relative), "utf8"); }
function count(value, needle) { return value.split(needle).length - 1; }
function assert(value, message) { if (!value) throw new Error(message); }
function interfaceBlock(source, name) {
  const start = source.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`${name} is missing`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end + 2);
}
