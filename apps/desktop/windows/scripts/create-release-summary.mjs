import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const artifacts = [
  join("bootstrapper", "OpenDrSaiSetup.msi"),
  join("bootstrapper", "OpenDrSaiRuntime-win-x64.zip"),
];

const describedArtifacts = artifacts.map((relativePath) => describeArtifact(relativePath));
const distribution = describeDistribution(describedArtifacts);

const summary = {
  product: "OpenDrSai Windows",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  releaseDir,
  distribution,
  artifacts: describedArtifacts,
};

const outputPath = join(releaseDir, "release-summary.json");
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);

function describeArtifact(relativePath) {
  const fullPath = join(releaseDir, relativePath);
  if (!existsSync(fullPath)) {
    return { path: relativePath, exists: false };
  }
  const bytes = readFileSync(fullPath);
  return {
    path: relativePath.replace(/\\/g, "/"),
    exists: true,
    sizeBytes: statSync(fullPath).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signatureStatus: relativePath.endsWith(".msi") ? getSignatureStatus(fullPath) : null,
  };
}

function getSignatureStatus(path) {
  if (process.platform !== "win32") return "SkippedNonWindows";
  const command = `(Get-AuthenticodeSignature -LiteralPath ${quotePowerShellString(path)}).Status`;
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function describeDistribution(describedArtifacts) {
  const signedArtifacts = describedArtifacts.filter(
    (artifact) => artifact.exists && artifact.path.endsWith(".msi"),
  );
  const unsigned = signedArtifacts.filter(
    (artifact) => artifact.signatureStatus !== "Valid",
  );
  return {
    publicDistributionReady: unsigned.length === 0,
    requiresSignedInstallers: true,
    unsignedArtifacts: unsigned.map((artifact) => ({
      path: artifact.path,
      signatureStatus: artifact.signatureStatus,
    })),
    note:
      unsigned.length === 0
        ? "All installer artifacts are Authenticode signed."
        : "Do not distribute this build publicly until installer artifacts are Authenticode signed.",
  };
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
