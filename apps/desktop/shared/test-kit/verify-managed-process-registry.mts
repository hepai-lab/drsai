import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ManagedProcessRegistry, type ManagedProcessRegistration } from "../main/managedProcessRegistry.ts";

const registry = new ManagedProcessRegistry();
assert.throws(() => registry.register({ id: "bad id", kind: "gateway", owner: "test", pid: 1, stop() {} }), /id is invalid/);
assert.throws(() => registry.register({ id: "gateway:bad-owner", kind: "gateway", owner: "", pid: 1, stop() {} }), /owner is invalid/);
assert.throws(() => registry.register({ id: "gateway:bad-pid", kind: "gateway", owner: "test", pid: 0, stop() {} }), /pid is invalid/);

let gateway: ManagedProcessRegistration;
const calls: string[] = [];
gateway = registry.register({
  id: "gateway:test", kind: "gateway", owner: "desktop-runtime", pid: 101,
  stop: () => { calls.push("gateway:stop"); gateway.exited(0, "SIGTERM"); },
  forceStop: () => { calls.push("gateway:force"); }, alive: () => false,
});
gateway.transition("running");
assert.throws(() => registry.register({ id: "gateway:test", kind: "gateway", owner: "duplicate", pid: 102, stop() {} }), /already active/);
assert.deepEqual(registry.snapshots({ activeOnly: true }).map(({ id, state, owner }) => ({ id, state, owner })), [{ id: "gateway:test", state: "running", owner: "desktop-runtime" }]);
assert.equal("stop" in registry.snapshots()[0], false, "Snapshots must not expose process control callbacks.");

let pty: ManagedProcessRegistration;
pty = registry.register({ id: "pty:test", kind: "pty", owner: "web-contents:7", pid: 102, stop: () => { calls.push("pty:stop"); pty.exited(0, "SIGTERM"); }, alive: () => false });
pty.transition("running");
registry.register({ id: "update-watchdog:1.0.0", kind: "update-watchdog", owner: "signed-update", pid: 103, detached: true, stop: () => { calls.push("watchdog:stop"); } });
await registry.shutdownAll(30);
assert.deepEqual(calls, ["pty:stop", "gateway:stop"], "Managed processes must stop in dependency order and intentional detached watchdogs must survive app handoff.");
assert.deepEqual(registry.snapshots({ activeOnly: true }).map(({ kind }) => kind), ["update-watchdog"], "Only the explicit detached update watchdog may remain active after shutdown.");
assert.throws(() => registry.register({ id: "pty:late", kind: "pty", owner: "late", pid: 104, stop() {} }), /shutting down/);

const forced = new ManagedProcessRegistry();
let forceCalls = 0;
forced.register({ id: "browser-worker:hung", kind: "browser-worker", owner: "browser-task-service", pid: 201, stop: () => new Promise(() => undefined), forceStop: () => { forceCalls += 1; }, alive: () => true }).transition("running");
const started = Date.now();
await forced.shutdownAll(15);
assert.equal(forceCalls, 1, "A hung managed process must receive exactly one forced stop.");
assert.ok(Date.now() - started < 250, "A hung process must not block registry shutdown indefinitely.");
assert.deepEqual(forced.snapshots({ activeOnly: true }), [], "Forced shutdown must leave zero active non-detached processes.");
assert.equal(forced.snapshots()[0].state, "crashed");
assert.equal(forced.snapshots()[0].signal, "SIGKILL");

const roots = {
  gateway: resolve(process.cwd(), "../shared/main/gateway.ts"),
  browser: resolve(process.cwd(), "../shared/main/browser/workerClient.ts"),
  terminal: resolve(process.cwd(), "src/main/terminal.ts"),
  helper: resolve(process.cwd(), "src/main/native/nativeHelperSupervisor.ts"),
  updater: resolve(process.cwd(), "src/main/updater.ts"),
};
for (const [name, url] of Object.entries(roots)) assert.match(await readFile(url, "utf8"), /managedProcessRegistry\.register/, `${name} must register its child process.`);

console.log("Managed process owner/state, shutdown ordering, timeout force-stop, detached watchdog and zero-residual contracts passed.");
