import type { DesktopArtifactProvenance } from "./desktopApi";

export const RESULT_PROVENANCE_SCHEMA = "opendrsai.result-provenance/1" as const;

export function canonicalResultInput(
  summary: string,
  attachments: readonly string[],
): string {
  return JSON.stringify({
    summary: summary.trim(),
    attachments: [...attachments].map((item) => item.trim()).filter(Boolean),
  });
}

export function canonicalResultProvenance(
  provenance: Omit<DesktopArtifactProvenance, "sourceDigest">,
): string {
  return JSON.stringify({
    schemaVersion: provenance.schemaVersion,
    sourceTaskId: provenance.sourceTaskId,
    sourceSessionId: provenance.sourceSessionId,
    sourceRunId: provenance.sourceRunId,
    inputDigest: provenance.input.digest,
    targetArtifactId: provenance.target.artifactId,
    targetVersion: provenance.target.version,
    targetVersionId: provenance.target.versionId,
    capturedAt: provenance.capturedAt,
  });
}

export async function sha256Web(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function verifyResultProvenance(
  provenance: DesktopArtifactProvenance,
): Promise<{ valid: boolean; inputValid: boolean; sourceValid: boolean }> {
  if (provenance.schemaVersion !== RESULT_PROVENANCE_SCHEMA) {
    return { valid: false, inputValid: false, sourceValid: false };
  }
  const inputValid = await sha256Web(canonicalResultInput(provenance.input.summary, provenance.input.attachments)) === provenance.input.digest;
  const { sourceDigest: _sourceDigest, ...unsigned } = provenance;
  const sourceValid = await sha256Web(canonicalResultProvenance(unsigned)) === provenance.sourceDigest;
  return { valid: inputValid && sourceValid, inputValid, sourceValid };
}
