import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = resolve(app, "../../..");

const rendererFiles = await sourceFiles(join(app, "../shared/renderer"), new Set([".ts", ".tsx", ".js", ".jsx"]));
for (const file of rendererFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /(?:from|require\s*\()\s*["'](?:node:)?(?:child_process|node-pty|ssh2)["']/, `${relative(root, file)} must not own process, PTY, or SSH transports`);
  assert.doesNotMatch(source, /git\s+worktree\s+(?:add|remove|prune)/i, `${relative(root, file)} must not execute Git Worktree lifecycle operations`);
}

const adapterRoot = join(root, "cores/python/packages/drsai/src/drsai/backend/codex_adapter");
for (const file of await sourceFiles(adapterRoot, new Set([".py"]))) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /git\s+worktree\s+(?:add|remove|prune)/i, `${relative(root, file)} must not own Worktree lifecycle`);
  assert.doesNotMatch(source, /class\s+(?:Worktree|Terminal)(?:Resource|Registry|Service)\b/, `${relative(root, file)} must not define Workspace resource ownership`);
}

const mainFiles = await sourceFiles(join(app, "src/main"), new Set([".ts"]));
const forkFacade = await readFile(join(app, "src/main/forkWorktrees.ts"), "utf8");
assert.match(forkFacade, /OPENDRSAI_LEGACY_DESKTOP_WORKTREE\s*===\s*["']1["']/, "Legacy Desktop Worktree path must be explicitly gated");
assert.match(forkFacade, /LocalRuntimeClient\.connect\(\)/, "Default local Worktree path must use Local Runtime");
assert.ok(
  forkFacade.indexOf("LocalRuntimeClient.connect()") < forkFacade.indexOf("async function prepareLegacyForkWorktree"),
  "Runtime-owned Worktree path must remain the default facade implementation",
);
const legacyOwners = new Set([
  "apps/desktop/windows/src/main/forkWorktrees.ts",
  "apps/desktop/windows/src/main/terminal.ts",
  // In-process packaged E2E fixture; it is not reachable as a product Worktree service.
  "apps/desktop/windows/src/main/e2eSmoke.ts",
]);
for (const file of mainFiles) {
  const source = await readFile(file, "utf8");
  const path = relative(root, file).replaceAll("\\", "/");
  if (/["']worktree["']\s*,\s*["'](?:add|remove|prune)["']/i.test(source)) {
    assert.equal(legacyOwners.has(path), true, `${path} introduces a new Desktop-owned Worktree lifecycle path`);
  }
  if (/(?:from|require\s*\()\s*["']node-pty["']/.test(source)) {
    assert.equal(legacyOwners.has(path), true, `${path} introduces a new Electron-owned PTY path`);
  }
}

console.log("ORCA_INSPIRED dependency boundaries passed; only declared legacy facades retain direct ownership during migration.");

async function sourceFiles(directory, extensions) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path, extensions));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}
