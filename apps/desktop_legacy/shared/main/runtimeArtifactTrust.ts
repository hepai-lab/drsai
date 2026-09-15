import { createHash, verify } from "crypto";
import { readFile } from "fs/promises";

export interface RuntimeArtifactSignature {
  version: string;
  expectedSha256?: string;
  publisher: string;
  signature: string;
}

export type RuntimeArtifactTrustStore = Record<string, string>;

export function runtimeArtifactSignaturePayload(version: string, sha256: string): Buffer {
  return Buffer.from(`opendrsai-runtime-artifact-v1\n${version}\n${sha256}\n`, "utf8");
}

export function verifyRuntimeArtifactTrust(artifact: Buffer, declaration: RuntimeArtifactSignature, trustedPublishers: RuntimeArtifactTrustStore): { sha256: string; publisher: string } {
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (declaration.expectedSha256 && declaration.expectedSha256.toLowerCase() !== sha256) throw new Error("Runtime artifact SHA-256 does not match.");
  const publicKey = trustedPublishers[declaration.publisher];
  if (!publicKey) throw new Error("Runtime artifact publisher is not trusted.");
  let signature: Buffer;
  try { signature = Buffer.from(declaration.signature, "base64"); } catch { throw new Error("Runtime artifact signature is invalid."); }
  if (!signature.length || !verify(null, runtimeArtifactSignaturePayload(declaration.version, sha256), publicKey, signature)) throw new Error("Runtime artifact signature verification failed.");
  return { sha256, publisher: declaration.publisher };
}

export async function loadRuntimeArtifactTrustStore(path = process.env.OPENDRSAI_RUNTIME_TRUST_STORE?.trim()): Promise<RuntimeArtifactTrustStore> {
  if (!path) throw new Error("A Runtime artifact trust store is required.");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Runtime artifact trust store is invalid.");
  const entries = Object.entries(parsed).filter((entry): entry is [string, string] => /^[A-Za-z0-9_.-]{1,128}$/.test(entry[0]) && typeof entry[1] === "string" && entry[1].includes("PUBLIC KEY"));
  if (!entries.length) throw new Error("Runtime artifact trust store contains no trusted publishers.");
  return Object.fromEntries(entries);
}
