// Resolution of executables that ship inside the desktop payload instead of
// being expected on the user's PATH.
//
// Windows has no usable ripgrep equivalent, so `rg.exe` is vendored under
// `apps/desktop/windows/resources/tools/ripgrep` and shipped with the app. The
// Python agent tool (`operater_funs.py` grep) prefers it over its own fallback,
// and the desktop main process tells it where that copy lives by exporting
// `DRSAI_RG_PATH` into the gateway child environment. The Python resolver still
// probes PATH and its own bundled candidates, so the TUI and an unpackaged CLI
// install work without this module.
import { statSync } from "node:fs";
import { join } from "node:path";

/** Environment variable the Python side treats as an explicit ripgrep override. */
export const RIPGREP_ENV_VAR = "DRSAI_RG_PATH";

/** Payload-relative directory of the vendored ripgrep release. */
export const BUNDLED_RIPGREP_SEGMENTS = ["resources", "tools", "ripgrep"] as const;

/** Electron's `resources` directory, absent when this module runs under plain Node. */
function electronResourcesPath(): string | null {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Directory of the running main bundle, or null outside a CJS main-process build. */
function mainBundleDirectory(): string | null {
  // `typeof` keeps an ESM bundle (e.g. a verify harness) from throwing.
  return typeof __dirname === "string" ? __dirname : null;
}

/**
 * Candidate locations for a bundled executable, most specific first:
 *
 * 1. `<resources>/app.asar.unpacked/<segments>` — `resources/**` is listed in
 *    both `files` and `asarUnpack`, so the packaged app keeps the file next to
 *    `resources/backend/backend-source.json` rather than inside the archive.
 * 2. `<resources>/<segments>` — the layout the Runtime packager uses for tools
 *    it injects itself (see `resources/tools/openssh/ssh.exe`).
 * 3. `<repo>/apps/desktop/windows/<segments>` — the source checkout, resolved
 *    from the main bundle at `apps/desktop/windows/out/main`.
 */
export function bundledToolCandidates(
  segments: readonly string[],
  executable: string,
): string[] {
  const candidates: string[] = [];
  const resourcesPath = electronResourcesPath();
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "app.asar.unpacked", ...segments, executable));
    candidates.push(join(resourcesPath, ...segments, executable));
  }
  const bundleDirectory = mainBundleDirectory();
  if (bundleDirectory) {
    candidates.push(join(bundleDirectory, "..", "..", ...segments, executable));
  }
  return candidates;
}

function isRunnableFile(candidate: string): boolean {
  try {
    const stats = statSync(candidate);
    if (!stats.isFile()) return false;
    // POSIX builds must be executable; Windows only checks the extension.
    return process.platform === "win32" || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Absolute path of the vendored ripgrep, or null when it is not shipped here.
 *
 * Returns null when the user (or a test harness) already set `DRSAI_RG_PATH`:
 * that value is inherited by the gateway child through `process.env`, and an
 * explicit override must not be silently replaced by the bundled copy.
 */
export function resolveBundledRipgrep(): string | null {
  if (process.env[RIPGREP_ENV_VAR]?.trim()) return null;
  const executable = process.platform === "win32" ? "rg.exe" : "rg";
  for (const candidate of bundledToolCandidates(BUNDLED_RIPGREP_SEGMENTS, executable)) {
    if (isRunnableFile(candidate)) return candidate;
  }
  return null;
}
