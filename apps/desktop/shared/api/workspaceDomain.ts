import type { WorkspaceProject } from "./desktopApi";

export interface WorkspaceConnectionMetadata {
  location: "local" | "remote";
  transport: "in-process" | "ssh";
  runtimeId?: string;
  instanceId?: string;
  hostAlias?: string;
}

export interface RuntimeWorkspaceDomain {
  workspaceId: string;
  name: string;
  canonicalPath: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
  connection: WorkspaceConnectionMetadata;
}

export interface AgentBackendMetadata {
  backendId: "opendrsai" | "codex";
  backendVersion?: string;
}

export interface WorkspaceExecutionTarget {
  workspace: RuntimeWorkspaceDomain;
  agentBackend: AgentBackendMetadata;
}

export function toRuntimeWorkspaceDomain(workspace: WorkspaceProject): RuntimeWorkspaceDomain {
  return {
    workspaceId: workspace.remote?.workspaceId || workspace.id,
    name: workspace.name,
    canonicalPath: workspace.remote?.canonicalPath || workspace.path,
    trusted: workspace.trusted,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    connection: workspace.location === "remote"
      ? { location: "remote", transport: "ssh", runtimeId: workspace.remote?.runtimeId, instanceId: workspace.remote?.instanceId, hostAlias: workspace.remote?.hostAlias }
      : { location: "local", transport: "in-process" },
  };
}

export function toWorkspaceExecutionTarget(
  workspace: WorkspaceProject,
  agentBackend: AgentBackendMetadata,
): WorkspaceExecutionTarget {
  return { workspace: toRuntimeWorkspaceDomain(workspace), agentBackend: { ...agentBackend } };
}
