import { mkdir, realpath } from "fs/promises";
import { dirname, isAbsolute, join, relative } from "path";

export const DEFAULT_WORKSPACE_FOLDER_NAME = "OpenDrSai Workspace";

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
