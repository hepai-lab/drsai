import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit } from "./acceptanceEvidence.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const outputPath = resolve(desktopRoot, "macos/build/acceptance/source-snapshot.json");
const scopes = [
  ".github/workflows/macos-desktop.yml",
  "apps/desktop/package.json",
  "apps/desktop/package-lock.json",
  "apps/desktop/shared",
  "apps/desktop/macos",
  "cores/python/packages/drsai",
];
const git = (args, encoding = "utf8") => execFileSync("git", args, { cwd: repoRoot, encoding, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
const commit = currentCommit(repoRoot);
const tree = git(["rev-parse", "HEAD^{tree}"]).trim();
const trackedChanges = git(["diff", "--name-only", "HEAD", "--", ...scopes]).trim().split(/\r?\n/).filter(Boolean).sort();
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...scopes], "buffer").toString("utf8").split("\0").filter(Boolean)
  .filter((path) => !path.replace(/\\/g, "/").startsWith("apps/desktop/macos/build/acceptance/"))
  .sort();
const trackedFiles = git(["ls-files", "-z", "--", ...scopes], "buffer").toString("utf8").split("\0").filter(Boolean).sort();
const trackedSet = new Set(trackedFiles);
const files = [...new Set([...trackedFiles, ...untracked])].sort();
const deletedTracked = trackedFiles.filter((path) => {
  try { lstatSync(resolve(repoRoot, path)); return false; } catch (error) { if (error?.code === "ENOENT") return true; throw error; }
});
const aggregate = createHash("sha256");
const manifestFiles = files.filter((path) => !deletedTracked.includes(path)).map((path) => {
  const absolutePath = resolve(repoRoot, path);
  const stat = lstatSync(absolutePath);
  const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : null;
  if (!kind) throw new Error(`Unsupported source snapshot entry type: ${path}`);
  const bytes = kind === "symlink" ? Buffer.from(readlinkSync(absolutePath), "utf8") : readFileSync(absolutePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  aggregate.update(path.replace(/\\/g, "/")).update("\0").update(kind).update("\0").update(sha256).update("\0");
  return { path: path.replace(/\\/g, "/"), kind, sourceState: trackedSet.has(path) ? "tracked" : "untracked", size: bytes.length, sha256 };
});
for (const path of deletedTracked) aggregate.update(path.replace(/\\/g, "/")).update("\0deleted\0\0");
const clean = trackedChanges.length === 0 && untracked.length === 0;
const report = {
  schemaVersion: 2,
  commit,
  tree,
  scopes,
  clean,
  trackedChanges,
  untracked,
  deletedTracked: deletedTracked.map((path) => path.replace(/\\/g, "/")),
  fileCount: manifestFiles.length,
  aggregateSha256: aggregate.digest("hex"),
  files: manifestFiles,
  generatedAt: new Date().toISOString(),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--require-clean") && !clean) throw new Error(`macOS source scope is not clean: ${[...trackedChanges, ...untracked].slice(0, 20).join(", ")}`);
console.log(`macOS source snapshot generated: files=${manifestFiles.length}, clean=${clean}, sha256=${report.aggregateSha256}.`);
console.log(`Source snapshot: ${outputPath}`);
