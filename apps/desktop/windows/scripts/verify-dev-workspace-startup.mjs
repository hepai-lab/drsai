import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(windowsRoot, "../../..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

const launcherEntry = read("apps/desktop/windows-desktop-dev.cmd");
const launcher = read("apps/desktop/windows/scripts/dev.ps1");
const electronViteConfig = read("apps/desktop/windows/electron.vite.config.ts");
const packageJson = read("apps/desktop/windows/package.json");
const rendererHtml = read("apps/desktop/shared/renderer/workbench.html");
const workbenchMain = read("apps/desktop/windows/src/main/workbench.ts");
const preload = read("apps/desktop/windows/src/preload/workbench.ts");
const bridgePreload = read("apps/desktop/shared/main/desktopGateway/preload.ts");
const desktopPaths = read("apps/desktop/shared/main/desktopPaths.ts");

// ── Launcher entry ──────────────────────────────────────────────────────
assert.ok(launcherEntry.includes("-LaunchMode Development"));
assert.ok(launcherEntry.includes("%*"));

// ── dev.ps1 ─────────────────────────────────────────────────────────────
assert.ok(launcher.includes('$env:DRSAI_REPO = $RepoRoot'));
assert.ok(launcher.includes('$env:OPENDRSAI_RUNTIME_ROOT = $InstallDir'));
assert.ok(launcher.includes('".drsai-prod" } else { ".drsai-dev"'));
assert.ok(launcher.includes('[int]$GatewayPort = 0'));
assert.ok(launcher.includes('$GatewayPort = 28643'));
assert.ok(launcher.includes('desktop_gateway'));
assert.ok(launcher.includes('$env:OPENDRSAI_ELECTRON_USER_DATA = $ElectronUserData'));
assert.ok(launcher.includes('$env:OPENDRSAI_DEV_HOME = $DrsaiHome'));
assert.ok(launcher.includes('$env:OPENDRSAI_DEV_GATEWAY_PORT = [string]$GatewayPort'));
assert.ok(launcher.includes('$GatewayEnabled = -not $NoGateway'));
assert.ok(launcher.includes('$env:OPENDRSAI_RUNTIME_PERSIST = "0"'));
assert.ok(launcher.includes('$env:OPENDRSAI_DESKTOP_LAUNCH_MODE = $LaunchModeName'));
assert.ok(launcher.includes("React/CSS hot module replacement"));
assert.ok(launcher.includes('node_modules\\@electron-toolkit\\utils\\package.json'));
assert.ok(launcher.includes('node_modules\\@electron-toolkit\\preload\\package.json'));

// V2: no legacy gateway hot-reload or -HotLoad parameter
assert.ok(!launcher.includes('-HotLoad'));
assert.ok(!launcher.includes('$GatewayHotReload'));
assert.ok(!launcher.includes('HotLoad starts the legacy uvicorn'));

// V2: no Tailwind native binding repair (pure CSS, no Tailwind)
assert.ok(!launcher.includes('Repair-TailwindNativeBinding'));
assert.ok(!launcher.includes('@tailwindcss'));

// ── electron.vite.config.ts ─────────────────────────────────────────────
assert.ok(electronViteConfig.includes('host: "127.0.0.1"'));
assert.ok(electronViteConfig.includes('react()'));
assert.ok(!electronViteConfig.includes('tailwindcss'));

// ── package.json ────────────────────────────────────────────────────────
assert.ok(packageJson.includes('"dev"'));
assert.ok(packageJson.includes('"typecheck"'));
assert.ok(packageJson.includes('"build"'));
assert.ok(packageJson.includes('electron-vite build'));
assert.ok(!packageJson.includes('dev:legacy'));
assert.ok(!packageJson.includes('build:legacy'));

// ── Renderer HTML ───────────────────────────────────────────────────────
assert.ok(rendererHtml.includes('ws://127.0.0.1:') || rendererHtml.includes('127.0.0.1'));

// ── Main entry ──────────────────────────────────────────────────────────
assert.ok(workbenchMain.includes('import "./auth"'), 'workbench.ts must import "./auth"');

// ── Preload (V2 bridge) ─────────────────────────────────────────────────
assert.ok(preload.includes('workbench'), 'preload entry should be workbench.ts');
assert.ok(bridgePreload.includes('contextBridge.exposeInMainWorld("drsai"'),
    'bridge preload must expose window.drsai');
assert.ok(bridgePreload.includes('DesktopBridge'),
    'bridge preload must use DesktopBridge type');
assert.ok(!bridgePreload.includes('openDrSai'),
    'bridge preload must not use legacy openDrSai name');

// ── desktopPaths.ts ────────────────────────────────────────────────────
assert.ok(desktopPaths.includes('environment.OPENDRSAI_RUNTIME_ROOT?.trim() || repository'));

console.log("✅ verify-dev-workspace-startup: all assertions passed");
