import type {
  DesktopMobilePairingGrant,
  DesktopMobilePairingReadiness,
  DesktopMobileAssociation,
  DesktopRuntimeEnrollmentRevocation,
} from "../api/desktopApi";

export interface MobilePairingRuntimeClient {
  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness>;
  createMobilePairingGrant(): Promise<DesktopMobilePairingGrant>;
  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  listMobileAssociations(): Promise<DesktopMobileAssociation[]>;
  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation>;
  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation>;
}

export type MobilePairingRuntimeRecovery = (
  reason: unknown,
) => Promise<MobilePairingRuntimeClient | null>;

/** Owns the ephemeral grant for one renderer. No secret is persisted here. */
export class MobilePairingController {
  private active: DesktopMobilePairingGrant | undefined;
  private createInFlight: Promise<DesktopMobilePairingGrant> | undefined;
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
    const initial = await this.invoke((client) => client.getMobilePairingReadiness());
    if (initial.value.state === "ready" || !this.recover) return initial.value;
    const recovered = await this.recover(initial.value);
    if (!recovered) return initial.value;
    return recovered.getMobilePairingReadiness();
  }

  create(): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    if (this.active?.status === "pending" && Date.parse(this.active.expires_at) > Date.now()) {
      return Promise.resolve(this.active);
    }
    if (this.createInFlight) return this.createInFlight;
    this.createInFlight = this.createFresh().finally(() => {
      this.createInFlight = undefined;
    });
    return this.createInFlight;
  }

  async read(grantId: string): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    this.assertOwnGrant(grantId);
    const grant = (await this.invoke((client) => client.getMobilePairingGrant(grantId))).value;
    this.active = grant.status === "pending" ? grant : undefined;
    return grant;
  }

  async revoke(grantId: string): Promise<DesktopMobilePairingGrant> {
    this.assertOpen();
    this.assertOwnGrant(grantId);
    const grant = (await this.invoke((client) => client.revokeMobilePairingGrant(grantId))).value;
    this.active = undefined;
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
    return result;
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
    if (!grantId) return;
    try {
      await this.invoke((client) => client.revokeMobilePairingGrant(grantId));
    } catch {
      // The Relay TTL remains the final safety boundary when shutdown is abrupt/offline.
    }
  }

  private async createFresh(): Promise<DesktopMobilePairingGrant> {
    if (this.active?.grant_id) await this.revokeActive();
    const { client, value: grant } = await this.invoke((runtime) => runtime.createMobilePairingGrant());
    if (this.closed) {
      await client.revokeMobilePairingGrant(grant.grant_id).catch(() => undefined);
      throw new Error("Mobile pairing window is closed.");
    }
    this.active = grant.status === "pending" ? grant : undefined;
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
}
