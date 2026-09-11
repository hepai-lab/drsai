import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generator = join(root, "scripts", "create-windows-channel-manifest.mjs");
const summaryGenerator = join(root, "scripts", "create-windows-channel-summary.mjs");
const publisher = readFileSync(join(root, "scripts", "publish-windows-release-to-oss.ps1"), "utf8");
const publicVerifier = readFileSync(join(root, "scripts", "verify-public-runtime-release.mjs"), "utf8");
const repoRoot = resolve(root, "..", "..", "..");
const verifyWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "windows-public-release-verify.yml"), "utf8");
const promoteWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "windows-release-promote.yml"), "utf8");
const work = mkdtempSync(join(tmpdir(), "opendrsai-windows-oss-contract-"));

try {
  const sourcePath = join(work, "source.json");
  writeFileSync(sourcePath, JSON.stringify({
    schemaVersion: 1,
    version: "1.5.8",
    buildLabel: "Beta 3",
    channel: "beta",
    publishedAt: "2026-08-13T00:00:00.000Z",
    minimumUpdaterVersion: "1.4.9",
    mandatory: false,
    requireSignature: false,
    runtime: {
      url: "https://download-opendrsai.ihep.ac.cn/releases/v1.5.8/windows/OpenDrSai-Windows-v1.5.8-x64.zip",
      sizeBytes: 355495575,
      sha256: "e710fa6d0837ec7d6f5f8109d6c9d4801736b0452c2a844dd7c70748b6fd9ea1",
    },
    releaseNotesUrl: "https://github.com/hepai-lab/drsai/releases/tag/v1.5.8",
  }, null, 2));

  const beta = generate(sourcePath, join(work, "beta.json"), "beta", "Beta 3");
  assert(beta.version === "1.5.8" && beta.channel === "beta" && beta.buildLabel === "Beta 3", "Beta manifest identity is incorrect.");
  assert(beta.runtime.sha256 === "e710fa6d0837ec7d6f5f8109d6c9d4801736b0452c2a844dd7c70748b6fd9ea1", "Beta promotion changed immutable runtime identity.");

  const stable = generate(sourcePath, join(work, "stable.json"), "stable", "");
  assert(stable.version === "1.5.8" && stable.channel === "stable", "Stable manifest identity is incorrect.");
  assert(!Object.hasOwn(stable, "buildLabel"), "Stable manifest retained a beta buildLabel.");
  assert(stable.requireSignature === true, "Stable manifest does not require signatures.");
  assert(stable.runtime.url === beta.runtime.url && stable.runtime.sizeBytes === beta.runtime.sizeBytes && stable.runtime.sha256 === beta.runtime.sha256, "Stable promotion did not reuse immutable runtime bytes.");

  const sourceSummary = join(work, "release-summary.json");
  writeFileSync(sourceSummary, JSON.stringify({
    product: "OpenDrSai Windows", version: "1.5.8", buildLabel: "Beta 3",
    distribution: { releaseTier: "beta", publicDistributionReady: true, requiresSignedInstallers: false },
    artifacts: [
      { path: "bootstrapper/OpenDrSai-Windows-v1.5.8-Installer-x64.msi", signatureStatus: "NotSigned" },
      { path: "bootstrapper/OpenDrSai-Windows-v1.5.8-x64.zip", signatureStatus: "NotSigned" },
    ],
  }));
  const stableSummary = generateSummary(sourceSummary, join(work, "release-summary-stable.json"), "stable", "");
  assert(!Object.hasOwn(stableSummary, "buildLabel"), "Stable release summary retained a beta buildLabel.");
  assert(stableSummary.distribution.releaseTier === "stable" && stableSummary.distribution.requiresSignedInstallers === true, "Stable release summary policy is incorrect.");
  assert(stableSummary.distribution.publicDistributionReady === false, "Unsigned stable release summary was incorrectly marked public-ready.");

  const versionUpload = publisher.indexOf("ossutil cp MSI ->");
  const immutableVerify = publisher.indexOf("Immutable public asset verification failed");
  const channelUpload = publisher.indexOf("ossutil cp channel manifest LAST ->");
  assert(versionUpload >= 0 && immutableVerify > versionUpload && channelUpload > immutableVerify, "Publisher does not stage and verify immutable assets before channel mutation.");
  assert(publisher.includes("--ignore-existing") && publisher.includes("verify identity") && publisher.includes("--force --cache-control \"no-cache,max-age=0\""), "Publisher immutability/mutable-cache contract is missing.");
  assert(publisher.includes("Stable promotion is blocked until the MSI and runtime executable have valid Authenticode signatures."), "Publisher does not block unsigned stable promotion before upload.");
  assert(publisher.includes("refresh-aliyun-cdn-object.ps1") && publisher.indexOf("refresh-aliyun-cdn-object.ps1", channelUpload) > channelUpload, "Publisher does not refresh CDN after mutable channel upload.");
  assert(publicVerifier.includes('response.status === 206') && publicVerifier.includes('content-range') && publicVerifier.includes("OPENDRSAI_LOCAL_ARTIFACT_ROOT"), "Public verifier lacks strict Range or byte-identity validation.");
  assert(publicVerifier.includes("verifyDownloadedSignatureEvidence"), "Public verifier does not verify downloaded signature evidence.");
  assert(verifyWorkflow.includes('OPENDRSAI_RELEASE_SUMMARY_URL=https://download-opendrsai.ihep.ac.cn/releases/$tag/windows/release-summary-$channel.json'), "Public workflow does not bind the channel-specific OSS summary.");
  assert(verifyWorkflow.includes("node --use-system-ca scripts/verify-public-runtime-release.mjs"), "Public workflow does not use the strict Windows system trust store.");
  assert(promoteWorkflow.includes('$channel = "stable"') && promoteWorkflow.includes("OSS $channel pointer must be promoted and verified before publishing the GitHub release."), "GitHub promotion is not gated on the stable OSS channel pointer.");
  assert(promoteWorkflow.includes('buildLabel') && promoteWorkflow.includes('requireSignature'), "Stable workflow does not reject beta labels or unsigned manifests.");
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("Windows OSS publishing contract verification passed.");

function generate(source, output, channel, label) {
  execFileSync(process.execPath, [generator], {
    env: {
      ...process.env,
      OPENDRSAI_SOURCE_UPDATE_MANIFEST: source,
      OPENDRSAI_CHANNEL_MANIFEST_PATH: output,
      OPENDRSAI_UPDATE_CHANNEL: channel,
      OPENDRSAI_BUILD_LABEL: label,
      OPENDRSAI_RELEASE_PUBLISHED_AT: "2026-08-14T00:00:00.000Z",
    },
    stdio: "pipe",
    windowsHide: true,
  });
  return JSON.parse(readFileSync(output, "utf8"));
}

function generateSummary(source, output, channel, label) {
  execFileSync(process.execPath, [summaryGenerator], {
    env: {
      ...process.env,
      OPENDRSAI_SOURCE_RELEASE_SUMMARY: source,
      OPENDRSAI_CHANNEL_SUMMARY_PATH: output,
      OPENDRSAI_UPDATE_CHANNEL: channel,
      OPENDRSAI_BUILD_LABEL: label,
      OPENDRSAI_RELEASE_PUBLISHED_AT: "2026-08-14T00:00:00.000Z",
    },
    stdio: "pipe",
    windowsHide: true,
  });
  return JSON.parse(readFileSync(output, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
