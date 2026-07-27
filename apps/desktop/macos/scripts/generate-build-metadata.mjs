import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "../../..");
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
const commit = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || git("rev-parse", "HEAD");
const sourceDate = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : git("show", "-s", "--format=%cI", commit);
const dirty = git("status", "--porcelain").length > 0;
const output = resolve(appRoot, "out", "build-metadata.json");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const walk = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(root, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const artifacts = walk(resolve(appRoot, "out"))
  .filter((path) => path !== output)
  .map((path) => ({
    path: relative(resolve(appRoot, "out"), path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }))
  .sort((left, right) => left.path.localeCompare(right.path));
const metadata = {
  schemaVersion: 1,
  product: "OpenDrSai",
  platform: "darwin",
  arch: "arm64",
  version: packageJson.version,
  commit,
  sourceDate,
  dirty,
  buildId: `${packageJson.version}+${commit.slice(0, 12)}`,
  changelog: {
    path: "CHANGELOG.md",
    sha256: sha256(resolve(repositoryRoot, "CHANGELOG.md")),
  },
  artifacts,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`macOS build metadata generated: ${metadata.buildId}${dirty ? " (dirty)" : ""}.`);
