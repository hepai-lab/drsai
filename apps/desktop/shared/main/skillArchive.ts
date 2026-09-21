/**
 * Shared helpers: validate skill folders / ZIP archives and materialize into
 * the gateway user skills directory.
 */

import { execFile } from "child_process";
import { existsSync, type Dirent } from "fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, cp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { promisify } from "util";
import {
  installSkill,
  listInstalledSkills,
  reloadSkills,
} from "./gatewayManagedResources";
import { DRSAI_HOME } from "./paths";

const execFileAsync = promisify(execFile);

export function sanitizeInstallName(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(cleaned)) {
    throw new Error(`Invalid skill install name: ${value}`);
  }
  return cleaned;
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  if (process.platform === "win32") {
    const ps = [
      "$ErrorActionPreference='Stop'",
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destDir)} -Force`,
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return;
  }
  await execFileAsync("unzip", ["-o", zipPath, "-d", destDir], {
    maxBuffer: 8 * 1024 * 1024,
  });
}

const SKILL_MD_NAMES = ["SKILL.md", "skill.md", "Skill.md"] as const;

async function dirHasSkillMd(dir: string): Promise<boolean> {
  for (const name of SKILL_MD_NAMES) {
    if (existsSync(join(dir, name))) return true;
  }
  // Case-insensitive fallback (e.g. Skill.MD on case-sensitive volumes).
  try {
    const entries = await readdir(dir);
    return entries.some((name) => name.toLowerCase() === "skill.md");
  } catch {
    return false;
  }
}

/**
 * Locate the skill root that contains SKILL.md.
 * Handles GitHub zip layouts like:
 *   revealjs-skill-main/revealjs-skill-main/skills/revealjs/SKILL.md
 */
export async function findSkillRoot(extractDir: string): Promise<string> {
  if (await dirHasSkillMd(extractDir)) return extractDir;

  const skipDir = (name: string) =>
    name === "__MACOSX" ||
    name === ".git" ||
    name === ".venv" ||
    name === "venv" ||
    name.startsWith(".");

  const queue: Array<{ dir: string; depth: number }> = [{ dir: extractDir, depth: 0 }];
  const seen = new Set<string>();
  let visited = 0;
  const maxVisit = 400;
  const maxDepth = 8;

  while (queue.length > 0 && visited < maxVisit) {
    const { dir, depth } = queue.shift()!;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;

    if (depth > 0 && (await dirHasSkillMd(dir))) return dir;
    if (depth >= maxDepth) continue;

    let children: Dirent[];
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Prefer likely skill folders first (skills/, packages named like the zip).
    const dirs = children
      .filter((c) => c.isDirectory() && !skipDir(c.name))
      .sort((a, b) => {
        const score = (n: string) =>
          n.toLowerCase() === "skills" ? 0 : n.toLowerCase().includes("skill") ? 1 : 2;
        return score(a.name) - score(b.name) || a.name.localeCompare(b.name);
      });

    for (const child of dirs) {
      queue.push({ dir: join(dir, child.name), depth: depth + 1 });
    }
  }

  throw new Error(
    "未找到 SKILL.md。请选择「直接包含 SKILL.md」的技能文件夹" +
      "（例如 …/skills/revealjs），不要选外层的仓库根目录或仅含一层包装的文件夹。",
  );
}

async function resolveSkillMdPath(skillRoot: string): Promise<string> {
  for (const name of SKILL_MD_NAMES) {
    const p = join(skillRoot, name);
    if (existsSync(p)) return p;
  }
  try {
    const entries = await readdir(skillRoot);
    const hit = entries.find((name) => name.toLowerCase() === "skill.md");
    if (hit) return join(skillRoot, hit);
  } catch {
    /* fall through */
  }
  throw new Error("SKILL.md is missing");
}

async function resolveFallbackSkillsDir(userId?: string): Promise<string> {
  const uid = (userId || "").trim() || "default";
  return join(DRSAI_HOME, "workspace", "runs", uid, "configs", "skills");
}

export async function materializeSkillTree(
  skillRoot: string,
  installName: string,
  options: { userId?: string; threadId?: string } = {},
): Promise<{ status: string; name: string; path: string; files: number }> {
  const skillMdPath = await resolveSkillMdPath(skillRoot);
  const skillMd = await readFile(skillMdPath, "utf8");
  if (!skillMd.trim()) throw new Error("SKILL.md is empty");

  await installSkill({
    name: installName,
    content: skillMd,
    userId: options.userId,
  });

  const installed = await listInstalledSkills(options.userId);
  const targetPath =
    installed.find((item) => item.name === installName)?.path ||
    join(await resolveFallbackSkillsDir(options.userId), installName);

  // `fs.cp` follows directory links by default on some Node versions and can
  // preserve links when the source tree contains them. Skills are user-owned
  // data, so materialize every entry as a real directory/file and never copy a
  // symlink/junction into the installed tree.
  //
  // On Windows, directory junctions created by `mklink /J` are also reported as
  // symbolic links by `fs.lstat`. We additionally reject reparse points by
  // checking `sourceStat.isSymbolicLink()` which covers both symlinks and
  // junctions.
  function logSkillImport(message: string) {
    // Best-effort diagnostic — never throws.
    try {
      // eslint-disable-next-line no-console
      console.log(`[skillArchive] ${message}`);
    } catch { /* noop */ }
  }

  // Directories that are build artifacts or package-manager caches — never
  // Directories that are build artifacts or caches — never copied into
  // the installed skill tree.  Note: node_modules IS copied because some
  // skills (e.g. presentations) bundle vendored packages via npm file:
  // links and the user's machine may not have npm available to regenerate
  // them.  Symlinks/junctions within node_modules are resolved by the
  // realpath logic below.
  const SKIP_DIRS = new Set([
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".mypy_cache",
    "__MACOSX",
    ".DS_Store",
  ]);

  // File patterns to skip.
  const SKIP_FILE_SUFFIXES = [".pyc", ".pyo"];

  async function copyPhysicalTree(source: string, destination: string): Promise<void> {
    const sourceStat = await lstat(source);

    // If the entry is a symbolic link / junction, **resolve and follow it**
    // instead of rejecting the entire import.  This handles the common case
    // where a skill's tool directory contains a symlinked sub-folder.  The
    // link target is copied as a real directory/file so the installed tree
    // remains fully physical.
    if (sourceStat.isSymbolicLink()) {
      // Resolve the link target and copy *that* path to destination.
      // realpath() follows the entire chain; if the target doesn't exist
      // (broken link) we skip the entry.
      let resolved: string;
      try {
        resolved = await realpath(source);
      } catch {
        logSkillImport(`copyPhysicalTree: skipping broken symlink ${source}`);
        return;
      }
      const targetStat = await lstat(resolved).catch(() => null);
      if (!targetStat) {
        logSkillImport(`copyPhysicalTree: symlink target missing, skipping ${source}`);
        return;
      }
      // Copy the resolved target recursively — this materialises the link
      // as a real directory/file at the destination.
      if (targetStat.isDirectory()) {
        await mkdir(destination, { recursive: true });
        for (const entry of await readdir(resolved, { withFileTypes: true })) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await copyPhysicalTree(join(resolved, entry.name), join(destination, entry.name));
        }
      } else if (targetStat.isFile()) {
        await mkdir(join(destination, ".."), { recursive: true });
        await cp(resolved, destination, { force: true, preserveTimestamps: true });
      }
      return;
    }

    if (sourceStat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const entry of await readdir(source, { withFileTypes: true })) {
        // Skip build artifacts and package-manager caches.
        if (SKIP_DIRS.has(entry.name)) {
          logSkillImport(`copyPhysicalTree: skipping ${entry.name}/ in ${source}`);
          continue;
        }
        await copyPhysicalTree(join(source, entry.name), join(destination, entry.name));
      }
      return;
    }
    if (!sourceStat.isFile()) {
      // Skip non-regular files (sockets, FIFOs, devices) silently.
      return;
    }
    if (SKIP_FILE_SUFFIXES.some((suffix) => source.endsWith(suffix))) return;
    await mkdir(join(destination, ".."), { recursive: true });
    await cp(source, destination, { force: true, preserveTimestamps: true });
  }

  /**
   * Recursively verify that every entry in the target tree is a physical
   * directory or file — NOT a symlink, junction, or other reparse point.
   * Throws on the first non-physical entry discovered.
   */
  async function assertPhysicalTree(dir: string, label = ""): Promise<void> {
    const dirStat = await lstat(dir);
    if (dirStat.isSymbolicLink()) {
      throw new Error(
        `Skill installation verification failed: ${label || dir} is a symbolic link/junction, not a physical directory.`,
      );
    }
    if (!dirStat.isDirectory()) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // `Dirent.isSymbolicLink()` catches symlinks, junctions, and reparse
      // points without an extra `lstat` call on most platforms. We still do
      // `lstat` as a cross-check for Windows junction edge cases.
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Skill installation verification failed: ${full} is a symbolic link/junction. The skill tree must contain only physical files and directories.`,
        );
      }
      const entryStat = await lstat(full).catch(() => null);
      if (entryStat?.isSymbolicLink()) {
        throw new Error(
          `Skill installation verification failed: ${full} is a symbolic link/junction (lstat confirmed).`,
        );
      }
      if (entry.isDirectory()) {
        await assertPhysicalTree(full, label);
      }
    }
  }

  logSkillImport(`importSkill: source=${skillRoot}, target=${targetPath}, name=${installName}`);

  // Remove any pre-existing directory (which might be a leftover symlink/junction
  // from a previous buggy import or a Python sync that created a junction).
  await rm(targetPath, { recursive: true, force: true });

  // Verify the source root itself is not a symlink/junction.
  const sourceRootStat = await lstat(skillRoot);
  if (sourceRootStat.isSymbolicLink()) {
    throw new Error(
      `Skill import source is a symbolic link/junction and was rejected: ${skillRoot}`,
    );
  }

  await copyPhysicalTree(skillRoot, targetPath);

  // Post-copy verification: ensure no symlink/junction exists in the installed tree.
  await assertPhysicalTree(targetPath);
  logSkillImport(`importSkill: post-copy verification passed for ${targetPath}`);

  // Normalize entry filename to SKILL.md for gateway listing.
  const copiedMd = await resolveSkillMdPath(targetPath).catch(() => "");
  if (copiedMd && basename(copiedMd) !== "SKILL.md") {
    await writeFile(join(targetPath, "SKILL.md"), await readFile(copiedMd, "utf8"), "utf8");
  }

  let files = 0;
  async function countFiles(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await countFiles(full);
      else files += 1;
    }
  }
  await countFiles(targetPath);
  logSkillImport(`importSkill: completed, files=${files}, path=${targetPath}`);

  try {
    await reloadSkills(options.threadId, options.userId);
  } catch {
    // Disk install succeeded; caller can hot-reload manually.
  }

  return { status: "ok", name: installName, path: targetPath, files };
}

