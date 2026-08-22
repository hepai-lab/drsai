export const DEFAULT_WORKSPACE_FOLDER_NAME = "OpenDrSai Workspace";
export const DEFAULT_WORKSPACE_DISPLAY_NAME = "默认";
export const DEFAULT_WORKSPACE_VERSION = 2;

/**
 * Migrate only the app-generated legacy name. A user-supplied name on the
 * managed directory remains user-owned, while all newly created defaults use
 * the canonical display name above.
 */
export function resolveDefaultWorkspaceDisplayName(
  currentName: string,
  currentVersion: unknown,
): string {
  if (currentVersion === DEFAULT_WORKSPACE_VERSION) return currentName;
  return currentName === DEFAULT_WORKSPACE_FOLDER_NAME
    ? DEFAULT_WORKSPACE_DISPLAY_NAME
    : currentName;
}
