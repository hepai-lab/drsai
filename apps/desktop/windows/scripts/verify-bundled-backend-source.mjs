import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(appRoot, "resources", "backend", "backend-source.json");
const builderConfig = read("electron-builder.yml");
const packageJson = JSON.parse(read("package.json"));

assert(packageJson.scripts["prepare:backend-source"] === "node scripts/create-backend-source-archive.mjs", "package.json omits prepare:backend-source script");
assert(packageJson.scripts.build.startsWith("npm run prepare:backend-source &&"), "build script does not prepare bundled backend source first");
assert(packageJson.scripts["verify:packaged"].startsWith("npm run prepare:backend-source -- --sync-unpacked &&"), "verify:packaged does not sync bundled backend source into the unpacked app");
assert(builderConfig.includes("resources/**"), "electron-builder.yml does not include resources/** in packaged files");
assert(builderConfig.includes("asarUnpack:") && builderConfig.includes("resources/**"), "electron-builder.yml does not unpack resources/**");

assert(existsSync(manifestPath), "bundled backend source manifest is missing; run npm run prepare:backend-source");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.archive === "drsai-backend-source.zip", "backend source manifest archive name changed unexpectedly");
assert(/^[a-f0-9]{64}$/.test(manifest.sha256 || ""), "backend source manifest sha256 is missing or invalid");
assert(manifest.version === packageJson.version, "backend source manifest version does not match package.json");
const archivePath = join(appRoot, "resources", "backend", manifest.archive);
assert(existsSync(archivePath), "backend source archive is missing");
const archive = readFileSync(archivePath);
const sha256 = createHash("sha256").update(archive).digest("hex");
assert(sha256 === manifest.sha256, "backend source archive sha256 does not match manifest");
assert(archive.includes(Buffer.from("cores/python/packages/drsai/pyproject.toml")), "backend source archive omits drsai pyproject");
assert(archive.includes(Buffer.from("cores/python/packages/drsai/src/drsai/backend/run_cli.py")), "backend source archive omits backend CLI source");
assert(archive.includes(Buffer.from("protocol/owop/owop.schema.json")), "backend source archive omits the OWOP schema required by the Python wheel build");
assert(archive.includes(Buffer.from("protocol/relay/runtime-relay.schema.json")), "backend source archive omits the Relay contract");

console.log("Bundled backend source verification passed.");

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Bundled backend source verification failed: ${message}`);
    process.exit(1);
  }
}
