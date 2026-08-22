import type {
  DesktopMobilePairingGrant,
  DesktopMobilePairingReadiness,
  DesktopMobilePairingScope,
  DesktopMobileAssociation,
  DesktopRuntimeEnrollmentRevocation,
  DesktopRuntimeRemoteAccessState,
} from "../api/desktopApi";

export interface MobilePairingRuntimeClient {
  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness>;
  createMobilePairingGrant(scope?: DesktopMobilePairingScope): Promise<DesktopMobilePairingGrant>;
  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  listMobileAssociations(): Promise<DesktopMobileAssociation[]>;
  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation>;
  shrinkMobileAssociation(
    associationId: string,
    permissions: DesktopMobileAssociation["permissions"],
    scope?: DesktopMobilePairingScope,
  ): Promise<DesktopMobileAssociation>;
  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation>;
  pauseMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
  resumeMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
}

export type MobilePairingRuntimeRecovery = (
  reason: unknown,
) => Promise<MobilePairingRuntimeClient | null>;

/** Owns the ephemeral grant for one renderer. No secret is persisted here. */
export class MobilePairingController {
  private active: DesktopMobilePairingGrant | undefined;
  private activeScopeKey: string | undefined;
  private createInFlight: Promise<DesktopMobilePairingGrant> | undefined;
  private createInFlightScopeKey: string | undefined;
  private closed = false;
  private readonly connect: () => Promise<MobilePairingRuntimeClient>;
  private readonly recover: MobilePairingRuntimeRecovery | undefined;

  constructor(
    connect: () => Promise<MobilePairingRuntimeClient>,
    recover?: MobilePairingRuntimeRecovery,
  ) {
    this.connect = connect;
    this.recover = recover;
  }

  async readiness(): Promise<DesktopMobilePairingReadiness> {
    this.assertOpen();
    const client = await this.connect();
    return client.getMobilePairingReadiness();
  }

  async enable(): Promise<DesktopMobilePairingReadiness> {
    this.assertOpen();
    const initial = await this.invoke((client) => client.getMobilePairingReadiness());
    if (initial.value.state === "ready" || !this.recover) return initial.value;
    const recovered = await this.recover(initial.value);
    if (!recovered) return initial.value;
    return recovered.getMobilePairingReadiness();
  }

