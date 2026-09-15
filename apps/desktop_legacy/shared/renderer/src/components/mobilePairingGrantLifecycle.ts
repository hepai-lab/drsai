import type { DesktopMobilePairingGrantStatus } from "@shared/desktopApi";

export interface MobilePairingGrantLifecycle {
  status: DesktopMobilePairingGrantStatus;
  secondsLeft: number;
  refreshRequired: boolean;
}

export function mobilePairingGrantLifecycle(
  status: DesktopMobilePairingGrantStatus,
  expiresAt: string,
  nowMillis: number,
): MobilePairingGrantLifecycle {
  const expiry = Date.parse(expiresAt);
  const secondsLeft = Number.isFinite(expiry)
    ? Math.max(0, Math.ceil((expiry - nowMillis) / 1_000))
    : 0;
  const effective = status === "pending" && secondsLeft === 0 ? "expired" : status;
  return {
    status: effective,
    secondsLeft,
    refreshRequired: effective === "expired" || effective === "revoked",
  };
}
