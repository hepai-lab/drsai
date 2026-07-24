import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Native Helper XCTest requires Apple Silicon macOS.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(root, "native/OpenDrSaiNativeHelper");
const moduleCache = resolve(root, "build/swift-module-cache");
mkdirSync(moduleCache, { recursive: true });
const xcode = run("/usr/bin/xcodebuild", ["-version"]);
const xctest = run("/usr/bin/xcrun", ["--find", "xctest"]).trim();
if (!xctest.startsWith("/Applications/Xcode.app/Contents/Developer/")) throw new Error(`xctest is not provided by the selected full Xcode: ${xctest}`);
const output = run("/usr/bin/swift", ["test", "--package-path", packagePath], {
  CLANG_MODULE_CACHE_PATH: moduleCache,
  SWIFTPM_MODULECACHE_OVERRIDE: moduleCache,
});
const match = output.match(/Executed (\d+) tests?, with 0 failures/);
if (!match || Number(match[1]) < 7) throw new Error("Swift XCTest did not report the required seven passing protocol tests.");
const acceptance = resolve(root, "build/acceptance/native-helper-xctest.json");
mkdirSync(resolve(root, "build/acceptance"), { recursive: true });
writeFileSync(acceptance, `${JSON.stringify({ schemaVersion: 1, testId: "native-helper-xctest", platform: "darwin-arm64", passed: true, featureIds: ["F01.2", "F02.2"], testCount: Number(match[1]), failures: 0, xcode: xcode.trim().split(/\r?\n/), xctest, generatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Native Helper XCTest passed (${match[1]} tests, ${xcode.trim().replace(/\r?\n/g, ", ")}).`);

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...environment } });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})\n${output}`);
  return output;
}
