import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MacosAppShutdownCoordinator } from "../../macos/src/main/appShutdown.ts";

const gateway = await readFile(new URL("../main/gateway.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../../macos/src/main/index.ts", import.meta.url), "utf8");
const processes = await readFile(new URL("../../macos/src/main/platformProcesses.ts", import.meta.url), "utf8");
const terminal = await readFile(new URL("../../macos/src/main/terminal.ts", import.meta.url), "utf8");

for (const contract of ["gatewayStartPromise", "gatewayStopPromise", "checkGatewayEndpoints", "externalConflict", "Gateway exited before its health checks became ready", "terminateGatewayProcessTree", "requestRuntimeShutdown"]) {
  assert.ok(gateway.includes(contract), `Gateway lifecycle is missing ${contract}.`);
}
assert.match(gateway, /gatewayProcess\.once\("error"/, "Gateway spawn errors must be observed.");
assert.match(processes, /SIGTERM[\s\S]*SIGKILL/, "macOS process groups require graceful then forced termination.");
assert.match(terminal, /signalProcessGroup\(session\.pid, "SIGTERM"\)[\s\S]*signalProcessGroup\(session\.pid, "SIGKILL"\)/, "PTY process groups require graceful then forced termination.");
assert.match(terminal, /process\.kill\(-Math\.abs\(pid\), signal\)/, "PTY signals must target the process group.");
assert.match(terminal, /Promise\.race\(\[session\.exitPromise, delay\(TERMINATE_GRACE_MS\)\]\)/, "PTY cleanup must wait for graceful exit before forcing termination.");
assert.match(main, /before-quit[\s\S]{0,180}event\.preventDefault\(\)/, "App quit must wait for asynchronous cleanup.");
for (const cleanup of ["killAllTerminalSessions", "cleanupAllVoiceTempFiles", "cancelBundledRuntimeInstall", "stopGateway"]) {
  assert.match(main, new RegExp(`\\(\\) => (?:\\{ )?${cleanup}\\(`), `App shutdown omits ${cleanup}.`);
}

const coordinator = new MacosAppShutdownCoordinator();
let calls = 0;
const first = coordinator.run([async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); }], 100);
const second = coordinator.run([() => { calls += 100; }], 100);
assert.equal(first, second, "Concurrent quit requests must share one cleanup promise.");
await first;
assert.equal(calls, 1, "Cleanup tasks must run exactly once.");

const timeoutCoordinator = new MacosAppShutdownCoordinator();
const started = Date.now();
await timeoutCoordinator.run([() => new Promise(() => undefined)], 15);
assert.ok(Date.now() - started < 250, "A stuck helper must not block app termination forever.");

console.log("macOS Gateway/process lifecycle verification passed.");
