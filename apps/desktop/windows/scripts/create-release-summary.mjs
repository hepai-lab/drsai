import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtimeArchiveName = `OpenDrSai-Windows-v${packageJson.version}-x64.zip`;
const artifacts = [
  join("bootstrapper", "OpenDrSai-Windows-Installer-x64.msi"),
  join("bootstrapper", runtimeArchiveName),
  "latest-windows.json",
];

const describedArtifacts = artifacts.map((relativePath) => describeArtifact(relativePath));
const distribution = describeDistribution(describedArtifacts, packageJson.version);

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
    signatureStatus: relativePath.endsWith(".msi")
      ? getSignatureStatus(fullPath)
      : relativePath.endsWith(runtimeArchiveName)
        ? getRuntimeExecutableSignatureStatus(fullPath)
        : null,
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

function describeDistribution(describedArtifacts, version) {
  const signedArtifacts = describedArtifacts.filter(
    (artifact) => artifact.exists &&
      (artifact.path.endsWith(".msi") || artifact.path.endsWith(runtimeArchiveName)),
  );
  const unsigned = signedArtifacts.filter(
    (artifact) => artifact.signatureStatus !== "Valid",
  );
  const preview = version.includes("-");
  return {
    releaseTier: preview ? "preview" : "stable",
    publicDistributionReady: unsigned.length === 0 || preview,
    requiresSignedInstallers: !preview,
    unsignedArtifacts: unsigned.map((artifact) => ({
      path: artifact.path,
      signatureStatus: artifact.signatureStatus,
    })),
    note:
      unsigned.length === 0
        ? "The MSI and runtime Electron executable are Authenticode signed."
        : preview
          ? "Unsigned prerelease preview: Windows may display an unknown-publisher warning; stable releases still require Authenticode signatures."
          : "Do not distribute this stable build publicly until the MSI and runtime Electron executable are Authenticode signed.",
  };
}

function getRuntimeExecutableSignatureStatus(path) {
  if (process.platform !== "win32") return "SkippedNonWindows";
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$tmp=Join-Path ([IO.Path]::GetTempPath()) ('opendrsai-summary-'+[guid]::NewGuid().ToString('N')+'.exe')",
    `$zip=[IO.Compression.ZipFile]::OpenRead(${quotePowerShellString(path)})`,
    "try{$entry=@($zip.Entries|Where-Object{($_.FullName -replace '\\\\','/') -eq 'app/OpenDrSai.exe'})[0];if(-not $entry){throw 'Runtime app executable missing.'};[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$tmp,$true);(Get-AuthenticodeSignature -LiteralPath $tmp).Status}finally{$zip.Dispose();Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}",
  ].join("; ");
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
