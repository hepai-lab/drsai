export const MACOS_UPDATE_CDN_URL = "https://download-opendrsai.ihep.ac.cn/channels/stable/macos/arm64/";
export const MACOS_UPDATE_GITHUB_OWNER = "hepai-lab";
export const MACOS_UPDATE_GITHUB_REPO = "drsai";

export interface UpdateCandidateIdentity {
  version: string;
  sha512: string | null;
}

export interface RuntimeCompatibilityIdentity {
  version: string | null;
  archiveSha256: string | null;
  healthy?: boolean;
}

export function validateHttpsUpdateFeed(raw: string, expectedHost?: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Update feed must be an authenticated HTTPS origin.");
  if (expectedHost && url.hostname !== expectedHost) throw new Error("Update feed host is not approved.");
  return url.toString();
}

export function validateFallbackCandidate(primary: UpdateCandidateIdentity, fallback: UpdateCandidateIdentity): void {
  if (fallback.version !== primary.version) throw new Error("GitHub fallback does not publish the selected CDN version.");
  if (primary.sha512 && fallback.sha512 && primary.sha512 !== fallback.sha512) throw new Error("CDN and GitHub update digests differ.");
}

export function runtimeMetadataMatchesInstalled(metadata: { opendrsaiRuntimeVersion?: unknown; opendrsaiRuntimeSha256?: unknown }, installed: RuntimeCompatibilityIdentity): boolean {
  return installed.healthy === true
    && typeof metadata.opendrsaiRuntimeVersion === "string"
    && typeof metadata.opendrsaiRuntimeSha256 === "string"
    && /^[a-f0-9]{64}$/.test(metadata.opendrsaiRuntimeSha256)
    && installed.version === metadata.opendrsaiRuntimeVersion
    && installed.archiveSha256 === metadata.opendrsaiRuntimeSha256;
}
