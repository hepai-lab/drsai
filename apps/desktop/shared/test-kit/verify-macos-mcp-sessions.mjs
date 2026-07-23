import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(desktopRoot, path), "utf8");
const bridge = read("shared/main/mcpLiveBridge.ts");
const mac = read("macos/src/main/index.ts");
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

assert(mac.includes("assertAllowedDesktopPath(request?.workspacePath"), "workspace path authorization is missing");
assert(mac.includes("() => { shutdownMcpSessions(); }"), "MCP child cleanup is not part of app shutdown");
assert(windowsBridge.trim() === 'export * from "../../../shared/main/mcpLiveBridge";', "Windows does not use the shared bridge");
assert(!mac.includes("executeApprovedMcpTool"), "macOS still uses the obsolete one-shot MCP executor");
assert(approvalStore.includes("alreadyExecuted: true"), "approval replay does not expose a durable completed discriminator");
assert(mac.includes("if (proposal.alreadyExecuted) return {") && mac.includes('status: "already_executed" as const'), "macOS MCP replay can reach the external executor again");
assert(mac.indexOf("if (proposal.alreadyExecuted) return {") < mac.indexOf("if (!proposal.queued && proposal.allowed && !proposal.blocked) return executeMcpToolAfterApproval"), "macOS MCP replay guard must run before the direct executor branch");

console.log("macOS MCP context, approval, session, cancellation, audit and shutdown contract passed.");