  create(scope?: unknown): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    const selection = this.validateScope(scope);
    const scopeKey = JSON.stringify(selection);
    if (this.active?.status === "pending" && this.activeScopeKey === scopeKey && Date.parse(this.active.expires_at) > Date.now()) {
      return Promise.resolve(this.active);
    }
    if (this.createInFlight) {
      if (this.createInFlightScopeKey !== scopeKey) {
        return Promise.reject(new Error("Mobile pairing scope changed while a grant is being created."));
      }
      return this.createInFlight;
    }
    this.createInFlightScopeKey = scopeKey;
    this.createInFlight = this.createFresh(selection).finally(() => {
      this.createInFlight = undefined;
      this.createInFlightScopeKey = undefined;
    });
    return this.createInFlight;
  }

  async read(grantId: string): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    this.assertOwnGrant(grantId);
    const grant = (await this.invoke((client) => client.getMobilePairingGrant(grantId))).value;
    this.active = grant.status === "pending" ? grant : undefined;
    if (!this.active) this.activeScopeKey = undefined;
    return grant;
  }

  async revoke(grantId: string): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    this.assertOwnGrant(grantId);
    const grant = (await this.invoke((client) => client.revokeMobilePairingGrant(grantId))).value;
    this.active = undefined;
    this.activeScopeKey = undefined;
    return grant;
  }

  async associations(): Promise<DesktopMobileAssociation[]> {
    this.assertOpen();
    return (await this.invoke((client) => client.listMobileAssociations())).value;
  }

  async revokeAssociation(associationId: string): Promise<DesktopMobileAssociation> {
    this.assertOpen();
    return (
      await this.invoke((client) => client.revokeMobileAssociation(associationId))
    ).value;
  }

  async revokeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation> {
    this.assertOpen();
    const result = (
      await this.invoke((client) => client.revokeMobileRuntimeEnrollment())
    ).value;
    this.active = undefined;
    this.activeScopeKey = undefined;
    return result;
  }

  async shrinkAssociation(
    associationId: string,
    permissions: DesktopMobileAssociation["permissions"],
    scope?: DesktopMobilePairingScope,
  ): Promise<DesktopMobileAssociation> {
    const unique = [...new Set(permissions)];
    if (!unique.length || unique.some((value) => !["read", "send", "approve", "files"].includes(value))) {
      throw new Error("Mobile association permissions are invalid.");
    }
    const selection = scope === undefined ? undefined : this.validateScope(scope);
    return (
      await this.invoke((client) => client.shrinkMobileAssociation(associationId, unique, selection))
    ).value;
  }

  async pauseAccess(): Promise<DesktopRuntimeRemoteAccessState> {
    this.assertOpen();
    const result = (await this.invoke((client) => client.pauseMobileRemoteAccess())).value;
    this.active = undefined;
    this.activeScopeKey = undefined;
    return result;
  }

  async resumeAccess(): Promise<DesktopRuntimeRemoteAccessState> {
    this.assertOpen();
    return (await this.invoke((client) => client.resumeMobileRemoteAccess())).value;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.revokeActive();
    await this.createInFlight?.catch(() => undefined);
  }

  private async revokeActive(): Promise<void> {
    const grantId = this.active?.grant_id;
    this.active = undefined;
    this.activeScopeKey = undefined;
    if (!grantId) return;
    try {
      await this.invoke((client) => client.revokeMobilePairingGrant(grantId));
    } catch {
      // The Relay TTL remains the final safety boundary when shutdown is abrupt/offline.
    }
  }

  private async createFresh(scope: DesktopMobilePairingScope): Promise<DesktopMobilePairingGrant> {
    if (this.active?.grant_id) await this.revokeActive();
    const { client, value: grant } = await this.invoke((runtime) => runtime.createMobilePairingGrant(scope));
    if (this.closed) {
      await client.revokeMobilePairingGrant(grant.grant_id).catch(() => undefined);
      throw new Error("Mobile pairing window is closed.");
    }
    this.active = grant.status === "pending" ? grant : undefined;
    this.activeScopeKey = this.active ? JSON.stringify(scope) : undefined;
    return grant;
  }

  private async invoke<T>(
    operation: (client: MobilePairingRuntimeClient) => Promise<T>,
  ): Promise<{ client: MobilePairingRuntimeClient; value: T }> {
    const client = await this.connect();
    try {
      return { client, value: await operation(client) };
    } catch (reason) {
      const recovered = await this.recover?.(reason);
      if (!recovered) throw reason;
      return { client: recovered, value: await operation(recovered) };
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Mobile pairing window is closed.");
  }

  private assertOwnGrant(grantId: string): void {
    if (!this.active || this.active.grant_id !== grantId) {
      throw new Error("Mobile pairing grant is not active for this window.");
    }
  }

  private validateScope(scope?: unknown): DesktopMobilePairingScope {
    const value = scope === undefined
      ? { workspace_scope: "all" as const, workspace_ids: [] }
      : scope;
    if (
      typeof value !== "object"
      || value === null
      || !("workspace_scope" in value)
      || !("workspace_ids" in value)
      || ((value as { workspace_scope?: unknown }).workspace_scope !== "all"
        && (value as { workspace_scope?: unknown }).workspace_scope !== "selected")
      || !Array.isArray((value as { workspace_ids?: unknown }).workspace_ids)
      || !(value as { workspace_ids: unknown[] }).workspace_ids.every((id) => typeof id === "string")
    ) {
      throw new Error("Mobile pairing Workspace scope is invalid.");
    }
    const typed = value as DesktopMobilePairingScope;
    const ids = [...new Set(typed.workspace_ids)].sort();
    if (
      (typed.workspace_scope === "all" && ids.length > 0)
      || (typed.workspace_scope === "selected" && ids.length === 0)
      || ids.length > 1000
      || ids.some((id) => !id || id.length > 256)
    ) {
      throw new Error("Mobile pairing Workspace scope is invalid.");
    }
    return { workspace_scope: typed.workspace_scope, workspace_ids: ids };
  }
}
