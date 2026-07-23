export type WorkspaceLocationFields = {
  location?: "local" | "remote";
  transport?: "ssh";
  type?: "local" | "remote-ssh";
};

export function migrateWorkspaceLocation<T extends WorkspaceLocationFields>(workspace: T): T & WorkspaceLocationFields {
  if (workspace.location === "local" || workspace.location === "remote") return workspace;
  if (workspace.type === "remote-ssh") {
    return { ...workspace, location: "remote", transport: "ssh" };
  }
  if (workspace.type === "local") return { ...workspace, location: "local" };
  return workspace;
}
