import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRANDING_REVISION = 3;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const requireFromLauncher = createRequire(import.meta.url);

function resolvePackageRoot(packageName) {
  return dirname(requireFromLauncher.resolve(`${packageName}/package.json`));
}

const TRANSIENT_FS_CODES = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);
const COPY_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000];

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientFsRetries(label, action) {
  let lastError;
  for (let attempt = 0; attempt <= COPY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const code = error?.code;
      if (!TRANSIENT_FS_CODES.has(code) || attempt >= COPY_RETRY_DELAYS_MS.length) throw error;
      const delayMs = COPY_RETRY_DELAYS_MS[attempt];
      console.warn(`Retrying ${label} after ${code} (attempt ${attempt + 1}/${COPY_RETRY_DELAYS_MS.length}, wait ${delayMs}ms)`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function prepareBrandedElectron() {
  if (process.platform !== "win32") return undefined;

  const electronRoot = resolvePackageRoot("electron");
  const electronPackage = JSON.parse(await readFile(join(electronRoot, "package.json"), "utf8"));
  const appPackage = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  const executableName = (await readFile(join(electronRoot, "path.txt"), "utf8")).trim();
  const sourceDist = join(electronRoot, "dist");
  const cacheName = `electron-${electronPackage.version}-opendrsai-${appPackage.version}-${BRANDING_REVISION}`;
  const brandedDist = join(appDir, ".cache", "branded-electron", cacheName);
  const brandedExecutable = join(brandedDist, executableName);
  const markerPath = join(brandedDist, ".opendrsai-branding.json");
  if (existsSync(brandedExecutable) && existsSync(markerPath)) return brandedExecutable;

  const temporaryDist = `${brandedDist}.tmp-${process.pid}`;
  await withTransientFsRetries("remove branded electron temp", () =>
    rm(temporaryDist, { recursive: true, force: true }));
  await mkdir(dirname(brandedDist), { recursive: true });
  // Sweep leftover *.tmp-* dirs from earlier failed/interrupted branding runs (common EPERM source on Windows).
  const cacheRoot = dirname(brandedDist);
  if (existsSync(cacheRoot)) {
    for (const entry of await readdir(cacheRoot)) {
      if (!entry.includes(".tmp-")) continue;
      await withTransientFsRetries(`remove stale branded temp ${entry}`, () =>
        rm(join(cacheRoot, entry), { recursive: true, force: true })).catch(() => undefined);
    }
  }
  await withTransientFsRetries("copy electron runtime for branding", async () => {
    await rm(temporaryDist, { recursive: true, force: true });
    await cp(sourceDist, temporaryDist, { recursive: true, force: true });
  });

  const rcedit = join(resolvePackageRoot("electron-winstaller"), "vendor", "rcedit.exe");
  if (!existsSync(rcedit)) throw new Error(`Windows branding tool was not found: ${rcedit}`);
  const result = spawnSync(rcedit, [
    join(temporaryDist, executableName),
    "--set-version-string", "ProductName", "OpenDrSai",
    "--set-version-string", "FileDescription", "OpenDrSai",
    "--set-version-string", "InternalName", "OpenDrSai",
    "--set-version-string", "OriginalFilename", "OpenDrSai.exe",
    "--set-file-version", appPackage.version,
    "--set-product-version", appPackage.version,
    "--set-icon", join(appDir, "build", "icon.ico"),
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    await rm(temporaryDist, { recursive: true, force: true });
    throw new Error(`Could not brand the Electron development runtime: ${result.stderr || result.stdout}`);
  }

  await writeFile(join(temporaryDist, ".opendrsai-branding.json"), `${JSON.stringify({
    electronVersion: electronPackage.version,
    appVersion: appPackage.version,
    brandingRevision: BRANDING_REVISION,
  }, null, 2)}\n`, "utf8");
  await withTransientFsRetries("replace branded electron cache", async () => {
    await rm(brandedDist, { recursive: true, force: true });
    await rename(temporaryDist, brandedDist);
  });
  return brandedExecutable;
}

const command = process.argv[2] || "dev";
const brandedElectron = await prepareBrandedElectron();
if (process.argv.includes("--prepare-only")) {
  process.stdout.write(`${brandedElectron || "not-required"}\n`);
  process.exit(0);
}

const electronVite = join(resolvePackageRoot("electron-vite"), "bin", "electron-vite.js");
const child = spawn(process.execPath, [electronVite, command, ...process.argv.slice(3)], {
  cwd: appDir,
  env: {
    ...process.env,
    ...(brandedElectron ? { ELECTRON_EXEC_PATH: brandedElectron } : {}),
  },
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", (error) => {
  console.error(`Could not start Electron Vite: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`Electron Vite exited after signal ${signal}.`);
  process.exitCode = code ?? 1;
});
