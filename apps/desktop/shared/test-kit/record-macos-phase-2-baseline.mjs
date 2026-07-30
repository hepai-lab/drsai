import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { macosPhase2FeatureRows } from "./macosPhase2Catalog.mjs";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(desktopRoot, "../..");
const mainPath = resolve(desktopRoot, "macos/src/main/index.ts");
const preloadPath = resolve(desktopRoot, "shared/main/preload.ts");
const outputPath = resolve(desktopRoot, "macos/build/acceptance/macos-p2-baseline.json");
const main = readFileSync(mainPath, "utf8");
const preload = readFileSync(preloadPath, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const channels = (source, patterns) => [...new Set(patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1])))].sort();
const mainChannels = channels(macosIpcSource(desktopRoot), [/ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g]);
const preloadChannels = channels(preload, [/ipcRenderer\.invoke\(\s*["'](desktop:[^"']+)["']/g]);
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

const report = {
  schemaVersion: 1,
  phase: 2,
  recordedAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain").length > 0,
  platform: `${process.platform}-${process.arch}`,
  scope: { modules: 10, features: macosPhase2FeatureRows.length },
  composition: {
    mainIndexLines: main.split(/\r?\n/).length,
    mainIndexSha256: sha256(main),
    mainIpcChannels: mainChannels.length,
    preloadIpcChannels: preloadChannels.length,
    missingMainChannels: preloadChannels.filter((channel) => !mainChannels.includes(channel)),
  },
  signing: { developerIdAvailable: false, status: "unverified", note: "Signing availability must be supplied by signed RC evidence, never inferred by this baseline." },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
