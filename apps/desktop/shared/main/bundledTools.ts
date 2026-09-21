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
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Environment variable the Python side treats as an explicit ripgrep override. */
export const RIPGREP_ENV_VAR = "DRSAI_RG_PATH";

/**
 * Environment variable the Python side reads as the *seed source* for the
 * bundled built-in Skill catalogue.
 *
 * This deliberately does NOT reuse `SYSTEM_SKILLS_DIR`. That variable means
 * "the live built-in catalogue to sync from on every launch", which made the
 * Agent re-scan and re-copy the shipped Skills into the user's directory on
 * every cold start (and re-impose them after the user edited or deleted one).
 * The Desktop wants a one-time seed instead, so it publishes the catalogue
 * under a distinct name that only the first-run seeding path reads.
 */
export const BUNDLED_SKILLS_ENV_VAR = "OPENDRSAI_BUNDLED_SKILLS_DIR";

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

/** A deployable skills root is a directory holding at least one `<skill>/SKILL.md`. */
function isSkillsCatalogue(directory: string): boolean {
  try {
    if (!statSync(directory).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(directory, "anysearch", "SKILL.md"));
}

/**
 * Absolute path of the bundled built-in Skill catalogue to seed from, or null.
 *
 * The Runtime packager stages the catalogue at `<drsai-agent>/skills/skills`.
 * `repositoryRoot` is `DRSAI_REPO`: the managed Runtime directory for a packaged
 * install, or the source checkout in development — so one candidate covers both.
 *
 * The returned path is exported to the gateway child as
 * `OPENDRSAI_BUNDLED_SKILLS_DIR`, a **seed source only**. The Desktop gateway
 * copies it into the user's `configs/skills` exactly once (guarded by a marker)
 * and never consults it again, so a user's edits and deletions stick.
 *
 * Returns null when the caller already set `OPENDRSAI_BUNDLED_SKILLS_DIR`.
 */
export function resolveBundledSkillsDir(repositoryRoot: string): string | null {
  if (process.env[BUNDLED_SKILLS_ENV_VAR]?.trim()) return null;
  const candidate = join(repositoryRoot, "skills", "skills");
  return isSkillsCatalogue(candidate) ? candidate : null;
}
