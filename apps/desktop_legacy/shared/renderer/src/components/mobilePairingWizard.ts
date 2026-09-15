import type { DesktopMobilePairingGrantStatus, DesktopMobilePairingReadinessState } from "@shared/desktopApi";

export type MobilePairingWizardStep = "allow" | "scope" | "scan" | "complete";
export type MobilePairingWizardPrimaryAction = "retry" | "create_qr" | "refresh_qr" | "done" | null;

export interface MobilePairingWizardInput {
  readiness: DesktopMobilePairingReadinessState | null;
  grantStatus: DesktopMobilePairingGrantStatus | null;
  scopeValid: boolean;
  busy: boolean;
  error: boolean;
}

export interface MobilePairingWizardState {
  step: MobilePairingWizardStep;
  primaryAction: MobilePairingWizardPrimaryAction;
  canChangeScope: boolean;
}

/** One authoritative state model for the Desktop half of the three-step pairing journey. */
export function mobilePairingWizardState(input: MobilePairingWizardInput): MobilePairingWizardState {
  if (input.busy || input.readiness === null) {
    return { step: "allow", primaryAction: null, canChangeScope: false };
  }
  if (input.error || input.readiness !== "ready") {
    return { step: "allow", primaryAction: "retry", canChangeScope: false };
  }
  if (input.grantStatus === "consumed") {
    return { step: "complete", primaryAction: "done", canChangeScope: false };
  }
  if (input.grantStatus === "pending") {
    return { step: "scan", primaryAction: null, canChangeScope: false };
  }
  if (input.grantStatus === "expired" || input.grantStatus === "revoked") {
    return { step: "scan", primaryAction: "refresh_qr", canChangeScope: false };
  }
  return { step: "scope", primaryAction: input.scopeValid ? "create_qr" : null, canChangeScope: true };
}
