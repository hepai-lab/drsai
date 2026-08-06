import type { CodexBackendState, CodexBackendStatus } from "../api/desktopApi";
import type { AgentBackendCapability, BackendAccountStatus } from "./runtimeClient";

function unavailableState(capability?: AgentBackendCapability): CodexBackendState {
  const readiness = capability?.readiness;
  if (readiness?.installed.state === "missing") return "not_installed";
  if (readiness?.contract.state === "blocked") return "version_incompatible";
  return "fault";
}

export function presentCodexBackendStatus(capability?: AgentBackendCapability, account?: BackendAccountStatus): CodexBackendStatus {
  if (!capability?.available) {
    const state = unavailableState(capability);
    return {
      backendId: "codex", state, available: false, version: capability?.version ?? null,
      installed: capability?.readiness?.installed.state === "ready", authenticated: false,
      contractCompatible: capability?.readiness?.contract.state === "ready", executable: false,
      loggedIn: false, authMode: null, accountLabel: null, reason: capability?.reason ?? "codex_backend_unavailable",
      retryable: state === "fault", action: state === "not_installed" ? "install" : state === "version_incompatible" ? "upgrade" : "restart",
      appServerState: capability?.app_server_state, connectionState: capability?.connection_state,
      transport: capability?.transport, adapterVersion: capability?.adapter_version,
    };
  }

  const accountState = account?.state ?? "unknown";
  const loggedIn = accountState === "signed_in";
  const state: CodexBackendState = loggedIn ? "available"
    : accountState === "signed_out" ? "not_logged_in" : "account_unavailable";
  const modelsReady = capability.readiness?.models.state === "ready"
    || (capability.model_catalog?.stale !== true && Boolean(capability.model_catalog?.models?.some((model) => !model.hidden)));
  return {
    backendId: "codex", state, available: true,
    installed: capability.readiness?.installed.state === "ready" || capability.installed === true,
    authenticated: loggedIn, contractCompatible: capability.readiness?.contract.state === "ready" || capability.contract_compatible === true,
    executable: loggedIn && capability.available && capability.contract_compatible !== false && modelsReady,
    version: capability.version ?? null, loggedIn, authMode: account?.auth_mode ?? null,
    accountLabel: account?.email ?? null, reason: account?.reason ?? null, retryable: account?.retryable ?? false,
    action: loggedIn ? "none" : accountState === "signed_out" ? "login" : "reconnect",
    appServerState: capability.app_server_state, connectionState: capability.connection_state,
    transport: capability.transport, adapterVersion: capability.adapter_version,
  };
}
