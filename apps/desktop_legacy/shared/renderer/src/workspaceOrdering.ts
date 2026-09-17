import type { WorkspaceProject } from "@shared/desktopApi";

export type WorkspaceSortMode = "name" | "created";

export function normalizeWorkspaceSortMode(value: string | null): WorkspaceSortMode {
  return value === "name" || value === "created" ? value : "created";
}

export function sortWorkspacesForSidebar(
  workspaces: WorkspaceProject[],
  mode: WorkspaceSortMode,
): WorkspaceProject[] {
  return [...workspaces].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    if (mode === "name") {
      const byName = left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
    }
    const byCreation = right.createdAt.localeCompare(left.createdAt);
    if (byCreation !== 0) return byCreation;
    return left.id.localeCompare(right.id);
  });
}
