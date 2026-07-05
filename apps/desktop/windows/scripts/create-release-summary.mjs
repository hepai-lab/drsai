import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const setupName = `OpenDrSai-${packageJson.version}-setup.exe`;
const artifacts = [
  setupName,
  `${setupName}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  join("bootstrapper", "OpenDrSai Installer.exe"),
];

const describedArtifacts = artifacts.map((relativePath) => describeArtifact(relativePath));
const distribution = describeDistribution(describedArtifacts);

const summary = {
  product: "OpenDrSai Windows",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  releaseDir,
  distribution,
  manifest: readJsonIfExists(join(releaseDir, "latest-windows.json")),
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
    signatureStatus: relativePath.endsWith(".exe") ? getSignatureStatus(fullPath) : null,
  };
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
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
  const executableArtifacts = describedArtifacts.filter(
    (artifact) => artifact.exists && artifact.path.endsWith(".exe"),
  );
  const unsigned = executableArtifacts.filter(
    (artifact) => artifact.signatureStatus !== "Valid",
  );
  return {
    publicDistributionReady: unsigned.length === 0,
    requiresSignedExecutables: true,
    unsignedArtifacts: unsigned.map((artifact) => ({
      path: artifact.path,
      signatureStatus: artifact.signatureStatus,
    })),
    note:
      unsigned.length === 0
        ? "All executable release artifacts are Authenticode signed."
        : "Do not distribute this build publicly until all executable artifacts are Authenticode signed.",
  };
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
