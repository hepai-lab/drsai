import assert from "node:assert/strict";
import { runMacosAppReadyPlan } from "../../macos/src/main/bootstrap/appReadyPlan.ts";
import { createMacosShutdownPlan, type MacosShutdownDependencies } from "../../macos/src/main/bootstrap/shutdownPlan.ts";

const startupCalls: string[] = [];
const failures: string[] = [];
const startup = await runMacosAppReadyPlan([
  { name: "first", critical: false, run: () => { startupCalls.push("first"); } },
  { name: "optional", critical: false, run: () => { startupCalls.push("optional"); throw new Error("offline"); } },
  { name: "last", critical: true, run: async () => { startupCalls.push("last"); } },
], (failure) => { failures.push(`${failure.name}:${failure.critical}`); });
assert.deepEqual(startupCalls, ["first", "optional", "last"], "Optional startup failures must not prevent later initialization.");
assert.deepEqual(startup.completed, ["first", "last"], "Only successful startup steps may be reported completed.");
assert.deepEqual(startup.degraded.map(({ name }) => name), ["optional"], "Optional startup failures must be reported as degraded.");
assert.deepEqual(failures, ["optional:false"], "Startup failures must be observable.");

const criticalCalls: string[] = [];
await assert.rejects(() => runMacosAppReadyPlan([
  { name: "critical", critical: true, run: () => { criticalCalls.push("critical"); throw new Error("corrupt state"); } },
  { name: "unreachable", critical: false, run: () => { criticalCalls.push("unreachable"); } },
]), /corrupt state/);
assert.deepEqual(criticalCalls, ["critical"], "Critical startup failures must stop later initialization.");

const shutdownCalls: string[] = [];
const dependency = (name: string) => () => { shutdownCalls.push(name); };
const dependencies: MacosShutdownDependencies = {
  stopScheduledTaskWorker: dependency("scheduled-task-worker"), killTerminalSessions: dependency("terminal-sessions"),
  cleanupVoiceFiles: dependency("voice-files"), cancelRuntimeInstall: dependency("runtime-install"),
  shutdownApprovalStore: dependency("approval-store"), shutdownInteractiveDebugger: dependency("interactive-debugger"),
  shutdownBrowserTasks: dependency("browser-tasks"), shutdownMcpSessions: dependency("mcp-sessions"),
  shutdownNativeHelper: dependency("native-helper"),
  shutdownPortForwards: dependency("port-forwards"), shutdownSshHosts: dependency("ssh-hosts"),
  shutdownRemoteGatewayInstaller: dependency("remote-gateway-installer"), shutdownRemoteWorkspaces: dependency("remote-workspaces"),
  closeMobilePairingControllers: dependency("mobile-pairing"), shutdownAgentJournal: dependency("agent-journal"),
  shutdownChatJournal: dependency("chat-journal"), stopGateway: dependency("gateway"),
  shutdownManagedProcesses: dependency("managed-process-registry"),
};
const shutdown = createMacosShutdownPlan(dependencies);
assert.equal(new Set(shutdown.map(({ name }) => name)).size, shutdown.length, "Shutdown resource names must be unique.");
for (const step of shutdown) await step.run();
assert.deepEqual(shutdownCalls, shutdown.map(({ name }) => name), "Shutdown dependencies must run in the declared reverse-resource order.");

console.log("macOS ordered startup degradation and named shutdown plan verification passed.");
