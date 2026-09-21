import type { CodexBackendState, CodexBackendStatus } from "../api/desktopApi";
import type { AgentBackendCapability, BackendAccountStatus } from "./runtimeClient";

function unavailableState(capability?: AgentBackendCapability): CodexBackendState {
  // When the capability object is entirely undefined the backend is not
  // registered in the gateway (V2 desktop_gateway only registers "opendrsai").
  // Treat this as "not_installed" rather than "fault" so the UI does not
  // offer a "restart" action that would 404.
  if (!capability) return "not_installed";
  const readiness = capability.readiness;
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
      readiness: presentReadiness(capability), binaryIdentity: presentBinaryIdentity(capability),
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
    readiness: presentReadiness(capability), binaryIdentity: presentBinaryIdentity(capability),
  };
}

function presentReadiness(capability?: AgentBackendCapability): CodexBackendStatus["readiness"] {
  if (!capability?.readiness) return undefined;
  const facet = (value: import("./runtimeClient").BackendReadinessFacet | undefined) => value ? ({
    state: value.state, reason: value.reason, observedAt: value.observed_at,
    lastSuccessAt: value.last_success_at, retryable: value.retryable,
    actions: value.actions, stale: value.stale,
  }) : undefined;
  return {
    runtime: facet(capability.readiness.runtime), transport: facet(capability.readiness.transport),
    process: facet(capability.readiness.process), installed: facet(capability.readiness.installed),
    contract: facet(capability.readiness.contract), account: facet(capability.readiness.account),
    models: facet(capability.readiness.models),
    executable: capability.readiness.executable ? {
      ...facet(capability.readiness.executable)!, blockers: capability.readiness.executable.blockers,
    } : undefined,
  };
}

function presentBinaryIdentity(capability?: AgentBackendCapability): CodexBackendStatus["binaryIdentity"] {
  const identity = capability?.binary_identity;
  return identity ? {
    source: identity.source, version: identity.version, binaryDigest: identity.binary_digest,
    schemaDigest: identity.schema_digest, releaseSafe: identity.release_safe,
  } : null;
}
