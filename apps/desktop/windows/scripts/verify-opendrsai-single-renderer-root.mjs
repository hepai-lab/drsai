import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const windowsRoot = resolve(import.meta.dirname, "..");
const duplicateRoot = resolve(windowsRoot, "src/renderer");
const config = readFileSync(resolve(windowsRoot, "electron.vite.config.ts"), "utf8");
const webConfig = readFileSync(resolve(windowsRoot, "tsconfig.web.json"), "utf8");

const duplicateFiles = existsSync(duplicateRoot) ? filesUnder(duplicateRoot) : [];
assert.deepEqual(duplicateFiles, [], `Windows duplicate Renderer source files remain: ${duplicateFiles.join(", ")}`);
assert.match(config, /renderer:\s*\{[\s\S]{0,100}root: resolve\("\.\.\/shared\/renderer"\)/, "Electron Renderer root must be shared/renderer");
assert.match(config, /input: resolve\("\.\.\/shared\/renderer\/index\.html"\)/, "Renderer entrypoint must come from shared/renderer");
assert.match(webConfig, /"\.\.\/shared\/renderer\/src\/\*\*\/\*"/, "Renderer typecheck must cover the shared source tree");
assert.doesNotMatch(webConfig, /"src\/renderer/, "Renderer typecheck must not retain a Windows source root");

console.log("OpenDrSai single Renderer root verified: Windows builds and typechecks only apps/desktop/shared/renderer.");

function filesUnder(root) {
  const result = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  return result;
}
