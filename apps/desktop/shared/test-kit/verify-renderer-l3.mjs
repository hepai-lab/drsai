import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const rendererHtml = resolve(desktopRoot, "macos/out/renderer/index.html");
const visualScript = resolve(desktopRoot, "windows/scripts/verify-renderer-visual.mjs");
const evidenceRoot = resolve(desktopRoot, "macos/build/acceptance");
const evidencePath = resolve(evidenceRoot, "l3-renderer.json");
const artifactRoot = resolve(evidenceRoot, "renderer-l3-artifacts");
if (!existsSync(rendererHtml)) throw new Error("Build the macOS renderer before running the L3 integration gate.");
rmSync(evidencePath, { force: true });
mkdirSync(artifactRoot, { recursive: true });

await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [visualScript], {
    cwd: resolve(desktopRoot, "windows"),
    env: {
      ...process.env,
      OPENDRSAI_RENDERER_HTML: rendererHtml,
      OPENDRSAI_RENDERER_L3_ONLY: "1",
      OPENDRSAI_RENDERER_DISABLED_FEATURES: "agents,serialVoice,streamingVoice,approvals,browser,debugger,mcp,remoteWorkspace,channels,diagnostics,codexBackend",
      OPENDRSAI_VISUAL_ARTIFACT_DIR: artifactRoot,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`L3 renderer process failed (${signal || code}).`)));
});

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
mkdirSync(evidenceRoot, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  level: "L3",
  testId: "verify:renderer-l3",
  commit,
  platform: `${process.platform}-${process.arch}`,
  passed: true,
  checks: ["real-electron-render", "keyboard-only-navigation", "capability-fail-closed", "responsive-overflow", "axe-wcag2a-aa-serious-critical-zero"],
  artifact: "renderer-l3-artifacts/l3-capability-gating.png",
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`L3 renderer evidence written: ${evidencePath}`);
