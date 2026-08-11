import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("DMG notarization requires macOS.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dmg = resolve(process.argv[2] || join(root, "release", `OpenDrSai-macOS-v${packageJson.version}-arm64.dmg`));
assert.ok(existsSync(dmg), `DMG is missing: ${dmg}`);

const key = required("APPLE_API_KEY");
const keyId = required("APPLE_API_KEY_ID");
const issuer = required("APPLE_API_ISSUER");
const submission = JSON.parse(run("/usr/bin/xcrun", ["notarytool", "submit", dmg, "--key", key, "--key-id", keyId, "--issuer", issuer, "--wait", "--output-format", "json"]));
assert.equal(submission.status, "Accepted", `Apple rejected DMG notarization submission ${submission.id || "<unknown>"}: ${submission.message || submission.status}`);
await runWithRetry("/usr/bin/xcrun", ["stapler", "staple", dmg], 5);
const validation = await runWithRetry("/usr/bin/xcrun", ["stapler", "validate", dmg], 5);
assert.match(validation, /worked|valid/i, "Stapled DMG ticket did not validate.");

const evidencePath = join(root, "build", "acceptance", "dmg-notarization.json");
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  testId: "dmg-notarization",
  platform: `${process.platform}-${process.arch}`,
  passed: true,
  version: packageJson.version,
  submissionId: submission.id,
  status: submission.status,
  dmgSha256: createHash("sha256").update(readFileSync(dmg)).digest("hex"),
  stapled: true,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
console.log(`DMG notarization and stapling passed: ${dmg}; submission ${submission.id}.`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for DMG notarization.`);
  return value;
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 });
}

async function runWithRetry(command, args, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return run(command, args); }
    catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = 5_000 * 2 ** (attempt - 1);
      console.warn(`${args.slice(0, 2).join(" ")} attempt ${attempt} failed; retrying in ${delayMs}ms.`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError;
}
