import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = readFileSync(resolve(root, "../shared/main/runtimeClient.ts"), "utf8");

for (const marker of [
  "interface RuntimeClient",
  "class LocalRuntimeClient",
  "class RemoteRuntimeClient",
  "getRuntime()",
  "getCapabilities()",
  "getBackendAccount(",
  "startBackendLogin(",
  "cancelBackendLogin(",
  "logoutBackend(",
  "openWorkspace(path",
  "listWorkspaces(",
  "closeWorkspace(",
  "createWorktree(",
  "adoptWorktree(",
  "listWorktrees(",
  "listWorkspaceEvents(",
  "describeWorktree(",
  "mergeWorktree(",
  "archiveWorktree(",
  "removeWorktree(",
  "listSessions(",
  "createSession(",
  "createAgentRun(",
  "executeAgentRun(",
  "cancelAgentRun(",
  "listAgentRunEvents(",
  "respondAgentApproval(",
  "createRun(",
  "executeOWOP<",
  "RuntimeOWOPError",
  "requestFiles<T>",
  "requestGit<T>",
  "ptyEndpoint()",
  "RuntimeRunStream",
  "Remote Runtime must use an SSH loopback tunnel",
]) assert(source.includes(marker), `Runtime Client contract lacks ${marker}`);

console.log("Unified Runtime Client contract verification passed.");

function assert(value, message) {
  if (!value) throw new Error(message);
}
