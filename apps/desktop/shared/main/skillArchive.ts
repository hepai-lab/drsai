/**
 * Shared helpers: validate skill folders / ZIP archives and materialize into
 * the gateway user skills directory.
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readdir, readFile, rm, cp, writeFile } from "fs/promises";
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
    name === "node_modules" ||
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

    let children: Awaited<ReturnType<typeof readdir>>;
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

  await mkdir(targetPath, { recursive: true });
  await cp(skillRoot, targetPath, { recursive: true, force: true });

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
