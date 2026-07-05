import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const baseUrl = process.env.OPENDRSAI_RELEASE_BASE_URL;
const fullDownload = process.env.VERIFY_PUBLIC_RELEASE_DOWNLOAD === "1";
const expectedThumbprint = normalizeThumbprint(process.env.EXPECTED_WINDOWS_SIGNER_THUMBPRINT || "");
const expectedSubject = (process.env.EXPECTED_WINDOWS_SIGNER_SUBJECT || "").trim();
const expectedSetup = `OpenDrSai-${packageJson.version}-setup.exe`;
const requiredAssets = [
  expectedSetup,
  `${expectedSetup}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  "release-summary.json",
  "OpenDrSai Installer.exe",
];
const summarizedAssets = [
  expectedSetup,
  `${expectedSetup}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  "OpenDrSai Installer.exe",
];

if (!baseUrl) {
  throw new Error("Set OPENDRSAI_RELEASE_BASE_URL to the public GitHub Release asset base URL.");
}
if (!expectedThumbprint) {
  throw new Error("Set EXPECTED_WINDOWS_SIGNER_THUMBPRINT before verifying a public Windows release.");
}

const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
const expectedInstallerUrl = `${normalizedBaseUrl}/${encodeURIComponent(expectedSetup)}`;
const manifest = await fetchJson(`${normalizedBaseUrl}/latest-windows.json`);
const installerUrl = new URL(manifest.installer);
const installerName = decodeURIComponent(basename(installerUrl.pathname));

if (manifest.version !== packageJson.version) {
  throw new Error(`Public manifest version ${manifest.version} does not match ${packageJson.version}.`);
}
if (installerName !== expectedSetup) {
  throw new Error(`Public manifest installer ${installerName} does not match ${expectedSetup}.`);
}
if (manifest.installer !== expectedInstallerUrl) {
  throw new Error("Public manifest installer URL does not point at this release asset.");
}
if (!/^[a-f0-9]{64}$/i.test(manifest.sha256 || "")) {
  throw new Error("Public manifest sha256 is missing or invalid.");
}
if (!Number.isInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0) {
  throw new Error("Public manifest sizeBytes is missing or invalid.");
}

const latestYml = await fetchText(`${normalizedBaseUrl}/latest.yml`);
const latest = parseLatestYml(latestYml);
if (!latestYml.includes(`version: ${packageJson.version}`)) {
  throw new Error("Public latest.yml version does not match package.json.");
}
if (latest.path !== expectedSetup || latest.fileUrl !== expectedSetup) {
  throw new Error("Public latest.yml does not reference the expected setup exe.");
}
if (latest.size !== manifest.sizeBytes) {
  throw new Error("Public latest.yml size does not match latest-windows.json.");
}
if (!latest.sha512 || latest.sha512 !== latest.fileSha512) {
  throw new Error("Public latest.yml sha512 fields are missing or inconsistent.");
}

for (const assetName of requiredAssets) {
  await assertReachable(`${normalizedBaseUrl}/${encodeURIComponent(assetName)}`, assetName);
}

const bootstrapperBytes = Buffer.from(
  await fetchArrayBuffer(`${normalizedBaseUrl}/${encodeURIComponent("OpenDrSai Installer.exe")}`),
);
verifyBootstrapper(bootstrapperBytes, `${normalizedBaseUrl}/latest-windows.json`);

const summary = await fetchJson(`${normalizedBaseUrl}/release-summary.json`);
await verifyPublicSummary(summary);

if (fullDownload) {
  const bytes = Buffer.from(await fetchArrayBuffer(manifest.installer));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  if (bytes.length !== manifest.sizeBytes) {
    throw new Error(`Downloaded setup size ${bytes.length} does not match ${manifest.sizeBytes}.`);
  }
  if (sha256 !== manifest.sha256) {
    throw new Error("Downloaded setup sha256 does not match latest-windows.json.");
  }
  if (sha512 !== latest.sha512) {
    throw new Error("Downloaded setup sha512 does not match public latest.yml.");
  }
  verifyDownloadedSetupSignature(bytes);
}

console.log(
  `Public Windows release verified for ${expectedSetup}${fullDownload ? " with full download" : ""}.`,
);

async function assertReachable(url, label) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (response.ok) return;
  const fallback = await fetch(url, {
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  });
  if (!fallback.ok && fallback.status !== 206) {
    throw new Error(`Public release asset is not reachable: ${label} (${fallback.status})`);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  return response.arrayBuffer();
}

