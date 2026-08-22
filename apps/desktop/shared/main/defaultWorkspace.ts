import { cp, lstat, mkdir, readdir, realpath, rename, rm } from "fs/promises";
import { dirname, isAbsolute, join, relative } from "path";
import { DEFAULT_WORKSPACE_FOLDER_NAME } from "../api/workspaceDefaults";

/** Resolve and create the one app-managed workspace without following a
 * pre-existing link outside the user's Documents folder. */
export async function ensureDefaultWorkspaceDirectory(documentsPath: string): Promise<string> {
  if (typeof documentsPath !== "string" || !isAbsolute(documentsPath) || /[\r\n]/.test(documentsPath)) {
    throw new Error("Default workspace documents path is invalid.");
  }
  await mkdir(documentsPath, { recursive: true });
  const canonicalDocumentsPath = await realpath(documentsPath);
  const requestedWorkspacePath = join(canonicalDocumentsPath, DEFAULT_WORKSPACE_FOLDER_NAME);
  await mkdir(requestedWorkspacePath, { recursive: true });
  const canonicalWorkspacePath = await realpath(requestedWorkspacePath);
  const childPath = relative(canonicalDocumentsPath, canonicalWorkspacePath);
  if (!childPath || childPath.startsWith("..") || isAbsolute(childPath) || dirname(canonicalWorkspacePath).toLowerCase() !== canonicalDocumentsPath.toLowerCase()) {
    throw new Error("Default workspace must stay inside the Documents folder.");
  }
  return canonicalWorkspacePath;
}

/** Merge the legacy profile-local default into the canonical Documents
 * workspace without following links or overwriting an existing entry. The
 * legacy directory is removed only when every entry was migrated. */
export async function migrateLegacyDefaultWorkspaceDirectory(legacyPath: string, canonicalPath: string): Promise<boolean> {
  if (!isAbsolute(legacyPath) || !isAbsolute(canonicalPath) || legacyPath === canonicalPath) return false;
  try {
    const legacy = await lstat(legacyPath);
    const canonical = await lstat(canonicalPath);
    if (!legacy.isDirectory() || legacy.isSymbolicLink() || !canonical.isDirectory() || canonical.isSymbolicLink()) return false;
  } catch {
    return true;
  }
  const migrated = await mergeDirectoryWithoutOverwrite(legacyPath, canonicalPath);
  if (migrated) await rm(legacyPath, { recursive: false }).catch(() => undefined);
  return migrated;
}

async function mergeDirectoryWithoutOverwrite(source: string, destination: string): Promise<boolean> {
  let complete = true;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    if (entry.isSymbolicLink()) { complete = false; continue; }
    try {
      const destinationStat = await lstat(destinationEntry);
      if (entry.isDirectory() && destinationStat.isDirectory() && !destinationStat.isSymbolicLink()) {
        if (await mergeDirectoryWithoutOverwrite(sourceEntry, destinationEntry)) {
          await rm(sourceEntry, { recursive: false }).catch(() => undefined);
        } else complete = false;
      } else complete = false;
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { complete = false; continue; }
    }
    try {
      await rename(sourceEntry, destinationEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") { complete = false; continue; }
      try {
        await cp(sourceEntry, destinationEntry, { recursive: entry.isDirectory(), errorOnExist: true, force: false });
        await rm(sourceEntry, { recursive: true, force: true });
      } catch { complete = false; }
    }
  }
  return complete && (await readdir(source)).length === 0;
}
