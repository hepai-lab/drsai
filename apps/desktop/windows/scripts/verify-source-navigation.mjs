import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-source-navigation-"));
const appRoot = join(tempRoot, "app");
const workspaceRoot = join(tempRoot, "workspace");
const require = createRequire(import.meta.url);

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path,
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

try {
  mkdirSync(join(appRoot, "out"), { recursive: true });
  mkdirSync(join(appRoot, "src"), { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const generatedPath = join(appRoot, "out", "sample.js");
  const originalPath = join(appRoot, "src", "sample.ts");
  writeFileSync(generatedPath, "throw new Error('generated');\n//# sourceMappingURL=sample.js.map\n");
  writeFileSync(originalPath, "export function run() {\n  const token = 'workspace-secret';\n  throw new Error('mapped');\n}\n");
  writeFileSync(`${generatedPath}.map`, JSON.stringify({
    version: 3,
    file: "sample.js",
    sourceRoot: "",
    sources: ["../src/sample.ts"],
    sourcesContent: [readFileSync(originalPath, "utf8")],
    names: [],
    mappings: "AAAA",
  }));
  const workspaceFile = join(workspaceRoot, "worker.py");
  writeFileSync(workspaceFile, "def run():\n    password = 'do-not-leak'\n    raise RuntimeError('broken')\n");

  const shared = loadTypeScript(join(root, "../shared/api/diagnostics.ts"), (specifier) => require(specifier));
  const main = loadTypeScript(join(root, "src/main/sourceNavigation.ts"), (specifier) => {
    if (specifier === "../../../shared/api/diagnostics") return shared;
    return require(specifier);
  });
  const workspaces = [
    { id: "local", name: "Local", path: workspaceRoot, location: "local", type: "local", trusted: true, createdAt: "", updatedAt: "", lastOpenedAt: "" },
    { id: "remote", name: "Remote", path: "/srv/project", location: "remote", type: "remote-ssh", trusted: true, createdAt: "", updatedAt: "", lastOpenedAt: "" },
  ];
  const navigator = new main.DiagnosticSourceNavigator({
    appRoot,
    listWorkspaces: async () => workspaces,
    previewLocal: async (request) => ({ content: readFileSync(request.path, "utf8") }),
    previewRemote: async () => ({ content: "def remote():\n    raise RuntimeError('remote')\n" }),
  });

  const mapped = await navigator.context({ source: { file: generatedPath, line: 1, column: 1, language: "javascript" } });
  assert.equal(mapped.available, true);
  assert.equal(mapped.mapping.status, "mapped");
  assert.equal(mapped.location.file, originalPath);
  assert.equal(mapped.location.language, "typescript");
  assert.match(mapped.address.version, /^[a-f0-9]{64}$/);
  assert.match(mapped.content, /export function run/);
  assert.doesNotMatch(mapped.content, /workspace-secret/);
  assert.equal(mapped.redacted, true);

  const local = await navigator.context({ source: { file: workspaceFile, line: 3, language: "python" }, workspaceId: "local", contextLines: 2 });
  assert.equal(local.address.kind, "workspace");
  assert.equal(local.highlightLine, 3);
  assert.doesNotMatch(local.content, /do-not-leak/);
  assert.equal(local.canOpen, true);

  const remote = await navigator.context({ source: { file: "/srv/project/runtime.py", line: 2, language: "python" }, workspaceId: "remote" });
  assert.equal(remote.address.kind, "remote");
  assert.equal(remote.available, true);
  assert.equal(remote.canOpen, false);

  const blocked = await navigator.context({ source: { file: join(tempRoot, "outside.ts"), line: 1 } });
  assert.equal(blocked.available, false);
  assert.match(blocked.reason, /outside registered/);

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const preload = readFileSync(join(root, "../shared/main/preload.ts"), "utf8");
  const panel = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
  for (const contract of ["desktop:diagnostics-source-context", "desktop:diagnostics-source-open", "DiagnosticSourceNavigator", "OPENDRSAI_SOURCE_EDITOR", "OPENDRSAI_SOURCE_EDITOR_ARGS"]) {
    assert.ok(mainIndex.includes(contract), `Missing source navigation main contract: ${contract}`);
  }
  assert.ok(preload.includes("getDiagnosticSourceContext") && preload.includes("openDiagnosticSource"));
  for (const contract of ["SourceInspector", "diagnostic-source-link", "View source", "Generated", "Original", "Trusted scope", "Version", "Editor"]) {
    assert.ok(panel.includes(contract), `Missing source navigation UI contract: ${contract}`);
  }

  console.log("Source navigation verification passed (Source Maps, path boundaries, local/remote context, redaction, IPC, and F12 source viewer).");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
