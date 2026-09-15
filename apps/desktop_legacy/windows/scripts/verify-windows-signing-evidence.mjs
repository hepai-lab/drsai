import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const artifactRoot = process.env.OPENDRSAI_WINDOWS_ARTIFACT_ROOT ? resolve(process.env.OPENDRSAI_WINDOWS_ARTIFACT_ROOT) : root;
const evidencePath = process.env.OPENDRSAI_WINDOWS_SIGNING_EVIDENCE
  || join(artifactRoot, "release", "product-evidence", "remote-workspace", "windows-signatures.json");
let evidence;
try { evidence = readJson(evidencePath, "Windows signing evidence"); }
catch (error) {
  console.error(`Windows signing evidence verification failed:\n- ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const packageJson = readJson(join(artifactRoot, "package.json"), "package metadata");
const manifest = readJson(join(artifactRoot, "release", "latest-windows.json"), "Windows update manifest");
const summary = readJson(join(artifactRoot, "release", "release-summary.json"), "release summary");
const failures = [];
let fallbackRoot = "";
let fallbackDesktopExecutable = "";

if (evidence.schemaVersion !== 1 || evidence.signed !== true) failures.push("evidence is not a signed schemaVersion 1 record");
if (!evidence.versionConsistencyVerified) failures.push("version consistency is not verified");
for (const [label, version] of [["package", evidence.packageVersion], ["manifest", evidence.manifestVersion], ["release summary", evidence.releaseSummaryVersion]]) {
  if (version !== packageJson.version) failures.push(`${label} evidence version ${version || "<missing>"} does not match package ${packageJson.version}`);
}
if (manifest.version !== packageJson.version || summary.version !== packageJson.version) failures.push("current manifest or release summary version drifted after signing");
if (!/^[A-F0-9]{40}$/i.test(String(evidence.signerThumbprint || ""))) failures.push("signer thumbprint is missing or invalid");
if (!String(evidence.signerSubject || "").trim()) failures.push("signer subject is missing");
if (!String(evidence.signerIssuer || "").trim()) failures.push("signer issuer is missing");
if (!Number.isFinite(Date.parse(evidence.certificateNotAfter)) || Date.parse(evidence.certificateNotAfter) <= Date.now()) failures.push("signing certificate expiry is missing or expired");
if (!/^(Pfx|Store)$/.test(String(evidence.certificateSource || ""))) failures.push("certificate source is invalid");
if (!/^(CurrentUser|LocalMachine)$/.test(String(evidence.certificateStoreLocation || ""))) failures.push("certificate store location is invalid");
if (evidence.codeSigningEku !== true || evidence.immediateAuthenticodeVerification !== true) failures.push("Code Signing EKU or immediate Authenticode verification is not recorded");
if (evidence.passwordPersisted !== false) failures.push("password persistence invariant is missing");
if (!/^https?:\/\//i.test(String(evidence.timestampUrl || ""))) failures.push("RFC 3161 timestamp URL is missing");
if (evidence.timestampVerified !== true) failures.push("actual RFC 3161 timestamp verification is missing");

const expectedArtifacts = new Map([
  ["desktopExecutable", { path: "release/win-unpacked/OpenDrSai.exe", authenticodeVerified: true }],
  ["runtimeZip", { path: "release/bootstrapper/OpenDrSaiRuntime-win-x64.zip", containsSignedDesktopExecutable: true, manifestDigestVerified: true }],
  ["msi", { path: "release/bootstrapper/OpenDrSaiSetup-win-x64.msi", authenticodeVerified: true }],
]);
const artifacts = Array.isArray(evidence.artifacts) ? evidence.artifacts : [];
if (artifacts.length !== expectedArtifacts.size) failures.push(`evidence contains ${artifacts.length}/${expectedArtifacts.size} required artifacts`);
for (const [kind, contract] of expectedArtifacts) {
  const artifact = artifacts.find((item) => item?.kind === kind);
  if (!artifact) { failures.push(`${kind} evidence is missing`); continue; }
  if (artifact.path !== contract.path) failures.push(`${kind} path ${artifact.path || "<missing>"} is invalid`);
  let absolute = join(artifactRoot, ...contract.path.split("/"));
  if (kind === "desktopExecutable" && !existsSync(absolute)) {
    fallbackRoot ||= mkdtempSync(join(tmpdir(), "opendrsai-signing-evidence-verify-"));
    fallbackDesktopExecutable ||= join(fallbackRoot, "OpenDrSai.exe");
    try {
      extractRuntimeExecutable(join(artifactRoot, "release", "bootstrapper", "OpenDrSaiRuntime-win-x64.zip"), fallbackDesktopExecutable);
      absolute = fallbackDesktopExecutable;
    } catch (error) {
      failures.push(`desktopExecutable fallback extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const bytes = readFileSync(absolute);
    const details = statSync(absolute);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (artifact.sizeBytes !== details.size) failures.push(`${kind} size drifted from ${artifact.sizeBytes} to ${details.size}`);
    if (artifact.sha256 !== digest) failures.push(`${kind} SHA-256 drifted from signed evidence`);
  } catch (error) {
    failures.push(`${kind} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [flag, required] of Object.entries(contract).filter(([name]) => name !== "path")) {
    if (required === true && artifact[flag] !== true) failures.push(`${kind} ${flag} is not verified`);
  }
}
const runtime = artifacts.find((item) => item?.kind === "runtimeZip");
if (runtime && manifest.runtime?.sha256 !== runtime.sha256) failures.push("Runtime ZIP digest does not match latest-windows.json");
for (const item of summary.artifacts || []) {
  const matching = artifacts.find((artifact) => artifact.path.endsWith(String(item.path || "").replace(/\\/g, "/")));
  if (matching && matching.sha256 !== item.sha256) failures.push(`${matching.kind} digest does not match release-summary.json`);
}

const signatureCheck = spawnSync(process.execPath, ["scripts/verify-windows-signatures.mjs"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  env: {
    ...process.env,
    REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1",
    EXPECTED_WINDOWS_SIGNER_THUMBPRINT: String(evidence.signerThumbprint || ""),
    EXPECTED_WINDOWS_SIGNER_SUBJECT: String(evidence.signerSubject || ""),
  },
});
if (signatureCheck.error || signatureCheck.status !== 0) failures.push(`current Authenticode verification failed: ${signatureCheck.stderr || signatureCheck.stdout || signatureCheck.error?.message || signatureCheck.status}`);

if (failures.length) {
  if (fallbackRoot) rmSync(fallbackRoot, { recursive: true, force: true });
  console.error(["Windows signing evidence verification failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}
if (fallbackRoot) rmSync(fallbackRoot, { recursive: true, force: true });
console.log(JSON.stringify({ status: "passed", version: packageJson.version, signerThumbprint: evidence.signerThumbprint, artifacts: artifacts.length, digestsVerified: true, authenticodeVerified: true }, null, 2));

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`); }
}

function extractRuntimeExecutable(archive, destination) {
  const escapedArchive = archive.replace(/'/g, "''");
  const escapedDestination = destination.replace(/'/g, "''");
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${escapedArchive}'); try {$e=@($z.Entries|?{($_.FullName-replace '\\\\','/')-eq 'app/OpenDrSai.exe'})[0]; if(-not $e){throw 'Runtime executable missing'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,'${escapedDestination}', $true)} finally {$z.Dispose()}`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
}
