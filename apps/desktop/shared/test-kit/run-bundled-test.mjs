import { build } from "esbuild";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = process.argv[2];
if (!entry) throw new Error("Usage: node run-bundled-test.mjs <entry.ts>");
const coverageBundleRoot = process.env.OPENDRSAI_COVERAGE_BUNDLE_DIR?.trim();
const result = await build({
  entryPoints: [resolve(entry)],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
  sourcemap: coverageBundleRoot ? "inline" : false,
  sourceRoot: coverageBundleRoot ? `${pathToFileURL(resolve(".")).href}/` : undefined,
  sourcesContent: true,
  external: ["electron"],
});
const source = result.outputFiles[0]?.text;
if (!source) throw new Error("Bundled test produced no executable output.");
const directory = coverageBundleRoot
  ? join(resolve(coverageBundleRoot), `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`)
  : await mkdtemp(join(tmpdir(), "opendrsai-bundled-test-"));
if (!coverageBundleRoot) {
  process.once("exit", () => {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
}
await mkdir(directory, { recursive: true });
// Bundled tests occasionally exercise build helpers that intentionally load
// optional workspace tools (for example esbuild) at runtime. The temporary
// bundle lives outside the workspace, so expose the reviewed desktop
// dependency tree without copying or downloading packages.
const desktopNodeModules = resolve(import.meta.dirname, "../../node_modules");
await symlink(desktopNodeModules, join(directory, "node_modules"), "dir").catch((error) => {
  if (error?.code !== "EEXIST") throw error;
});
const output = join(directory, "test.mjs");
try { await writeFile(output, source, "utf8"); await import(pathToFileURL(output).href); }
finally { if (!coverageBundleRoot) await rm(directory, { recursive: true, force: true }); }
