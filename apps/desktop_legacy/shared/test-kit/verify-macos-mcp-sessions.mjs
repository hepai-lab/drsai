import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(desktopRoot, path), "utf8");
const bridge = read("shared/main/mcpLiveBridge.ts");
const mac = macosIpcSource(desktopRoot);
const trust = read("macos/src/main/ipc/registerTrustIpc.ts");
const main = read("macos/src/main/index.ts");
const shutdownPlan = read("macos/src/main/bootstrap/shutdownPlan.ts");
const coordinators = read("macos/src/main/bootstrap/createMcpCoordinators.ts");
const approvalStore = read("shared/main/approvalStore.ts");
const windowsBridge = read("windows/src/main/mcpLiveBridge.ts");

function assert(condition, message) {
  if (!condition) throw new Error(`macOS MCP session verification failed: ${message}`);
}

for (const channel of [
  "desktop:mcp-context-import", "desktop:mcp-live-enumerate",
  "desktop:mcp-tool-execution-approval", "desktop:mcp-execution-audits",
  "desktop:mcp-session-audits", "desktop:mcp-active-sessions",
  "desktop:mcp-reusable-sessions", "desktop:mcp-reusable-session-close",
  "desktop:mcp-session-cancel",
]) assert(mac.includes(`ipcMain.handle(\"${channel}\"`), `missing protected handler ${channel}`);

for (const token of [
  "spawn(server.command", "shell: false", "MAX_MCP_STDIO_BYTES",
  "MAX_MCP_ENUMERATION_MS", "MAX_MCP_TOOL_EXECUTION_MS",
  "activeMcpRuntimeSessions", "reusableMcpSessions", "shutdownMcpSessions",
  "recordMcpSessionAudit", "assertSafeMcpContextWriteTarget",
]) assert(bridge.includes(token), `shared bridge missing ${token}`);

assert(trust.includes("assertAllowedDesktopPath(path, await roots()") && trust.includes("await assertWorkspace(request?.workspacePath)"), "workspace path authorization is missing");
assert(shutdownPlan.includes('name: "mcp-sessions"') && main.includes("shutdownMcpSessions,"), "MCP child cleanup is not part of the injected app shutdown plan");
assert(windowsBridge.trim() === 'export * from "../../../shared/main/mcpLiveBridge";', "Windows does not use the shared bridge");
assert(!coordinators.includes("executeApprovedMcpTool"), "macOS still uses the obsolete one-shot MCP executor");
assert(approvalStore.includes("alreadyExecuted: true"), "approval replay does not expose a durable completed discriminator");
assert(coordinators.includes("if (proposal.alreadyExecuted) return {") && coordinators.includes('status: "already_executed" as const'), "macOS MCP replay can reach the external executor again");
assert(coordinators.indexOf("if (proposal.alreadyExecuted) return {") < coordinators.indexOf("if (!proposal.queued && proposal.allowed && !proposal.blocked) return executeMcpToolAfterApproval"), "macOS MCP replay guard must run before the direct executor branch");

console.log("macOS MCP context, approval, session, cancellation, audit and shutdown contract passed.");
