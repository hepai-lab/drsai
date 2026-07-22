import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(app, "../../..");
const temp = await mkdtemp(join(tmpdir(), "opendrsai-m11-"));
try {
  const adapterBundle = join(temp, "legacy.mjs");
  await build({ entryPoints: [join(app, "src/main/legacyRemoteWorkspaceAdapter.ts")], outfile: adapterBundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const adapter = await import(pathToFileURL(adapterBundle).href);
  const warnings = [];
  assert.deepEqual(adapter.adaptLegacyRemoteSshConnect({ alias: "host-a", workdir: "/home/vscode", trusted: true }, (message) => warnings.push(message)), { hostAlias: "host-a", path: "/home/vscode", trusted: true, name: undefined });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /deprecated/);

  const boundaryBundle = join(temp, "boundaries.mjs");
  await build({ entryPoints: [join(app, "../shared/main/remoteWorkspaceBoundaries.ts")], outfile: boundaryBundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { REMOTE_WORKSPACE_BOUNDARIES } = await import(pathToFileURL(boundaryBundle).href);
  assert.deepEqual(Object.keys(REMOTE_WORKSPACE_BOUNDARIES), ["ssh", "connection", "protocol", "workspace", "files", "git", "pty", "runtimeEngine"]);
  const sourceNames = new Set((await collectFiles(join(app, "src"))).concat(await collectFiles(join(repo, "cores/python/packages/drsai/src/drsai/backend"))).map((path) => basename(path)));
  for (const [boundary, files] of Object.entries(REMOTE_WORKSPACE_BOUNDARIES)) {
    assert(files.every((file) => sourceNames.has(file)), `${boundary} boundary references a missing implementation module`);
  }

  const legacyDependencyHits = [];
  for (const file of await collectFiles(join(app, "src"))) {
    if (!/\.(ts|tsx)$/.test(file) || /legacyRemoteWorkspaceAdapter|workspaceLocation/.test(file)) continue;
    const content = await readFile(file, "utf8");
    if (/adaptLegacyRemoteSshConnect|LegacyRemoteSshConnectRequest/.test(content)) legacyDependencyHits.push(file);
  }
  assert.deepEqual(legacyDependencyHits, [], "New production code depends on the removal-bound Legacy API Adapter");

  const productSurfaces = [
    join(app, "../shared/renderer/src/App.tsx"),
    join(app, "../shared/api/desktopApi.ts"),
    join(repo, "docs/remote_workespace/OpenDrSai远程工作区实现方案V1.md"),
  ];
  for (const file of productSurfaces) {
    const content = await readFile(file, "utf8");
    assert(!/DrSai Runtime Server|Agent Runtime Gateway/i.test(content), `${basename(file)} retains an obsolete product name`);
  }
  console.log("M11 Legacy Adapter, naming and implementation-boundary verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function collectFiles(root) {
  const result = [];
  for (const name of await readdir(root)) {
    const path = join(root, name);
    if ((await stat(path)).isDirectory()) result.push(...await collectFiles(path));
    else result.push(path);
  }
  return result;
}
