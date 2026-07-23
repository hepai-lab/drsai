import type { WorkspaceProject } from "../api/desktopApi";

export function isRemoteAcceptanceWorkspace(workspace: WorkspaceProject): boolean {
  if (workspace.location !== "remote" || !workspace.remote) return false;
  return /^opendrsai-remote-acceptance-[A-Za-z0-9_-]+$/.test(workspace.name)
    && /^opendrsai-(?:external|hostkey)-smoke$/.test(workspace.remote.hostAlias)
    && /^\/home\/vscode\/\.cache\/opendrsai\/acceptance\/opendrsai-remote-acceptance-[A-Za-z0-9_-]+$/.test(workspace.remote.canonicalPath);
}

export function shouldRestorePersistedRemoteWorkspace(workspace: WorkspaceProject): boolean {
  return workspace.location === "remote"
    && workspace.transport === "ssh"
    && workspace.remote?.autoReconnect === true
    && !isRemoteAcceptanceWorkspace(workspace);
}
