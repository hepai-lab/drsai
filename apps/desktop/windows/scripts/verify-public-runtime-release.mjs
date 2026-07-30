import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const baseUrl = String(process.env.OPENDRSAI_RELEASE_BASE_URL || "").replace(/\/+$/, "");
const metadataBaseUrl = String(process.env.OPENDRSAI_RELEASE_METADATA_BASE_URL || baseUrl).replace(/\/+$/, "");
const manifestUrl = String(
  process.env.OPENDRSAI_UPDATE_MANIFEST_URL ||
  "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json",
);
const fullDownload = process.env.VERIFY_PUBLIC_RELEASE_DOWNLOAD === "1";
const expectedThumbprint = normalizeThumbprint(process.env.EXPECTED_WINDOWS_SIGNER_THUMBPRINT || "");
if (!new RegExp(`^https://download-opendrsai\\.ihep\\.ac\\.cn/releases/v${escapeRegExp(packageJson.version)}/windows$`, "i").test(baseUrl)) {
  throw new Error("OPENDRSAI_RELEASE_BASE_URL must be the versioned OpenDrSai Windows CDN directory.");
}

const runtimeArchiveName = `OpenDrSai-Windows-v${packageJson.version}-x64.zip`;
const installerName = "OpenDrSai-Windows-Installer-x64.msi";
const manifest = await fetchJson(manifestUrl);
const summary = await fetchJson(`${metadataBaseUrl}/release-summary.json`);
assert(manifest.schemaVersion === 1, "Public update manifest schema is unsupported.");
assert(manifest.version === packageJson.version, "Public update manifest version does not match package.json.");
const isPrereleaseVersion = packageJson.version.includes("-");
assert(
  manifest.channel !== "stable" || isPrereleaseVersion || manifest.requireSignature === true,
  "Stable-version public update does not require signatures.",
);
assert(manifest.runtime?.url === `${baseUrl}/${runtimeArchiveName}`, "Runtime URL is not the immutable versioned CDN URL.");
assert(summary.version === manifest.version, "Public release summary version does not match the update manifest.");
assert(summary.distribution?.publicDistributionReady === true, "Public release summary does not permit distribution.");
assert(summary.distribution?.releaseTier === (isPrereleaseVersion ? "preview" : "stable"), "Public release tier is incorrect.");

const summaryArtifacts = new Map((summary.artifacts || []).map((item) => [item.path, item]));
const assets = [
  { name: installerName, summaryPath: `bootstrapper/${installerName}` },
  { name: runtimeArchiveName, summaryPath: `bootstrapper/${runtimeArchiveName}` },
];
for (const asset of assets) {
  assert(summaryArtifacts.has(asset.summaryPath), `Release summary is missing ${asset.summaryPath}.`);
  await assertReachable(`${baseUrl}/${asset.name}`);
}

if (fullDownload) {
  const work = mkdtempSync(join(tmpdir(), "opendrsai-public-release-"));
  try {
    for (const asset of assets) {
      const destination = join(work, asset.name);
      await download(`${baseUrl}/${asset.name}`, destination);
      const described = summaryArtifacts.get(asset.summaryPath);
      const hash = await sha256(destination);
      assert(statSync(destination).size === described.sizeBytes, `${asset.name} size does not match release-summary.json.`);
      assert(hash === described.sha256, `${asset.name} SHA-256 does not match release-summary.json.`);
      if (asset.name === runtimeArchiveName) {
        assert(statSync(destination).size === manifest.runtime.sizeBytes, "Runtime size does not match latest-windows.json.");
        assert(hash === manifest.runtime.sha256, "Runtime SHA-256 does not match latest-windows.json.");
      }
    }
    if (manifest.requireSignature) verifyDownloadedSignatures(work, expectedThumbprint);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`Public runtime release verification passed${fullDownload ? " with full hash/signature checks" : " with metadata/reachability checks"}.`);

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  assert(response.ok, `${basename(url)} returned HTTP ${response.status}.`);
  return response.json();
}

async function assertReachable(url) {
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  assert(response.ok, `${basename(url)} returned HTTP ${response.status}.`);
  await response.body?.cancel();
}

async function download(url, destination) {
  const response = await fetch(url);
  assert(response.ok && response.body, `${basename(url)} download returned HTTP ${response.status}.`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function sha256(path) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function verifyDownloadedSignatures(work, thumbprint) {
  if (process.platform !== "win32") throw new Error("Stable Windows signatures must be verified on Windows.");
  if (!thumbprint) throw new Error("EXPECTED_WINDOWS_SIGNER_THUMBPRINT is required for stable public verification.");
  const runtime = join(work, runtimeArchiveName);
  const appExe = join(work, "OpenDrSai.exe");
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z=[IO.Compression.ZipFile]::OpenRead(${quote(runtime)})`,
    `try{$e=@($z.Entries|Where-Object{($_.FullName -replace '\\\\','/') -eq 'app/OpenDrSai.exe'})[0];if(-not $e){throw 'Runtime app executable missing.'};[IO.Compression.ZipFileExtensions]::ExtractToFile($e,${quote(appExe)},$true)}finally{$z.Dispose()}`,
    `$paths=@(${quote(join(work, installerName))},${quote(appExe)})`,
    `foreach($p in $paths){$s=Get-AuthenticodeSignature -LiteralPath $p;if($s.Status -ne 'Valid' -or -not $s.SignerCertificate){throw \"Invalid signature: $p ($($s.Status))\"};if(($s.SignerCertificate.Thumbprint -replace '[^0-9A-Fa-f]','').ToUpperInvariant() -ne '${thumbprint}'){throw \"Unexpected signer: $p\"}}`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, stdio: "inherit" });
}

function normalizeThumbprint(value) { return value.replace(/[^0-9a-f]/gi, "").toUpperCase(); }
function quote(value) { return `'${value.replace(/'/g, "''")}'`; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
