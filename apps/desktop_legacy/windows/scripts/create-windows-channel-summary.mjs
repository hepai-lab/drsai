import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve(required("OPENDRSAI_SOURCE_RELEASE_SUMMARY"));
const outputPath = resolve(required("OPENDRSAI_CHANNEL_SUMMARY_PATH"));
const channel = required("OPENDRSAI_UPDATE_CHANNEL").toLowerCase();
const buildLabel = String(process.env.OPENDRSAI_BUILD_LABEL || "").trim();
assert(["beta", "stable"].includes(channel), "Channel must be beta or stable.");

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const signedArtifacts = (source.artifacts || []).filter((item) => item.path?.endsWith(".msi") || item.path?.endsWith("-x64.zip"));
const unsignedArtifacts = signedArtifacts.filter((item) => item.signatureStatus !== "Valid");
const stable = channel === "stable";
const summary = {
  ...source,
  generatedAt: process.env.OPENDRSAI_RELEASE_PUBLISHED_AT || source.generatedAt || new Date().toISOString(),
  distribution: {
    ...source.distribution,
    releaseTier: channel,
    publicDistributionReady: stable ? unsignedArtifacts.length === 0 : true,
    requiresSignedInstallers: stable,
    unsignedArtifacts: unsignedArtifacts.map(({ path, signatureStatus }) => ({ path, signatureStatus })),
    note: stable
      ? unsignedArtifacts.length === 0
        ? "Stable promotion uses Authenticode-signed MSI and runtime executable."
        : "Stable promotion blocked: MSI and runtime executable must be Authenticode signed."
      : "Beta preview may be unsigned; signature status remains bound in this summary.",
  },
};
if (stable) delete summary.buildLabel;
else {
  assert(buildLabel || source.buildLabel, "Beta channel summary requires buildLabel.");
  summary.buildLabel = buildLabel || source.buildLabel;
}
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
