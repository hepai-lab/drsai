import type { DesktopCredentialService } from "../../../shared/api";

const MAX_PROTECTED_APPROVAL_PAYLOAD_CHARS = 600 * 1024;

export type ProtectedDesktopApprovalPayload = { protectedPayload: string };

export function protectDesktopApprovalPayload(
  credentials: DesktopCredentialService,
  value: unknown,
): ProtectedDesktopApprovalPayload | null {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return null; }
  if (!serialized || serialized.length > MAX_PROTECTED_APPROVAL_PAYLOAD_CHARS) return null;
  const protectedPayload = credentials.protect(serialized);
  return protectedPayload ? { protectedPayload } : null;
}

export function unprotectDesktopApprovalPayload(
  credentials: DesktopCredentialService,
  envelope: unknown,
): unknown | null {
  const protectedPayload = (envelope as Partial<ProtectedDesktopApprovalPayload> | null)?.protectedPayload;
  if (!protectedPayload || protectedPayload.length > 1_500_000) return null;
  const serialized = credentials.unprotect(protectedPayload);
  if (!serialized || serialized.length > MAX_PROTECTED_APPROVAL_PAYLOAD_CHARS) return null;
  try { return JSON.parse(serialized); } catch { return null; }
}
