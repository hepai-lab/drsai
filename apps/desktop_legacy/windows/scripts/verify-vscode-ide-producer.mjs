import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`VS Code IDE producer verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const extensionPackage = read("editor-integrations/vscode/package.json");
const extension = read("editor-integrations/vscode/extension.js");
const readme = read("editor-integrations/vscode/README.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes('"verify:vscode-ide-producer": "node scripts/verify-vscode-ide-producer.mjs"'),
  "package script is not registered",
);

assert(extensionPackage.includes('"main": "./extension.js"'), "VS Code extension package does not point at extension.js");
assert(extensionPackage.includes('"onStartupFinished"'), "VS Code extension is not activated after startup");
assert(extensionPackage.includes('"opendrsai.captureIdeContext"'), "capture command is not registered");
assert(extensionPackage.includes('"opendrsai.ideContext.enabled"'), "enablement setting is missing");

assert(extension.includes('CONTEXT_RELATIVE_PATH = path.join(".drsai", "ide-context.json")'), "producer does not write the expected handoff path");
assert(extension.includes("MAX_SELECTION_CHARS = 12000"), "selection bound is missing");
assert(extension.includes("vscode.window.activeTextEditor"), "producer does not read the active editor");
assert(extension.includes("vscode.workspace.getWorkspaceFolder"), "producer does not resolve the owning workspace");
assert(extension.includes("vscode.window.onDidChangeActiveTextEditor"), "active editor change listener is missing");
assert(extension.includes("vscode.window.onDidChangeTextEditorSelection"), "selection change listener is missing");
assert(extension.includes("vscode.workspace.onDidChangeTextDocument"), "document change listener is missing");
assert(extension.includes('source: "vscode"'), "payload source is not marked as vscode");
assert(extension.includes("currentFile"), "payload omits current file");
assert(extension.includes("currentSelection"), "payload omits current selection");
assert(extension.includes("path.relative(parentPath, childPath)"), "workspace boundary check does not use path.relative");
assert(extension.includes("!relativePath.startsWith(\"..\")"), "workspace boundary does not reject parent traversal");
assert(extension.includes("!path.isAbsolute(relativePath)"), "workspace boundary does not reject absolute escapes");
assert(extension.includes("fs.mkdir(path.dirname(contextPath), { recursive: true })"), "producer does not create the .drsai folder");
assert(extension.includes("fs.rename(tempPath, contextPath)"), "producer does not atomically replace the context file");

assert(readme.includes(".drsai/ide-context.json"), "README does not document the handoff file");
assert(readme.includes("Refresh IDE context"), "README does not include desktop manual verification");
assert(readme.includes("12,000 characters"), "README does not document the selection limit");

assert(roadmap.includes("VS Code producer"), "roadmap does not record the VS Code producer");
assert(roadmap.includes("npm run verify:vscode-ide-producer"), "roadmap does not record VS Code producer verification");

console.log("VS Code IDE producer verification passed.");
