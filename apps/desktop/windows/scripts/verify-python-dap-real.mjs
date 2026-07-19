import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const testRequire = (id) => id === "./paths" ? { DRSAI_HOME: join(root, "out", "verification", "python-dap-state") } : require(id);
const pythonPath = join(root, "../../../venv/Scripts/python.exe");
assert.ok(existsSync(pythonPath), "Repository Python runtime was not found.");
const program = join(root, "scripts", "fixtures", "python_debug_target.py");

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

const previous = process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG;
process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG = "1";
try {
const module = loadTypeScript(join(root, "src/main/interactiveDebugger.ts"), testRequire);
  const service = new module.InteractiveDebuggerService(() => undefined, pythonPath);
  const pauseWaiters = [];
  const waitForPause = () => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Python debuggee did not pause.")), 15_000); pauseWaiters.push((session) => { clearTimeout(timer); resolve(session); }); });
  service.setPublisher((session) => { if (session.state === "paused") pauseWaiters.shift()?.(session); });
  const initialPause = waitForPause();
  let session = await service.start({ targetId: "python-local", program, cwd: join(root, "scripts", "fixtures"), stopOnEntry: true });
  session = await initialPause;
  assert.equal(session.state, "paused");
  assert.ok(session.stackFrames.length > 0);
  const steppedPause = waitForPause();
  await service.control({ sessionId: session.id, action: "next" });
  session = await steppedPause;
  const frame = session.stackFrames[0];
  const scopes = await service.scopes(session.id, frame.id);
  assert.ok(scopes.length > 0);
  const variables = await service.variables(session.id, scopes[0].variablesReference);
  assert.ok(variables.some((item) => item.name === "value"));
  const evaluation = await service.evaluate({ sessionId: session.id, frameId: frame.id, expression: "value" });
  assert.equal(evaluation.safe, true);
  assert.match(evaluation.result, /41|42/);
  const blocked = await service.evaluate({ sessionId: session.id, frameId: frame.id, expression: "value = 100" });
  assert.equal(blocked.safe, false);
  await service.control({ sessionId: session.id, action: "continue" });
  await service.control({ sessionId: session.id, action: "terminate" });
  console.log("Real Python DAP verification passed (debugpy launch, stop-on-entry, stack, scopes, variables, safe evaluation, side-effect blocking, continue, and terminate).");
} finally {
  if (previous === undefined) delete process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG;
  else process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG = previous;
}
