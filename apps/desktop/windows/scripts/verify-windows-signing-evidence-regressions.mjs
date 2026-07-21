import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const packageJson = read("package.json");
const temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-signing-evidence-regression-"));
const baseEvidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  signed: true,
  packageVersion: packageJson.version,
  manifestVersion: packageJson.version,
  releaseSummaryVersion: packageJson.version,
  versionConsistencyVerified: true,
  artifacts: [
    artifact("desktopExecutable", "release/win-unpacked/OpenDrSai.exe", { authenticodeVerified: true }),
    artifact("runtimeZip", "release/bootstrapper/OpenDrSaiRuntime-win-x64.zip", { containsSignedDesktopExecutable: true, manifestDigestVerified: true }),
    artifact("msi", "release/bootstrapper/OpenDrSaiSetup-win-x64.msi", { authenticodeVerified: true }),
  ],
  certificateSource: "Store",
  certificateStoreLocation: "CurrentUser",
  signerThumbprint: "A".repeat(40),
  signerSubject: "CN=OpenDrSai Signing Regression",
  signerIssuer: "CN=OpenDrSai Signing Regression",
  certificateNotAfter: new Date(Date.now() + 86_400_000).toISOString(),
  timestampUrl: "https://timestamp.example.invalid",
  timestampVerified: true,
  codeSigningEku: true,
  immediateAuthenticodeVerification: true,
  passwordPersisted: false,
};

try {
  verify(baseEvidence, /current Authenticode verification failed/);
  const changedDigest = structuredClone(baseEvidence);
  changedDigest.artifacts.find((item) => item.kind === "msi").sha256 = "0".repeat(64);
  verify(changedDigest, /msi SHA-256 drifted from signed evidence/);
  const changedVersion = structuredClone(baseEvidence);
  changedVersion.packageVersion = "0.0.0";
  verify(changedVersion, /package evidence version 0\.0\.0 does not match package/);
  const missingTimestamp = structuredClone(baseEvidence);
  missingTimestamp.timestampVerified = false;
  verify(missingTimestamp, /actual RFC 3161 timestamp verification is missing/);
  console.log("Windows signing evidence regressions passed (unsigned artifact + digest drift + version drift + missing timestamp rejected).");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function artifact(kind, relativePath, flags) {
  const absolute = join(root, ...relativePath.split("/"));
  const bytes = readFileSync(absolute);
  return { kind, path: relativePath, sizeBytes: statSync(absolute).size, sha256: createHash("sha256").update(bytes).digest("hex"), ...flags };
}

function verify(evidence, expectedFailure) {
  const path = join(temporaryRoot, `${crypto.randomUUID()}.json`);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const result = spawnSync(process.execPath, ["scripts/verify-windows-signing-evidence.mjs"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, OPENDRSAI_WINDOWS_SIGNING_EVIDENCE: path },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) throw result.error;
  if (result.status === 0 || !expectedFailure.test(output)) throw new Error(`Invalid signing evidence was not rejected as expected: ${output}`);
}

function read(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}
