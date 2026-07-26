import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testKitDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKitDir, "../..");
const sharedRoot = join(desktopRoot, "shared");
const windowsRoot = join(desktopRoot, "windows");
const macosRoot = join(desktopRoot, "macos");
const retiredDesktopRoot = join(desktopRoot, "drsai-desktop");
const retiredInstallersRoot = join(desktopRoot, "installers");
const retiredScriptsRoot = join(desktopRoot, "scripts");
const failures = [];

if (existsSync(retiredDesktopRoot)) {
  fail(retiredDesktopRoot, "retired Hermes client must stay outside the formal desktop product tree");
}
if (existsSync(retiredInstallersRoot)) {
  fail(retiredInstallersRoot, "installer assets must live under their owning platform shell; only genuinely platform-neutral APIs belong under shared");
}
if (existsSync(retiredScriptsRoot)) {
  fail(retiredScriptsRoot, "desktop scripts must live under their owning platform shell; repository-level entrypoints may only be thin wrappers");
}
if (!existsSync(join(windowsRoot, "installer"))) {
  fail(windowsRoot, "Windows installer implementation is missing from windows/installer");
}
if (!existsSync(join(windowsRoot, "installer", "contract", "manifest.schema.json"))) {
  fail(windowsRoot, "Windows Runtime manifest contract is missing from windows/installer/contract");
}
if (!existsSync(join(windowsRoot, "scripts", "dev.ps1"))) {
  fail(windowsRoot, "Windows development launcher is missing from windows/scripts");
}
if (!existsSync(join(macosRoot, "scripts", "dev.sh"))) {
  fail(macosRoot, "macOS development launcher is missing from macos/scripts");
}
if (existsSync(join(sharedRoot, "api", "installer"))) {
  fail(sharedRoot, "Windows-specific installer contracts must not be placed under shared/api");
}
const workspacePackage = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
if ((workspacePackage.workspaces ?? []).some((entry) => entry.includes("legacy") || entry.includes("drsai-desktop"))) {
  fail(join(desktopRoot, "package.json"), "legacy desktop must not participate in the npm workspace");
}

