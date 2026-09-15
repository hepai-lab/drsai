// Verifies the V2 dev launcher wiring end-to-end, from the .cmd entry point
// down to the Electron main/preload/renderer entry files that electron-vite
// actually builds.
//
// This script used to assert against the M3 "workbench" surface
// (`src/main/workbench.ts`, `src/preload/workbench.ts`,
// `shared/main/desktopGateway/preload.ts`), all of which were removed when the
// desktop shell collapsed onto `shared/main/preload.ts`. It also asserted that
// the preload must NOT contain `openDrSai`, which is the opposite of the truth:
// `shared/main/preload.ts` exposes exactly `window.openDrSai`. Both mistakes are
// corrected here, and every path below is asserted to exist before it is read.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(windowsRoot, "../../..");

function read(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  assert.ok(existsSync(absolutePath), `expected ${relativePath} to exist`);
  return readFileSync(absolutePath, "utf8");
}

function assertContains(haystack, needle, label) {
  assert.ok(
    haystack.includes(needle),
    `${label} must contain ${JSON.stringify(needle)}`,
  );
}

function assertOmits(haystack, needle, label) {
  assert.ok(
    !haystack.includes(needle),
    `${label} must not contain ${JSON.stringify(needle)}`,
  );
}

// ── Files under test (all must exist) ───────────────────────────────────
const launcherEntry = read("apps/desktop/windows-desktop-dev.cmd");
const launcher = read("apps/desktop/windows/scripts/dev.ps1");
const electronViteConfig = read("apps/desktop/windows/electron.vite.config.ts");
const packageJson = read("apps/desktop/windows/package.json");
const rendererHtml = read("apps/desktop/shared/renderer/index.html");
const mainEntry = read("apps/desktop/windows/src/main/index.ts");
const preloadEntry = read("apps/desktop/windows/src/preload/index.ts");
const bridgePreload = read("apps/desktop/shared/main/preload.ts");
const desktopPaths = read("apps/desktop/shared/main/desktopPaths.ts");

// ── Launcher entry (windows-desktop-dev.cmd) ────────────────────────────
assertContains(launcherEntry, "-LaunchMode Development", "launcher entry");
assertContains(launcherEntry, "%*", "launcher entry");
// Dev/Prod share one gateway port in V2; the .cmd pins it before dev.ps1 runs.
assertContains(launcherEntry, 'set "DRSAI_DESKTOP_GATEWAY_PORT=28643"', "launcher entry");
assertContains(launcherEntry, 'set "OPENDRSAI_DEV_GATEWAY_PORT=28643"', "launcher entry");
// V2: Electron owns desktop_gateway, so the legacy management flags are cleared.
assertContains(launcherEntry, 'set "DRSAI_GATEWAY_DEV_MANAGED="', "launcher entry");
assertContains(launcherEntry, 'set "DRSAI_GATEWAY_HOT_RELOAD="', "launcher entry");
// OIDC-only auth boundary: static API keys are scrubbed, never assigned.
assertContains(launcherEntry, 'set "OPENDRSAI_OIDC_ONLY=1"', "launcher entry");
assertContains(launcherEntry, 'set "HEPAI_API_KEY="', "launcher entry");

// ── dev.ps1 ─────────────────────────────────────────────────────────────
assertContains(launcher, "$env:DRSAI_REPO = $RepoRoot", "dev.ps1");
assertContains(launcher, "$env:OPENDRSAI_RUNTIME_ROOT = $InstallDir", "dev.ps1");
assertContains(launcher, '".drsai-prod" } else { ".drsai-dev"', "dev.ps1");
assertContains(launcher, "[int]$GatewayPort = 0", "dev.ps1");
assertContains(launcher, "$GatewayPort = 28643", "dev.ps1");
assertContains(launcher, "desktop_gateway", "dev.ps1");
assertContains(launcher, "$env:OPENDRSAI_ELECTRON_USER_DATA = $ElectronUserData", "dev.ps1");
assertContains(launcher, "$env:OPENDRSAI_DEV_HOME = $DrsaiHome", "dev.ps1");
assertContains(launcher, "$env:OPENDRSAI_DEV_GATEWAY_PORT = [string]$GatewayPort", "dev.ps1");
assertContains(launcher, "$GatewayEnabled = -not $NoGateway", "dev.ps1");
assertContains(launcher, '$env:OPENDRSAI_RUNTIME_PERSIST = "0"', "dev.ps1");
assertContains(launcher, "$env:OPENDRSAI_DESKTOP_LAUNCH_MODE = $LaunchModeName", "dev.ps1");
assertContains(launcher, "React/CSS hot module replacement", "dev.ps1");
assertContains(launcher, "node_modules\\@electron-toolkit\\utils\\package.json", "dev.ps1");
assertContains(launcher, "node_modules\\@electron-toolkit\\preload\\package.json", "dev.ps1");

