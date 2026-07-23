/** @deprecated M3 compatibility entrypoint. Import from shared/main instead. */
import { bindRemoteThread, getRemoteGatewayAccess, resolveRemoteWorkspaceTarget } from "./remoteWorkspace";
import { configureChatRemoteRouting } from "../../../shared/main/chat";

configureChatRemoteRouting({
  resolveTarget: resolveRemoteWorkspaceTarget,
  getGatewayAccess: getRemoteGatewayAccess,
  bindThread: bindRemoteThread,
});

export * from "../../../shared/main/chat";
