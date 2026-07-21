import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const artifactRoot = process.env.OPENDRSAI_WINDOWS_ARTIFACT_ROOT ? resolve(process.env.OPENDRSAI_WINDOWS_ARTIFACT_ROOT) : root;
const desktopExecutable = join(artifactRoot, "release", "win-unpacked", "OpenDrSai.exe");
const runtimeZip = join(artifactRoot, "release", "bootstrapper", "OpenDrSaiRuntime-win-x64.zip");
const msi = join(artifactRoot, "release", "bootstrapper", "OpenDrSaiSetup-win-x64.msi");
const output = process.env.OPENDRSAI_WINDOWS_SIGNING_EVIDENCE || join(artifactRoot, "release", "product-evidence", "remote-workspace", "windows-signatures.json");
const expectedThumbprint = normalize(process.env.EXPECTED_WINDOWS_SIGNER_THUMBPRINT || "");
const expectedSubject = String(process.env.EXPECTED_WINDOWS_SIGNER_SUBJECT || "").trim();
if (!expectedThumbprint) throw new Error("EXPECTED_WINDOWS_SIGNER_THUMBPRINT is required to generate signing evidence.");
for (const path of [desktopExecutable, runtimeZip, msi]) if (!existsSync(path)) throw new Error(`Signed release artifact is missing: ${path}`);

const temporary = mkdtempSync(join(tmpdir(), "opendrsai-signing-evidence-"));
try {
  const embeddedExecutable = join(temporary, "OpenDrSai.exe");
  extractRuntimeExecutable(runtimeZip, embeddedExecutable);
  const desktopHash = sha256(desktopExecutable);
  if (sha256(embeddedExecutable) !== desktopHash) throw new Error("Runtime ZIP does not contain the exact signed Desktop executable.");
  const signer = signatureInfo(embeddedExecutable);
  if (signer.status !== "Valid") throw new Error(`Embedded Runtime executable signature is ${signer.status}.`);
  if (normalize(signer.thumbprint) !== expectedThumbprint) throw new Error("Embedded Runtime executable signer thumbprint does not match the independently configured value.");
  if (expectedSubject && !signer.subject.includes(expectedSubject)) throw new Error("Embedded Runtime executable signer subject does not match the independently configured value.");
  if (!signer.codeSigningEku) throw new Error("Embedded Runtime executable signer lacks the Code Signing EKU.");
  if (!signer.timestamped) throw new Error("Embedded Runtime executable lacks a verifiable RFC 3161 timestamp.");

  const signatureCheck = spawnSync(process.execPath, ["scripts/verify-windows-signatures.mjs"], {
    cwd: root, encoding: "utf8", windowsHide: true,
    env: { ...process.env, REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1", EXPECTED_WINDOWS_SIGNER_THUMBPRINT: expectedThumbprint, EXPECTED_WINDOWS_SIGNER_SUBJECT: expectedSubject },
  });
  if (signatureCheck.error || signatureCheck.status !== 0) throw new Error(signatureCheck.stderr || signatureCheck.stdout || signatureCheck.error?.message || "Strict signature verification failed.");

  const packageJson = readJson(join(artifactRoot, "package.json"));
  const manifest = readJson(join(artifactRoot, "release", "latest-windows.json"));
  const summary = readJson(join(artifactRoot, "release", "release-summary.json"));
  if (manifest.version !== packageJson.version || summary.version !== packageJson.version) throw new Error("Package, manifest and release-summary versions differ.");
  const artifacts = [
    artifact("desktopExecutable", "release/win-unpacked/OpenDrSai.exe", desktopExecutable, { authenticodeVerified: true }),
    artifact("runtimeZip", "release/bootstrapper/OpenDrSaiRuntime-win-x64.zip", runtimeZip, { containsSignedDesktopExecutable: true, manifestDigestVerified: manifest.runtime?.sha256 === sha256(runtimeZip) }),
    artifact("msi", "release/bootstrapper/OpenDrSaiSetup-win-x64.msi", msi, { authenticodeVerified: true }),
  ];
  if (!artifacts[1].manifestDigestVerified) throw new Error("Runtime ZIP digest does not match latest-windows.json.");
  const evidence = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), signed: true,
    packageVersion: packageJson.version, manifestVersion: manifest.version, releaseSummaryVersion: summary.version, versionConsistencyVerified: true,
    artifacts, certificateSource: "Pfx", certificateStoreLocation: "CurrentUser",
    signerThumbprint: signer.thumbprint, signerSubject: signer.subject, signerIssuer: signer.issuer,
    certificateNotAfter: signer.notAfter, timestampUrl: process.env.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com",
    codeSigningEku: true, immediateAuthenticodeVerification: true, timestampVerified: true, passwordPersisted: false,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Windows signing evidence generated: ${output}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }

function artifact(kind, path, absolute, extra) { return { kind, path, sizeBytes: statSync(absolute).size, sha256: sha256(absolute), ...extra }; }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function normalize(value) { return String(value).replace(/[^0-9a-f]/gi, "").toUpperCase(); }
function extractRuntimeExecutable(archive, destination) {
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${archive.replace(/'/g, "''")}'); try {$e=@($z.Entries|?{($_.FullName-replace '\\\\','/')-eq 'app/OpenDrSai.exe'})[0]; if(-not $e){throw 'Runtime executable missing'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,'${destination.replace(/'/g, "''")}', $true)} finally {$z.Dispose()}`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
}
function signatureInfo(path) {
  const escaped = path.replace(/'/g, "''");
  const command = `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; $eku=@($s.SignerCertificate.Extensions|?{$_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]}|%{$_.EnhancedKeyUsages}|?{$_.Value -eq '1.3.6.1.5.5.7.3.3'}).Count -gt 0; [pscustomobject]@{status=[string]$s.Status;thumbprint=$s.SignerCertificate.Thumbprint;subject=$s.SignerCertificate.Subject;issuer=$s.SignerCertificate.Issuer;notAfter=$s.SignerCertificate.NotAfter.ToUniversalTime().ToString('o');codeSigningEku=$eku;timestamped=[bool]$s.TimeStamperCertificate}|ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true }));
}