// V2: no legacy gateway hot-reload flag or -HotLoad parameter.
assertOmits(launcher, "-HotLoad", "dev.ps1");
assertOmits(launcher, "$GatewayHotReload", "dev.ps1");
assertOmits(launcher, "HotLoad starts the legacy uvicorn", "dev.ps1");

// V2: no Tailwind native binding repair step in the launcher.
assertOmits(launcher, "Repair-TailwindNativeBinding", "dev.ps1");
assertOmits(launcher, "@tailwindcss", "dev.ps1");

// ── electron.vite.config.ts ─────────────────────────────────────────────
assertContains(electronViteConfig, 'host: "127.0.0.1"', "electron.vite.config.ts");
assertContains(electronViteConfig, "react()", "electron.vite.config.ts");
// The renderer is shared with the macOS shell and is built with Tailwind.
assertContains(electronViteConfig, 'root: resolve("../shared/renderer")', "electron.vite.config.ts");
assertContains(electronViteConfig, 'input: resolve("../shared/renderer/index.html")', "electron.vite.config.ts");
// The preload build entry must stay the shim that re-exports shared/main/preload.
assertContains(electronViteConfig, 'index: resolve("src/preload/index.ts")', "electron.vite.config.ts");
// better-sqlite3 is a native module: never bundled.
assertContains(electronViteConfig, 'external: ["better-sqlite3"]', "electron.vite.config.ts");

// ── package.json ────────────────────────────────────────────────────────
assertContains(packageJson, '"dev"', "package.json");
assertContains(packageJson, '"typecheck"', "package.json");
assertContains(packageJson, '"build"', "package.json");
assertContains(packageJson, "electron-vite build", "package.json");
assertOmits(packageJson, "dev:legacy", "package.json");
assertOmits(packageJson, "build:legacy", "package.json");
// The dev-startup check must remain self-registered so CI keeps running it.
assertContains(
  packageJson,
  '"verify:dev-workspace-startup": "node scripts/verify-dev-workspace-startup.mjs"',
  "package.json",
);

// ── Renderer HTML (the entry electron-vite actually builds) ─────────────
assertContains(rendererHtml, 'src="/src/main.tsx"', "shared/renderer/index.html");
assertContains(rendererHtml, "connect-src", "shared/renderer/index.html");
assertContains(rendererHtml, "127.0.0.1", "shared/renderer/index.html");

// ── Main entry (windows/src/main/index.ts) ──────────────────────────────
// The first import must be the dev environment bootstrap, otherwise the shell
// reads `DRSAI_HOME`/gateway env before dev.ps1's values are copied across.
assert.ok(
  mainEntry.replace(/^\uFEFF/, "").startsWith('import "./developmentLaunchEnvironment";'),
  "main entry must begin with the developmentLaunchEnvironment import",
);
assertContains(mainEntry, 'import { DRSAI_HOME, DRSAI_REPO } from "./paths"', "main entry");
assertContains(mainEntry, "from \"./gateway\"", "main entry");
// Main must load the compiled preload shim produced by the vite preload build.
assertContains(mainEntry, 'preload: join(__dirname, "../preload/index.js")', "main entry");

// ── Preload (V2 bridge) ─────────────────────────────────────────────────
// The platform preload entry is a thin deprecated shim onto the shared bridge.
assertContains(preloadEntry, 'import "../../../shared/main/preload"', "windows/src/preload/index.ts");
assertContains(bridgePreload, 'contextBridge.exposeInMainWorld("openDrSai"', "shared/main/preload.ts");
assertContains(bridgePreload, "ipcRenderer", "shared/main/preload.ts");
assertOmits(bridgePreload, 'exposeInMainWorld("drsai"', "shared/main/preload.ts");

// ── desktopPaths.ts ────────────────────────────────────────────────────
assertContains(
  desktopPaths,
  "environment.OPENDRSAI_RUNTIME_ROOT?.trim() || repository",
  "shared/main/desktopPaths.ts",
);

console.log("✅ verify-dev-workspace-startup: all assertions passed");
