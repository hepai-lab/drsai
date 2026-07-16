import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const pythonBackend = join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend");
const adapterRoot = join(pythonBackend, "codex_adapter");
const violations = [];

await scan(join(desktop, "src"), [
  [/['"`]thread\/start['"`]/, "Desktop must not speak Codex thread/start JSON-RPC"],
  [/['"`]turn\/start['"`]/, "Desktop must not speak Codex turn/start JSON-RPC"],
  [/codex\s+app-server\s+--listen/i, "Desktop must not launch Codex App Server directly"],
]);
const workspaceOwner = await readFile(join(desktop, "src", "main", "workspaces.ts"), "utf8");
assert(workspaceOwner.includes("LocalRuntimeClient.connect()).openWorkspace"), "Desktop Local Workspace creation must use Runtime Registry");
assert(!/id:\s*`workspace-\$\{randomUUID\(\)\}`/.test(workspaceOwner), "Desktop must not generate authoritative Local Workspace IDs");
await scan(adapterRoot, [
  [/from\s+apps\.desktop|import\s+apps\.desktop/i, "Codex Adapter must not import Desktop"],
  [/(?:from|import)\s+[^\n]*(?:renderer|desktopApi|electron)/i, "Codex Adapter must not depend on Renderer or Electron"],
]);
for (const name of await readdir(pythonBackend)) {
  if (!name.startsWith("workspace") || !name.endsWith(".py")) continue;
  await scan(join(pythonBackend, name), [
    [/(?:from|import)\s+[^\n]*(?:apps\.desktop|renderer|desktopApi|electron)/i, "Workspace service must not depend on Desktop"],
  ]);
}
await scan(join(pythonBackend, "gateway.py"), [
  [/['"`]thread\/start['"`]|['"`]turn\/start['"`]/, "Gateway must route through Codex Adapter, not Codex JSON-RPC"],
]);

assert.deepEqual(violations, [], `Architecture dependency boundary violations:\n${violations.join("\n")}`);
console.log("Codex dependency boundary verification passed.");

async function scan(root, rules) {
  for (const file of await files(root)) {
    if (![".py", ".ts", ".tsx", ".js", ".mjs", ".json"].includes(extname(file))) continue;
    const source = await readFile(file, "utf8");
    for (const [pattern, message] of rules) {
      if (pattern.test(source)) violations.push(`${relative(repo, file)}: ${message}`);
    }
  }
}

async function files(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOTDIR") return [path];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (["node_modules", "out", "release"].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}
