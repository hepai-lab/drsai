import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = resolve(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const baseUrl = process.env.OPENDRSAI_RELEASE_BASE_URL;
const channel = process.env.OPENDRSAI_RELEASE_CHANNEL || "stable";
const allowedChannels = new Set(["stable", "beta", "dev"]);

if (!baseUrl) {
  throw new Error("Set OPENDRSAI_RELEASE_BASE_URL to the public release asset base URL.");
}

if (!allowedChannels.has(channel)) {
  throw new Error(`Unsupported OPENDRSAI_RELEASE_CHANNEL: ${channel}`);
}

const installers = readdirSync(releaseDir)
  .filter((name) => name === `OpenDrSai-${packageJson.version}-setup.exe`);

if (installers.length === 0) {
  throw new Error(`No OpenDrSai ${packageJson.version} setup exe found in ${releaseDir}.`);
}

const installerName = installers[0];
const installerPath = join(releaseDir, installerName);
const bytes = readFileSync(installerPath);
const manifest = {
  version: packageJson.version,
  channel,
  minimumBootstrapperVersion: "0.1.0",
  installer: `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(basename(installerName))}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sizeBytes: statSync(installerPath).size,
};

writeFileSync(
  join(releaseDir, "latest-windows.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Wrote ${join(releaseDir, "latest-windows.json")}`);
