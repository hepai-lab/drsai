import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const testKit = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKit, "../..");
const require = createRequire(join(desktopRoot, "package.json"));
const { build } = require("esbuild");
const fixture = await mkdtemp(join(tmpdir(), "opendrsai-file-mutations-"));
const bundle = join(fixture, "mutations.mjs");
await build({ entryPoints: [join(desktopRoot, "shared/main/workspaceFileMutations.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
const mutations = await import(pathToFileURL(bundle).href);

try {
  const workspace = join(fixture, "workspace");
  const source = join(workspace, "result.txt");
  const copy = join(fixture, "downloads", "result.txt");
  await mkdir(workspace, { recursive: true });
  await writeFile(source, "first", "utf8");

  const saved = await mutations.saveWorkspaceFileAs({ workspacePath: workspace, path: source, destinationPath: copy });
  assert.equal(saved.integrityVerified, true);
  assert.equal(await readFile(copy, "utf8"), "first");

  const expectedHash = saved.sourceHash;
  const written = await mutations.writeWorkspaceFile({ workspacePath: workspace, path: source, content: "second", expectedHash });
  assert.equal(written.status, "saved");
  assert.equal(await readFile(source, "utf8"), "second");

  await writeFile(source, "external", "utf8");
  const conflict = await mutations.writeWorkspaceFile({ workspacePath: workspace, path: source, content: "must-not-win", expectedHash: written.savedHash });
  assert.equal(conflict.status, "conflict");
  assert.equal(await readFile(source, "utf8"), "external");

  const saveAs = join(fixture, "downloads", "my-version.txt");
  const current = await mutations.saveWorkspaceFileAs({ workspacePath: workspace, path: source, destinationPath: join(fixture, "current.txt") });
  const forked = await mutations.writeWorkspaceFile({ workspacePath: workspace, path: source, content: "mine", expectedHash: current.sourceHash, mode: "save_as", destinationPath: saveAs });
  assert.equal(forked.savedAs, true);
  assert.equal(await readFile(source, "utf8"), "external");
  assert.equal(await readFile(saveAs, "utf8"), "mine");
  console.log("Workspace file mutation verification passed (copy integrity, optimistic write, conflict refusal, save-as isolation)." );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