function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles(root) {
  return walk(root).filter((path) => [".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(path)));
}

function fail(path, message) {
  failures.push(`${relative(desktopRoot, path).replaceAll("\\", "/")}: ${message}`);
}

const productSharedRoots = [
  join(sharedRoot, "api"),
  join(sharedRoot, "main"),
  join(sharedRoot, "renderer"),
];
for (const path of [join(sharedRoot, "main"), join(windowsRoot, "src", "main")].flatMap(sourceFiles)) {
  if (path.endsWith("durableJsonStore.ts")) continue;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.includes("readDurableJson(") && !line.includes("maxBytes:")) {
      fail(path, `durable JSON read at line ${index + 1} must declare an explicit maxBytes resource boundary`);
    }
    if (line.includes("writeDurableJson(") && !line.includes("maxBytes:")) {
      fail(path, `durable JSON write at line ${index + 1} must declare an explicit maxBytes resource boundary`);
    }
  }
}
for (const path of productSharedRoots.flatMap(sourceFiles)) {
  const source = readFileSync(path, "utf8");
  if (/from\s+["'][^"']*(?:windows|macos)\//.test(source)) {
    fail(path, "shared code must not import a platform shell");
  }
  if (/apps\/desktop\/(?:windows|macos)|\.\.\/(?:windows|macos)(?:\/|["'])/.test(source)) {
    fail(path, "shared code contains a platform-shell path reference");
  }
}

for (const [platformName, platformRoot, siblingName] of [
  ["windows", windowsRoot, "macos"],
  ["macos", macosRoot, "windows"],
]) {
  for (const path of sourceFiles(join(platformRoot, "src"))) {
    const source = readFileSync(path, "utf8");
    const siblingReference = new RegExp(`(?:apps/desktop/|\\.\\./)${siblingName}(?:/|["'])`);
    if (siblingReference.test(source)) {
      fail(path, `${platformName} shell must not import or address the ${siblingName} shell`);
    }
  }
}

for (const platformRoot of [windowsRoot, macosRoot]) {
  for (const path of sourceFiles(join(platformRoot, "src", "main"))) {
    const source = readFileSync(path, "utf8");
    if (/from\s+["'][^"']*shared\/renderer/.test(source)) {
      fail(path, "platform main must not import renderer implementation");
    }
  }
}

const sharedMainRoot = join(sharedRoot, "main");
const forbiddenMainPatterns = [
  [/(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*["']powershell(?:\.exe)?["']/i, "PowerShell command"],
  [/(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*["']cmd\.exe["']/i, "cmd.exe command"],
  [/(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*["']wsl\.exe["']/i, "WSL command"],
  [/\bDPAPI\b/i, "DPAPI implementation"],
  [/(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*["']security["']|security\s+(?:add|find|delete)-generic-password/i, "Keychain implementation"],
];
for (const path of sourceFiles(sharedMainRoot)) {
  const source = readFileSync(path, "utf8");
  for (const [pattern, label] of forbiddenMainPatterns) {
    if (pattern.test(source)) fail(path, `shared main contains ${label}`);
  }
}

const rendererRoot = join(sharedRoot, "renderer");
for (const path of sourceFiles(rendererRoot)) {
  const source = readFileSync(path, "utf8");
  if (/from\s+["'](?:node:|electron["'])|\brequire\(["'](?:node:|electron["'])/.test(source)) {
    fail(path, "shared renderer must not import Node or Electron APIs");
  }
  if (/\bipcRenderer\b/.test(source)) {
    fail(path, "shared renderer must use the preload API, not ipcRenderer");
  }
}

const inventoryPath = join(testKitDir, "migration-inventory.json");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const trackedSources = new Set(inventory.entries.map((entry) => entry.source.replaceAll("\\", "/")));
const legacySharedRoot = join(windowsRoot, "src", "shared");
for (const path of walk(legacySharedRoot).filter((item) => [".ts", ".tsx"].includes(extname(item)))) {
  const source = relative(legacySharedRoot, path).replaceAll("\\", "/");
  if (!trackedSources.has(source)) fail(path, "missing from shared API migration inventory");
}
for (const entry of inventory.entries) {
  const sourcePath = join(legacySharedRoot, entry.source);
  const targetPath = join(sharedRoot, "api", entry.target);
  if (entry.status === "pending" && !existsSync(sourcePath)) {
    fail(inventoryPath, `pending source does not exist: ${entry.source}`);
  }
  if (entry.status === "migrated" && !existsSync(targetPath)) {
    fail(inventoryPath, `migrated target does not exist: ${entry.target}`);
  }
}

const mainInventoryPath = join(testKitDir, "main-migration-inventory.json");
const mainInventory = JSON.parse(readFileSync(mainInventoryPath, "utf8"));
for (const entry of mainInventory.entries) {
  const targetPath = join(sharedMainRoot, entry);
  const compatibilityPath = join(windowsRoot, "src", "main", entry);
  if (!existsSync(targetPath)) fail(mainInventoryPath, `shared main target does not exist: ${entry}`);
  if (!existsSync(compatibilityPath)) fail(mainInventoryPath, `Windows compatibility entrypoint does not exist: ${entry}`);
  else if (!readFileSync(compatibilityPath, "utf8").includes("@deprecated M3 compatibility entrypoint")) {
    fail(compatibilityPath, "M3 compatibility entrypoint must carry an explicit removal marker");
  }
}

const windowsMainIndex = readFileSync(join(windowsRoot, "src", "main", "index.ts"), "utf8");
const macosMainIndex = readFileSync(join(macosRoot, "src", "main", "index.ts"), "utf8");
if (!windowsMainIndex.includes('from "../../../shared/main/secureIpc"')) {
  fail(join(windowsRoot, "src", "main", "index.ts"), "Windows must reuse the shared IPC trust boundary");
}
if (!macosMainIndex.includes('from "../../../shared/main/secureIpc"')) {
  fail(join(macosRoot, "src", "main", "index.ts"), "macOS must reuse the shared IPC trust boundary");
}

if (!existsSync(macosRoot)) {
  // macOS is introduced in M4; absence is allowed until then.
}

if (failures.length) {
  console.error("Desktop architecture boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Desktop architecture boundaries verified (${inventory.entries.length} API and ${mainInventory.entries.length} main migration entries).`);
