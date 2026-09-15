import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Previous macOS release preparation requires Apple Silicon macOS.");
const currentTag = process.env.OPENDRSAI_RELEASE_TAG?.trim() || process.env.GITHUB_REF_NAME?.trim();
assert.ok(currentTag, "OPENDRSAI_RELEASE_TAG or GITHUB_REF_NAME is required");
const cdn = new URL(process.env.OPENDRSAI_MACOS_CDN_BASE_URL?.trim() || "https://download-opendrsai.ihep.ac.cn/");
assert.equal(cdn.protocol, "https:");
const temp = resolve(process.env.RUNNER_TEMP || "/tmp", `opendrsai-previous-${process.env.GITHUB_RUN_ID || process.pid}`);
mkdirSync(temp, { recursive: true });
const download = join(temp, "download");
const expanded = join(temp, "expanded");
mkdirSync(download, { recursive: true });
mkdirSync(expanded, { recursive: true });
const metadataUrl = new URL("channels/stable/macos/arm64/latest-mac.yml", cdn);
const metadata = fetchBytes(metadataUrl);
const metadataText = metadata.toString("utf8");
const previousVersion = capture(metadataText, /^version:\s*([^\s]+)\s*$/m, "version");
const previousTag = `v${previousVersion}`;
assert.notEqual(previousTag, currentTag, "The stable OSS feed already points at the current release tag.");
const zipName = capture(metadataText, /^path:\s*(.+?)\s*$/m, "path");
assert.match(zipName, /^OpenDrSai-macOS-v[^/]+-arm64\.zip$/);
const expectedSha512 = capture(metadataText, /^sha512:\s*([^\s]+)\s*$/m, "sha512");
const expectedSize = Number(capture(metadataText, /^\s+size:\s*(\d+)\s*$/m, "size"));
assert.ok(Number.isSafeInteger(expectedSize) && expectedSize > 0, "Previous release ZIP size is invalid.");
const zipUrl = new URL(`channels/stable/macos/arm64/${zipName}`, cdn);
const zipPath = join(download, zipName);
await downloadFile(zipUrl, zipPath, expectedSize);
assert.equal(statSync(zipPath).size, expectedSize, "Previous release ZIP size differs from stable metadata.");
const actualSha512 = createHash("sha512").update(readFileSync(zipPath)).digest("base64");
assert.equal(actualSha512, expectedSha512, "Previous release ZIP SHA-512 differs from stable metadata.");
run("/usr/bin/ditto", ["-x", "-k", zipPath, expanded]);
const app = findApp(expanded);
assert.ok(app && existsSync(app), "Previous release ZIP did not contain OpenDrSai.app");
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const envFile = process.env.GITHUB_ENV;
assert.ok(envFile, "GITHUB_ENV is required");
appendFileSync(envFile, `OPENDRSAI_MACOS_L6_PREVIOUS_APP=${app}\nOPENDRSAI_MACOS_L6_PREVIOUS_TAG=${previousTag}\n`, "utf8");
console.log(`Prepared previous signed macOS release ${previousTag} from OSS/CDN: ${app}`);

function findApp(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory() && entry.name === "OpenDrSai.app") return candidate;
    if (entry.isDirectory()) { const nested = findApp(candidate); if (nested) return nested; }
  }
  return null;
}
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000 }); if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`); return result.stdout; }
function fetchBytes(url) { return Buffer.from(run("/usr/bin/curl", ["-fsS", "--proto", "=https", "--tlsv1.2", "--max-time", "30", url.toString()])); }
async function downloadFile(url, path, size) {
  const partCount = 8;
  const partSize = Math.ceil(size / partCount);
  const parts = [];
  for (let index = 0; index < partCount; index += 1) {
    const start = index * partSize;
    const end = Math.min(size - 1, start + partSize - 1);
    if (start > end) break;
    const part = `${path}.part-${index}`;
    parts.push({ part, start, end });
  }
  try {
    await Promise.all(parts.map(({ part, start, end }) => new Promise((resolvePart, rejectPart) => {
      const child = spawn("/usr/bin/curl", ["-fsS", "--proto", "=https", "--tlsv1.2", "--max-time", "600", "--range", `${start}-${end}`, "--output", part, url.toString()], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", rejectPart);
      child.once("exit", (code) => code === 0 ? resolvePart() : rejectPart(new Error(`/usr/bin/curl range ${start}-${end} failed: ${stderr}`)));
    })));
    for (const { part, start, end } of parts) assert.equal(statSync(part).size, end - start + 1, `Range ${start}-${end} returned an unexpected size.`);
    writeFileSync(path, Buffer.alloc(0), { mode: 0o600 });
    for (const { part } of parts) appendFileSync(path, readFileSync(part));
  } finally {
    for (const { part } of parts) rmSync(part, { force: true });
  }
}
function capture(text, pattern, label) { const match = text.match(pattern); assert.ok(match, `Stable metadata omits ${label}.`); return match[1].trim(); }