export async function installSkillFromZipPath(
  zipPath: string,
  request: { name?: string; userId?: string; threadId?: string } = {},
): Promise<{ status: string; name: string; path: string; files: number }> {
  const installName = sanitizeInstallName(request.name?.trim() || basename(zipPath, ".zip"));
  const workDir = await mkdtemp(join(tmpdir(), "drsai-skill-"));
  const extractDir = join(workDir, "extract");
  try {
    await extractZip(zipPath, extractDir);
    const skillRoot = await findSkillRoot(extractDir);
    return await materializeSkillTree(skillRoot, installName, request);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function importSkillFromFolderPath(
  folderPath: string,
  request: { name?: string; userId?: string; threadId?: string } = {},
): Promise<{ status: string; name: string; path: string; files: number }> {
  const skillRoot = await findSkillRoot(folderPath);
  const installName = sanitizeInstallName(
    request.name?.trim() || basename(skillRoot),
  );
  return materializeSkillTree(skillRoot, installName, request);
}

export async function writeZipBufferAndInstall(
  zipBuffer: Buffer,
  installName: string,
  request: { userId?: string; threadId?: string } = {},
): Promise<{ status: string; name: string; path: string; files: number }> {
  if (zipBuffer.byteLength < 32) throw new Error("Downloaded skill archive is empty");
  const workDir = await mkdtemp(join(tmpdir(), "drsai-skill-"));
  const zipPath = join(workDir, `${installName}.zip`);
  try {
    await writeFile(zipPath, zipBuffer);
    return await installSkillFromZipPath(zipPath, { ...request, name: installName });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