async function verifyPublicSummary(summary) {
  if (summary.version !== packageJson.version) {
    throw new Error("Public release-summary.json version does not match package.json.");
  }
  if (JSON.stringify(summary.manifest) !== JSON.stringify(manifest)) {
    throw new Error("Public release-summary.json manifest snapshot does not match latest-windows.json.");
  }
  if (!summary.distribution || summary.distribution.requiresSignedExecutables !== true) {
    throw new Error("Public release-summary.json is missing executable signing distribution policy.");
  }
  if (summary.distribution.publicDistributionReady !== true) {
    throw new Error("Public release-summary.json does not mark the release as ready for public distribution.");
  }
  if ((summary.distribution.unsignedArtifacts || []).length !== 0) {
    throw new Error("Public release-summary.json lists unsigned executable artifacts.");
  }
  const artifacts = new Map((summary.artifacts || []).map((artifact) => [artifact.path, artifact]));
  for (const assetName of summarizedAssets) {
    const normalized = assetName === "OpenDrSai Installer.exe" ? "bootstrapper/OpenDrSai Installer.exe" : assetName;
    const artifact = artifacts.get(normalized);
    if (!artifact?.exists) {
      throw new Error(`Public release-summary.json is missing ${normalized}.`);
    }
    const urlName = normalized === "bootstrapper/OpenDrSai Installer.exe" ? "OpenDrSai Installer.exe" : normalized;
    const bytes = Buffer.from(await fetchArrayBuffer(`${normalizedBaseUrl}/${encodeURIComponent(urlName)}`));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (artifact.sizeBytes !== bytes.length) {
      throw new Error(`Public release-summary.json size for ${normalized} does not match the public asset.`);
    }
    if (artifact.sha256 !== sha256) {
      throw new Error(`Public release-summary.json sha256 for ${normalized} does not match the public asset.`);
    }
  }
  for (const exeName of [expectedSetup, "bootstrapper/OpenDrSai Installer.exe"]) {
    const artifact = artifacts.get(exeName);
    if (artifact?.signatureStatus !== "Valid") {
      throw new Error(`Public release-summary.json signature status for ${exeName} is not Valid.`);
    }
  }
}

function parseLatestYml(content) {
  return {
    path: scalar(content, "path"),
    sha512: scalar(content, "sha512"),
    fileUrl: matchRequired(content, /^\s*-\s+url:\s*(.+)$/m, "files[0].url"),
    fileSha512: matchRequired(content, /^\s+sha512:\s*(.+)$/m, "files[0].sha512"),
    size: Number(matchRequired(content, /^\s+size:\s*(\d+)$/m, "files[0].size")),
  };
}

function scalar(content, key) {
  return matchRequired(content, new RegExp(`^${key}:\\s*(.+)$`, "m"), key);
}

function matchRequired(content, pattern, label) {
  const match = content.match(pattern);
  if (!match?.[1]) throw new Error(`Public latest.yml is missing ${label}.`);
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function verifyBootstrapper(bytes, expectedManifestUrl) {
  if (!bufferContains(bytes, expectedManifestUrl)) {
    throw new Error("Public bootstrapper does not contain the expected release manifest URL.");
  }
  if (process.platform !== "win32") return;

  const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-public-"));
  const exePath = join(tempDir, "OpenDrSai Installer.exe");
  try {
    writeFileSync(exePath, bytes);
    assertExpectedSignature(exePath, "Public bootstrapper");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyDownloadedSetupSignature(bytes) {
  if (process.platform !== "win32") return;

  const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-setup-"));
  const exePath = join(tempDir, expectedSetup);
  try {
    writeFileSync(exePath, bytes);
    assertExpectedSignature(exePath, "Public full setup");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function bufferContains(bytes, value) {
  return (
    bytes.includes(Buffer.from(value, "utf8")) ||
    bytes.includes(Buffer.from(value, "utf16le"))
  );
}

function assertExpectedSignature(path, label) {
  const signature = getSignatureInfo(path);
  if (signature.status !== "Valid") {
    throw new Error(`${label} signature is not valid: ${signature.status}`);
  }
  if (expectedThumbprint && normalizeThumbprint(signature.thumbprint) !== expectedThumbprint) {
    throw new Error(`${label} signer thumbprint ${signature.thumbprint || "<missing>"} does not match EXPECTED_WINDOWS_SIGNER_THUMBPRINT.`);
  }
  if (expectedSubject && !signature.subject.includes(expectedSubject)) {
    throw new Error(`${label} signer subject ${signature.subject || "<missing>"} does not include EXPECTED_WINDOWS_SIGNER_SUBJECT.`);
  }
}

function getSignatureInfo(path) {
  const command = [
    `$sig = Get-AuthenticodeSignature -LiteralPath ${quotePowerShellString(path)}`,
    "$thumbprint = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { '' }",
    "$subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }",
    "[pscustomobject]@{ Status = [string]$sig.Status; Thumbprint = $thumbprint; Subject = $subject } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const parsed = JSON.parse(output);
  return {
    status: String(parsed.Status || ""),
    thumbprint: String(parsed.Thumbprint || ""),
    subject: String(parsed.Subject || ""),
  };
}

function normalizeThumbprint(value) {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
