import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = readFileSync(resolve(root, "../shared/main/runtimeClient.ts"), "utf8");
const chatSource = readFileSync(resolve(root, "../shared/main/chat.ts"), "utf8");

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

for (const marker of [
  "interface RuntimeExecutionAuth",
  "Authorization: `Bearer ${auth.accessToken}`",
  "\"X-OpenDrSai-Auth-Mode\": auth.authMode",
  "\"X-OpenDrSai-Principal\": auth.userId",
  "...(auth ? { user_id: auth.userId } : {})",
]) assert(source.includes(marker), `Runtime Agent execution auth bridge lacks ${marker}`);

for (const marker of [
  "auth: AuthContext",
  "function isPlatformBearerAuth",
  "auth.authMode === \"oidc\" || auth.authMode === \"sso\"",
  "accessToken: auth.accessToken",
  "userId: auth.userId",
]) assert(chatSource.includes(marker), `Runtime Agent chat auth caller lacks ${marker}`);

for (const marker of [
  "function mapCodexOaepEvent",
  "projectOaepEventForPresentation(event, target.projection, currentItem)",
  "type: \"structured\"",
  "structuredEvent",
]) assert(chatSource.includes(marker), `Runtime Agent event text bridge lacks ${marker}`);

console.log("Unified Runtime Client contract verification passed.");

function assert(value, message) {
  if (!value) throw new Error(message);
}
