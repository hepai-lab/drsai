import type { DesktopA5ServiceGuidanceScenario, DesktopBootstrapBlockerKind } from "../api/desktopApi";

const KINDS: DesktopBootstrapBlockerKind[] = ["auth_required", "service_unavailable", "runtime_missing", "permission_denied"];

export function getA5ServiceGuidanceScenario(environment: NodeJS.ProcessEnv = process.env): DesktopA5ServiceGuidanceScenario | null {
  if (environment.OPENDRSAI_E2E_A5_SERVICE_GUIDANCE !== "1") return null;
  const kind = environment.OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO as DesktopBootstrapBlockerKind | undefined;
  if (!kind || !KINDS.includes(kind)) return null;
  const title: Record<DesktopBootstrapBlockerKind, string> = {
    auth_required: "Sign in required", service_unavailable: "Service unavailable",
    runtime_missing: "Local runtime needs repair", permission_denied: "Account has no available service",
  };
  const diagnosticFixture = [`A5 E2E ${kind}`, "Bearer secret-a5-bearer-token", "api_key=secret-a5-api-key", "Cookie: session=secret-a5-cookie", "operator@example.test", "/Users/test/OpenDrSai/private"].join(" | ");
  const authenticated = kind !== "auth_required";
  return {
    kind, message: diagnosticFixture,
    session: authenticated ? {
      authenticated: true,
      user: { id: "a5-e2e-user", email: "a5-e2e-user@example.test", name: "A5 E2E User", role: "user" },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), authMode: "oidc", authProvider: "ihep",
      accessTokenExpiresAt: new Date(Date.now() + 1_800_000).toISOString(), refreshable: false,
    } : { authenticated: false, user: null, expiresAt: null, authMode: null, authProvider: null, accessTokenExpiresAt: null, refreshable: false },
    blocker: {
      kind, title: title[kind], message: diagnosticFixture, retryable: kind !== "auth_required",
      canRepairRuntime: kind === "runtime_missing", canSignInAgain: kind === "auth_required" || kind === "permission_denied",
      diagnosticCode: `a5-e2e-${kind}`,
    },
  };
}
