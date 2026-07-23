/** @deprecated M3 compatibility entrypoint. Import from shared/main instead. */
import { configureRuntimeWorkspaceRouting } from "../../../shared/main/runtimeClient";
import { getRemoteGatewayAccess } from "./remoteWorkspace";
import { findWorkspaceById } from "./workspaces";

configureRuntimeWorkspaceRouting({
  getRemoteGatewayAccess: (workspacePath, workspaceId) =>
    getRemoteGatewayAccess(workspacePath, workspaceId) ?? undefined,
  findWorkspaceById,
});

export * from "../../../shared/main/runtimeClient";
