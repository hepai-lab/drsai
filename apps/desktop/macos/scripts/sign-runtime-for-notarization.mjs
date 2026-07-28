import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Runtime notarization signing requires Apple Silicon macOS.");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = join(root, "resources", "runtime");
const manifestPath = join(runtimeRoot, "runtime-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const archive = join(runtimeRoot, manifest.archive);
if (!existsSync(archive)) throw new Error(`Runtime archive is missing: ${archive}`);
const identity = process.env.OPENDRSAI_RUNTIME_SIGNING_IDENTITY || findIdentity();
const staging = join(tmpdir(), `opendrsai-runtime-notarization-${process.pid}`);
const candidate = `${archive}.candidate-${process.pid}`;
const inventory = join(staging, "runtime-files.json");

try {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  run("/usr/bin/tar", ["-xzf", archive, "-C", staging]);
  const agent = join(staging, manifest.root);
  if (!existsSync(agent)) throw new Error(`Runtime archive root is missing after extraction: ${manifest.root}`);

  const entries = walk(agent);
  const machO = entries.filter((path) => isFile(path) && run("/usr/bin/file", ["-b", path]).includes("Mach-O")).sort(deepestFirst);
  if (!machO.length) throw new Error("Runtime archive contains no Mach-O binaries to sign.");
  for (const path of machO) sign(path);

  const bundles = entries.filter((path) => isDirectory(path) && /\.(app|framework|xpc|appex|bundle)$/.test(path)).sort(deepestFirst);
  for (const path of bundles) sign(path);
  for (const path of machO) run("/usr/bin/codesign", ["--verify", "--strict", path]);

  run("/usr/bin/tar", ["-czf", candidate, "-C", staging, manifest.root]);
  run(process.execPath, [join(root, "scripts", "generate-runtime-file-inventory.mjs"), agent, inventory]);
  manifest.files = JSON.parse(readFileSync(inventory, "utf8"));
  manifest.archiveSize = statSync(candidate).size;
  manifest.sha256 = sha256(candidate);
  manifest.notarizationSigning = { schemaVersion: 1, identity, machOCount: machO.length, bundleCount: bundles.length };
  renameSync(candidate, archive);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Runtime notarization signing passed (${machO.length} Mach-O binaries, ${bundles.length} bundles, ${manifest.sha256}).`);
} finally {
  rmSync(candidate, { force: true });
  rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function walk(directory) {
  const paths = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) continue;
    paths.push(path);
    if (info.isDirectory()) paths.push(...walk(path));
  }
  return paths;
}

function isFile(path) { return lstatSync(path).isFile(); }
function isDirectory(path) { return lstatSync(path).isDirectory(); }
function deepestFirst(left, right) { return right.split(sep).length - left.split(sep).length || left.localeCompare(right); }
function sign(path) { run("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp", "--options", "runtime", path]); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function findIdentity() {
  const identities = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
  const matches = [...identities.matchAll(/\"(Developer ID Application:[^\"]+)\"/g)].map((match) => match[1]);
  if (matches.length !== 1) throw new Error(`Expected exactly one Developer ID Application identity, found ${matches.length}.`);
  return matches[0];
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})\n${output}`);
  return output;
}
