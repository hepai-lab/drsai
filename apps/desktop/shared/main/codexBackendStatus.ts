import type { CodexBackendStatus } from "../api/desktopApi";
import type { AgentBackendCapability, BackendAccountStatus } from "./runtimeClient";

export function presentCodexBackendStatus(capability?: AgentBackendCapability, account?: BackendAccountStatus): CodexBackendStatus {
  if (!capability?.available) {
    const reason = capability?.reason ?? "codex_backend_unavailable";
    const state = reason.includes("not_installed") || reason === "not_configured" ? "not_installed"
      : reason.includes("incompatible") || reason.includes("version") || reason.includes("schema") ? "version_incompatible" : "fault";
    return { backendId: "codex", state, available: false, version: capability?.version ?? null,
      loggedIn: false, authMode: null, accountLabel: null, reason, retryable: state === "fault",
      action: state === "not_installed" ? "install" : state === "version_incompatible" ? "upgrade" : "restart",
      appServerState: capability?.app_server_state, connectionState: capability?.connection_state,
      transport: capability?.transport, adapterVersion: capability?.adapter_version };
  }
  const loggedIn = account?.logged_in === true;
  return { backendId: "codex", state: loggedIn ? "available" : "not_logged_in", available: true,
    version: capability.version ?? null, loggedIn, authMode: account?.auth_mode ?? null,
    accountLabel: account?.email ?? null, reason: account?.reason ?? null, retryable: account?.retryable ?? false,
    action: loggedIn ? "none" : "login", appServerState: capability.app_server_state,
    connectionState: capability.connection_state, transport: capability.transport,
    adapterVersion: capability.adapter_version };
}
