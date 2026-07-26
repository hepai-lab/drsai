import { strict as assert } from "node:assert";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Previous macOS release preparation requires Apple Silicon macOS.");
const currentTag = process.env.GITHUB_REF_NAME?.trim();
assert.ok(currentTag, "GITHUB_REF_NAME is required");
const temp = resolve(process.env.RUNNER_TEMP || "/tmp", `opendrsai-previous-${process.env.GITHUB_RUN_ID || process.pid}`);
mkdirSync(temp, { recursive: true });
const releases = JSON.parse(run("gh", ["release", "list", "--limit", "50", "--json", "tagName,isDraft,isPrerelease,publishedAt"]));
const previous = releases.find((release) => release.tagName !== currentTag && release.isDraft === false && release.isPrerelease === false);
assert.ok(previous, "A previous stable signed macOS release is required for the L6 update/rollback gate.");
const download = join(temp, "download");
const expanded = join(temp, "expanded");
mkdirSync(download, { recursive: true });
mkdirSync(expanded, { recursive: true });
run("gh", ["release", "download", previous.tagName, "--pattern", "*-arm64-mac.zip", "--dir", download]);
const zips = readdirSync(download).filter((name) => name.endsWith(".zip"));
assert.equal(zips.length, 1, `Expected one previous arm64 mac ZIP, found ${zips.length}`);
run("/usr/bin/ditto", ["-x", "-k", join(download, zips[0]), expanded]);
const app = findApp(expanded);
assert.ok(app && existsSync(app), "Previous release ZIP did not contain OpenDrSai.app");
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const envFile = process.env.GITHUB_ENV;
assert.ok(envFile, "GITHUB_ENV is required");
appendFileSync(envFile, `OPENDRSAI_MACOS_L6_PREVIOUS_APP=${app}\nOPENDRSAI_MACOS_L6_PREVIOUS_TAG=${previous.tagName}\n`, "utf8");
console.log(`Prepared previous signed macOS release ${previous.tagName}: ${app}`);

function findApp(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory() && entry.name === "OpenDrSai.app") return candidate;
    if (entry.isDirectory()) { const nested = findApp(candidate); if (nested) return nested; }
  }
  return null;
}
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000 }); if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`); return result.stdout; }
