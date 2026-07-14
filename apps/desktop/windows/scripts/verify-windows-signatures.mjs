import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const requireSigned = process.env.REQUIRE_SIGNED_WINDOWS_ARTIFACTS === "1";
const expectedThumbprint = normalizeThumbprint(process.env.EXPECTED_WINDOWS_SIGNER_THUMBPRINT || "");
const expectedSubject = (process.env.EXPECTED_WINDOWS_SIGNER_SUBJECT || "").trim();
const runtimePath = join(releaseDir, "bootstrapper", "OpenDrSaiRuntime-win-x64.zip");
const temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-signatures-"));
const runtimeExecutable = join(temporaryRoot, "OpenDrSai.exe");
const artifacts = [join(releaseDir, "bootstrapper", "OpenDrSaiSetup.msi")];
const failures = [];
if (existsSync(runtimePath)) {
  extractRuntimeExecutable(runtimePath, runtimeExecutable);
  artifacts.push(runtimeExecutable);
} else {
  failures.push(`${runtimePath}: missing`);
}

if (requireSigned && !expectedThumbprint) {
  failures.push("EXPECTED_WINDOWS_SIGNER_THUMBPRINT is required when REQUIRE_SIGNED_WINDOWS_ARTIFACTS=1.");
}
for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    failures.push(`${artifact}: missing`);
    continue;
  }
  const signature = getSignatureInfo(artifact);
  if (signature.status !== "Valid") {
    failures.push(`${artifact}: ${signature.status}`);
    continue;
  }
  if (expectedThumbprint && normalizeThumbprint(signature.thumbprint) !== expectedThumbprint) {
    failures.push(`${artifact}: signer thumbprint ${signature.thumbprint || "<missing>"} does not match EXPECTED_WINDOWS_SIGNER_THUMBPRINT`);
  }
  if (expectedSubject && !signature.subject.includes(expectedSubject)) {
    failures.push(`${artifact}: signer subject ${signature.subject || "<missing>"} does not include EXPECTED_WINDOWS_SIGNER_SUBJECT`);
  }
}

if (failures.length) {
  const message = [
    "Windows signature verification did not pass:",
    ...failures.map((failure) => `- ${failure}`),
  ].join("\n");
  if (requireSigned) {
    console.error(message);
    process.exitCode = 1;
  }
  console.warn(message);
  console.warn("Continuing because REQUIRE_SIGNED_WINDOWS_ARTIFACTS is not 1.");
} else {
  console.log("Windows signatures verified.");
}
rmSync(temporaryRoot, { recursive: true, force: true });

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return packageJson.version;
}

function getSignatureInfo(path) {
  if (process.platform !== "win32") {
    return { status: "SkippedNonWindows", thumbprint: "", subject: "" };
  }
  const command = [
    `$sig = Get-AuthenticodeSignature -LiteralPath ${quotePowerShellString(path)}`,
    "$thumbprint = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { '' }",
    "$subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }",
    "[pscustomobject]@{ Status = [string]$sig.Status; Thumbprint = $thumbprint; Subject = $subject } | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        command,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const parsed = JSON.parse(output);
    return {
      status: String(parsed.Status || ""),
      thumbprint: String(parsed.Thumbprint || ""),
      subject: String(parsed.Subject || ""),
    };
  } catch (error) {
    return {
      status: error instanceof Error ? error.message : String(error),
      thumbprint: "",
      subject: "",
    };
  }
}

function extractRuntimeExecutable(archive, destination) {
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip=[IO.Compression.ZipFile]::OpenRead(${quotePowerShellString(archive)})`,
    `try { $entry=@($zip.Entries | Where-Object { ($_.FullName -replace '\\\\','/') -eq 'app/OpenDrSai.exe' })[0]; if(-not $entry){throw 'Runtime app executable is missing.'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, ${quotePowerShellString(destination)}, $true) } finally { $zip.Dispose() }`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
}

function normalizeThumbprint(value) {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
