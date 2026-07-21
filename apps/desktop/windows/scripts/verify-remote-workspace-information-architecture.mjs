import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const shared = read("../shared/api/desktopApi.ts");
const workspaces = read("../shared/main/workspaces.ts");
const app = read("../shared/renderer/src/App.tsx");
const chat = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");

assert(shared.includes('location: "local" | "remote"'), "Workspace location is not explicit");
assert(shared.includes('transport?: "ssh"'), "Remote transport is not explicit");
assert(workspaces.includes('location: "local"'), "Local workspace creation does not set location");
assert(workspaces.includes('location: "remote"') && workspaces.includes('transport: "ssh"'), "Remote workspace creation does not set location/transport");
assert(workspaces.includes("migrateWorkspaceLocation"), "Legacy workspace migration is missing");
assert(app.includes('"Local"') && app.includes('"Remote"'), "Add-workspace location choices are missing");
assert(app.includes('"computer" | "directory"') && app.includes("Step 1 of 2") && app.includes("Step 2 of 2"), "Remote computer/directory flow is missing");
assert(app.includes("desktopApi.pickFolder()"), "Local folder picker is missing");
assert(app.includes("workspaceLocation={effectiveWorkspace.location}"), "Runtime location is not passed independently to chat");
assert(app.includes("agents.find((agent) => agent.id === selectedChatAgentId) ?? defaultAgent"), "Workspace changes do not preserve the selected Agent definition");
assert(app.includes("setActiveWorkspaceId(workspace.id)") && app.includes("setSelectedChatAgentId"), "Agent selection and Runtime location are not modeled as independent state");
assert(chat.includes('workspaceLocation?: "local" | "remote"'), "Chat still consumes transport-shaped workspace type");
assert(shell.includes('`Remote · ${workspace.remote.hostAlias} · ${workspace.remote.canonicalPath}`'), "Remote workspace title does not show location, host and path");
assert(shell.includes('`Local · ${workspace.path}`'), "Local workspace title does not show location and path");

for (const forbidden of ["Connect Remote SSH", "Remote Gateway", ">Gateway<", "Gateway runtime:"]) {
  assert(!app.includes(forbidden), `Primary UI still exposes implementation term: ${forbidden}`);
}

console.log("Remote workspace information architecture verification passed.");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
