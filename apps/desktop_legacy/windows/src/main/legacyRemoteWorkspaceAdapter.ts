import type { ConnectRemoteWorkspaceRequest } from "../shared/desktopApi";

export const LEGACY_REMOTE_WORKSPACE_ADAPTER_REMOVAL = "2027-01-31";

export interface LegacyRemoteSshConnectRequest {
  alias: string;
  workdir: string;
  trusted?: boolean;
  name?: string;
}

/** @deprecated Use ConnectRemoteWorkspaceRequest. This adapter is removal-bound. */
export function adaptLegacyRemoteSshConnect(
  request: LegacyRemoteSshConnectRequest,
  warn: (message: string) => void = (message) => console.warn(message),
): ConnectRemoteWorkspaceRequest {
  warn(`[deprecated] legacy Remote SSH connect request used; migrate to Remote Workspace before ${LEGACY_REMOTE_WORKSPACE_ADAPTER_REMOVAL}.`);
  if (!request || typeof request.alias !== "string" || typeof request.workdir !== "string") throw new Error("Legacy Remote Workspace request is invalid.");
  return { hostAlias: request.alias, path: request.workdir, trusted: request.trusted, name: request.name };
}
