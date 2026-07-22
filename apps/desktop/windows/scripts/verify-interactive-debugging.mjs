import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const stateRoot = join(root, "out", "verification", "interactive-debug-state");
rmSync(stateRoot, { recursive: true, force: true });
mkdirSync(stateRoot, { recursive: true });
const testRequire = (id) => id === "./paths" ? { DRSAI_HOME: stateRoot } : id === "./atomicFileReplace" ? { replaceFileSafely: async (source, destination) => renameSync(source, destination) } : require(id);
const implementationPath = join(root, "../shared/main/interactiveDebugger.ts");
const policyImplementationPath = join(root, "../shared/main/interactiveDebugPolicy.ts");

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

class FakeDebugger extends EventEmitter {
  attached = false;
  commands = [];
  isAttached() { return this.attached; }
  attach() { this.attached = true; }
  detach() { this.attached = false; this.emit("detach", {}, "target closed"); }
  async sendCommand(method, params) {
    this.commands.push({ method, params });
    if (method === "Debugger.setBreakpointByUrl") return { breakpointId: "cdp-breakpoint", locations: [{ lineNumber: params.lineNumber }] };
    if (method === "Runtime.getProperties") return { result: [{ name: "answer", value: { type: "number", value: 42, description: "42" } }, { name: "apiToken", value: { type: "string", value: "secret-value", description: "secret-value" } }] };
    if (method === "Debugger.evaluateOnCallFrame") return { result: { type: "number", value: 42, description: "42" } };
    return {};
  }
}

