import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd(), "../../..");
const runtime = join(root, "cores/python/packages/drsai/src/drsai/backend/runtime");
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".py")) files.push(path);
  }
}
await walk(runtime);
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (/\b(?:from|import)\s+drsai\.backend\.codex_adapter\b/.test(source)) {
    violations.push(relative(root, file));
  }
}
assert.deepEqual(violations, [], `Runtime Core imports concrete Codex Adapter: ${violations.join(", ")}`);
console.log("P10 backend-neutral Runtime architecture verification passed.", { scanned: files.length });
