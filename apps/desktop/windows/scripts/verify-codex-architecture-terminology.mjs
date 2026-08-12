import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const productRoots = [
  join(repo, "cores", "python", "packages", "drsai", "src"),
  join(desktop, "src"),
  join(desktop, "resources"),
];
const docsRoot = join(repo, "docs", "remote_workespace");
const extensions = new Set([".py", ".ts", ".tsx", ".json", ".md"]);
const forbidden = [
  /\bAgentRuntimeBackend\b/,
  /\bOpenDrSaiAgentRuntimeBackend\b/,
  /OpenDrSai Agent Runtime/,
  /Codex Agent Runtime/,
];

const violations = [];
for (const root of [...productRoots, docsRoot]) {
  for (const file of await files(root)) {
    if (!extensions.has(extname(file))) continue;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of forbidden) {
        if (!pattern.test(line)) continue;
        const isNamingRule = /禁止|不使用|重命名为|当前 `AgentRuntimeBackend|禁止在 Agent Core/.test(line);
        if (!isNamingRule) violations.push(`${file}:${index + 1}: ${pattern}`);
      }
    });
  }
}

assert.deepEqual(violations, [], `Forbidden Agent Core terminology:\n${violations.join("\n")}`);
const architecture = await readFile(join(docsRoot, "OpenDrSai远程工作区实现方案V1.md"), "utf8");
for (const term of ["Full Agent Runtime", "Agent Backend", "Codex Agent Runtime", "Codex Adapter", "Codex App Server", "OWOP"]) {
  assert(architecture.includes(term), `Required architecture term is missing: ${term}`);
}
console.log("Codex architecture terminology verification passed.");

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === "release") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