const previous = process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG;
process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG = "1";
try {
  const policyModule = loadTypeScript(policyImplementationPath, testRequire);
  const policyFile = join(stateRoot, "interactive-debug-policy.json");
  const policyStore = new policyModule.InteractiveDebugPolicyStore(policyFile, {});
  assert.deepEqual(await policyStore.initialize(), { enabled: false, source: "default", locked: false }, "Interactive debugging must fail closed on first run.");
  await assert.rejects(() => policyStore.update({ enabled: true }), /risk acknowledgement/i);
  const enabledPolicy = await policyStore.update({ enabled: true, acknowledgedRisk: true });
  assert.equal(enabledPolicy.enabled, true); assert.equal(enabledPolicy.source, "user");
  const restoredPolicy = new policyModule.InteractiveDebugPolicyStore(policyFile, {});
  assert.equal((await restoredPolicy.initialize()).enabled, true, "Explicit policy must survive restart.");
  const lockedPolicy = new policyModule.InteractiveDebugPolicyStore(policyFile, { OPENDRSAI_DISABLE_INTERACTIVE_DEBUG: "1" });
  assert.deepEqual(await lockedPolicy.initialize(), { enabled: false, source: "environment", locked: true });
  await assert.rejects(() => lockedPolicy.update({ enabled: true, acknowledgedRisk: true }), /locked by environment policy/i);

  const module = loadTypeScript(implementationPath, testRequire);
  const debuggerApi = new FakeDebugger();
  const renderer = { debugger: debuggerApi, isDestroyed: () => false };
  const service = new module.InteractiveDebuggerService(() => renderer, "C:\\Python\\python.exe");
  const targets = service.listTargets();
  assert.equal(targets.find((item) => item.id === "electron-renderer").available, true);
  assert.equal(targets.find((item) => item.id === "electron-main").available, false, "Self-pausing Main must be blocked to avoid IPC deadlock.");
  assert.equal(targets.find((item) => item.id === "electron-renderer").capabilities.supportsSetVariable, false);

  let published = 0;
  service.setPublisher(() => { published += 1; });
  let session = await service.start({ targetId: "electron-renderer", traceId: "trace-debug", workspaceId: "workspace-a" });
  assert.equal(session.state, "running");
  session = await service.setBreakpoint({ sessionId: session.id, source: { file: "C:\\repo\\src\\app.ts", line: 42, column: 3, language: "typescript" }, condition: "answer === 42", hitCondition: ">= 2", logMessage: "answer reached" });
  assert.equal(session.breakpoints[0].verified, true);
  assert.ok(debuggerApi.commands.some((item) => item.method === "Debugger.setBreakpointByUrl"));

  debuggerApi.emit("message", {}, "Debugger.paused", { reason: "exception", callFrames: [{ callFrameId: "frame-1", functionName: "run", url: "file:///C:/repo/src/app.ts", location: { lineNumber: 41, columnNumber: 2 }, scopeChain: [{ type: "local", name: "Local", object: { objectId: "scope-1" } }] }] });
  session = service.listSessions()[0];
  assert.equal(session.state, "paused");
  assert.equal(session.stackFrames[0].source.line, 42);
  const scopes = await service.scopes(session.id, "frame-1");
  assert.equal(scopes[0].name, "Local");
  const variables = await service.variables(session.id, "scope-1");
  assert.equal(variables.find((item) => item.name === "answer").value, "42");
  assert.equal(variables.find((item) => item.name === "apiToken").value, "[REDACTED]");
  assert.equal(variables.find((item) => item.name === "apiToken").variablesReference, undefined);
  const evaluation = await service.evaluate({ sessionId: session.id, frameId: "frame-1", expression: "answer" });
  assert.equal(evaluation.safe, true);
  assert.equal(evaluation.result, "42");
  assert.ok(debuggerApi.commands.find((item) => item.method === "Debugger.evaluateOnCallFrame").params.throwOnSideEffect, "CDP evaluation must forbid side effects.");
  await service.control({ sessionId: session.id, action: "next" });
  assert.ok(debuggerApi.commands.some((item) => item.method === "Debugger.stepOver"));
  await service.control({ sessionId: session.id, action: "disconnect" });
  assert.equal(service.listSessions()[0].state, "disconnected");
  assert.ok(published >= 3);

  const secondDebugger = new FakeDebugger();
  const secondService = new module.InteractiveDebuggerService(() => ({ debugger: secondDebugger, isDestroyed: () => false }), "C:\\Python\\python.exe");
  const restored = await secondService.start({ targetId: "electron-renderer", workspaceId: "workspace-a" });
  assert.equal(restored.breakpoints.length, 1, "Breakpoints must be restored within the same workspace scope.");
  const isolatedService = new module.InteractiveDebuggerService(() => ({ debugger: new FakeDebugger(), isDestroyed: () => false }), "C:\\Python\\python.exe");
  const isolated = await isolatedService.start({ targetId: "electron-renderer", workspaceId: "workspace-b" });
  assert.equal(isolated.breakpoints.length, 0, "Breakpoints must not leak into another workspace.");
  await secondService.control({ sessionId: restored.id, action: "disconnect" });
  await isolatedService.control({ sessionId: isolated.id, action: "disconnect" });

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const preload = readFileSync(join(root, "../shared/main/preload.ts"), "utf8");
  const panel = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
  const pyproject = readFileSync(join(root, "../../../cores/python/packages/drsai/pyproject.toml"), "utf8");
  for (const contract of ["interactive-debug-policy", "interactive-debug-policy-update", "interactive-debug-start", "interactive-debug-breakpoint", "interactive-debug-control", "interactive-debug-scopes", "interactive-debug-variables", "interactive-debug-evaluate"]) assert.ok(mainIndex.includes(contract), `Missing interactive debug IPC: ${contract}`);
  assert.ok(preload.includes("onInteractiveDebugEvent"));
  for (const contract of ["InteractiveDebugWorkbench", "Allow interactive debugging", "acknowledgedRisk: true", "Start debugging", "Step over", "Step in", "Step out", "Read-only evaluate", "Breakpoints", "Call stack", "Variables", "Detach"]) assert.ok(panel.includes(contract), `Missing debug workbench contract: ${contract}`);
  assert.ok(pyproject.includes('"debugpy>=1.8,<2"'));
  const serviceSource = readFileSync(implementationPath, "utf8");
  for (const contract of ["debugpy.adapter", "Content-Length", "setBreakpoints", "stackTrace", "throwOnSideEffect", "[REDACTED]", "loopback WebSocket"]) assert.ok(serviceSource.includes(contract), `Missing debug adapter contract: ${contract}`);
  console.log("Interactive debugging verification passed (durable fail-closed policy, explicit risk acknowledgement, environment lock, capabilities, CDP attach, breakpoints, pause, stack, scopes, redaction, read-only evaluation, stepping, detach, DAP contract, IPC, and UI).");
} finally {
  rmSync(stateRoot, { recursive: true, force: true });
  if (previous === undefined) delete process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG;
  else process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG = previous;
}
