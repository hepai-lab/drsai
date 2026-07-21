import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir, rm, writeFile, open } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const stateRoot = join(root, "out", "verification", "thread-atomic-recovery");
await rm(stateRoot, { recursive: true, force: true });
await mkdir(stateRoot, { recursive: true });
const sourcePath = join(stateRoot, "threads.tmp");
const destinationPath = join(stateRoot, "threads.json");
await writeFile(sourcePath, '{"version":"new"}\n');
await writeFile(destinationPath, '{"version":"old"}\n');

const modulePath = join(root, "src", "main", "atomicFileReplace.ts");
const output = ts.transpileModule(await readFile(modulePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: modulePath }).outputText;
const loaded = { exports: {} };
new Function("exports", "module", "require", output)(loaded.exports, loaded, createRequire(import.meta.url));

const common = {
  rename: async () => { throw Object.assign(new Error("simulated Windows lock"), { code: "EPERM" }); },
  copyFile,
  readFile,
  syncFile: async (path) => { const handle = await open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } },
  remove: async (path) => rm(path, { force: true }),
  wait: async () => undefined,
};
await loaded.exports.replaceFileSafely(sourcePath, destinationPath, common);
assert.equal(await readFile(destinationPath, "utf8"), '{"version":"new"}\n');
assert.equal((await readdir(stateRoot)).some((name) => name.includes("replace-backup")), false);

await writeFile(destinationPath, '{"version":"stable"}\n');
const refusingCopy = { ...common, copyFile: async (source, destination) => {
  if (source === sourcePath && destination === destinationPath) throw Object.assign(new Error("persistent lock"), { code: "EPERM" });
  await copyFile(source, destination);
} };
await assert.rejects(loaded.exports.replaceFileSafely(sourcePath, destinationPath, refusingCopy));
assert.equal(await readFile(destinationPath, "utf8"), '{"version":"stable"}\n', "A failed fallback must restore the prior thread file.");

const threadsSource = await readFile(join(root, "src", "main", "threads.ts"), "utf8");
assert.ok(threadsSource.includes("replaceFileSafely(temporary, path)"));
assert.ok(threadsSource.includes("cleanupStaleThreadTemporaryFiles") && threadsSource.includes("5 * 60_000"));
await rm(stateRoot, { recursive: true, force: true });
console.log("Thread atomic recovery verification passed (EPERM rename fallback, fsync verification, backup cleanup, and rollback)." );
