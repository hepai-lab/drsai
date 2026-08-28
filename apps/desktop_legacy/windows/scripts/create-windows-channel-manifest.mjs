import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve(required("OPENDRSAI_SOURCE_UPDATE_MANIFEST"));
const outputPath = resolve(required("OPENDRSAI_CHANNEL_MANIFEST_PATH"));
const channel = required("OPENDRSAI_UPDATE_CHANNEL").toLowerCase();
const requestedBuildLabel = String(process.env.OPENDRSAI_BUILD_LABEL || "").trim();

assert(["beta", "stable"].includes(channel), "Channel must be beta or stable.");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
assert(source.schemaVersion === 1, "Source update manifest schemaVersion must be 1.");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version || ""), "Source version is invalid.");
assert(source.runtime?.url?.startsWith("https://download-opendrsai.ihep.ac.cn/releases/"), "Runtime must use the immutable OpenDrSai CDN release path.");
assert(Number.isSafeInteger(source.runtime?.sizeBytes) && source.runtime.sizeBytes > 0, "Runtime size is invalid.");
assert(/^[0-9a-f]{64}$/.test(source.runtime?.sha256 || ""), "Runtime SHA-256 is invalid.");

const manifest = {
  ...source,
  channel,
  publishedAt: process.env.OPENDRSAI_RELEASE_PUBLISHED_AT || source.publishedAt || new Date().toISOString(),
  requireSignature: channel === "stable" ? true : Boolean(source.requireSignature),
};

if (channel === "beta") {
  const buildLabel = requestedBuildLabel || String(source.buildLabel || "").trim();
  assert(buildLabel, "Beta channel promotion requires a non-empty buildLabel.");
  manifest.buildLabel = buildLabel;
} else {
  delete manifest.buildLabel;
}

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
