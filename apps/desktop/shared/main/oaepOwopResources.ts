import { createHash, randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import type { OaepItem, OaepResourceRef } from "../api/oaep.generated";
import type { RuntimeClient } from "./runtimeClient";

export interface OaepArtifactMetadataRequest {
  workspaceId: string;
  operation: "artifact.metadata";
  params: { artifact_id: string };
}

export type OaepResourceResolveRequest =
  | { workspaceId: string; operation: "files.resolve"; params: { file_id: string; expected_digest?: string } }
  | { workspaceId: string; operation: "artifact.metadata"; params: { artifact_id: string } };

export interface ResolvedOaepResource {
  workspaceId: string;
  resourceId: string;
  resourceType: "file" | "artifact";
  state: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported";
  path?: string;
  logicalPath?: string;
  name: string;
  mime?: string;
  size?: number;
  digest?: string;
  modifiedAt?: string;
  observedVersionAvailable?: boolean;
  capabilities: {
    read: boolean;
    preview: boolean;
    download: boolean;
    reveal: boolean;
    openExternal: boolean;
    copyLogicalPath?: boolean;
  };
}

function readBoolean(record: Record<string, unknown>, key: string, fallback = false): boolean {
  return typeof record[key] === "boolean" ? record[key] as boolean : fallback;
}

/** Map an opaque OAEP reference to the one authorized OWOP lookup it permits. */
export function oaepResourceResolveRequest(reference: OaepResourceRef): OaepResourceResolveRequest {
  if (reference.protocol !== "owop/1" || !reference.workspace_id || !reference.resource_id) {
    throw new Error("oaep_resource_ref_invalid");
  }
  if (reference.resource_type === "file") {
    return {
      workspaceId: reference.workspace_id,
      operation: "files.resolve",
      params: {
        file_id: reference.resource_id,
        ...(reference.digest ? { expected_digest: reference.digest } : {}),
      },
    };
  }
  if (reference.resource_type === "artifact") {
    return {
      workspaceId: reference.workspace_id,
      operation: "artifact.metadata",
      params: { artifact_id: reference.resource_id },
    };
  }
  throw new Error("oaep_resource_type_not_navigable");
}

/** Resolve without exposing a physical path in the conversation protocol. */
export async function resolveOaepResource(
  client: Pick<RuntimeClient, "executeOWOP">,
  reference: OaepResourceRef,
): Promise<ResolvedOaepResource> {
  const request = oaepResourceResolveRequest(reference);
  const raw = await client.executeOWOP(request.workspaceId, request.operation, request.params as never);
  const descriptor = request.operation === "files.resolve"
    ? raw.resource as Record<string, unknown> | undefined
    : raw;
  if (!descriptor || typeof descriptor !== "object") throw new Error("oaep_resource_resolution_invalid");
  const path = typeof descriptor.path === "string"
    ? descriptor.path
    : typeof descriptor.relative_path === "string" && descriptor.storage_kind !== "runtime"
      ? descriptor.relative_path
      : undefined;
  const capabilities = descriptor.capabilities && typeof descriptor.capabilities === "object"
    ? descriptor.capabilities as Record<string, unknown>
    : {};
  const state = ["available", "moved", "changed", "deleted", "offline", "unsupported"].includes(String(descriptor.state))
    ? String(descriptor.state) as ResolvedOaepResource["state"]
    : "unsupported";
  return {
    workspaceId: request.workspaceId,
    resourceId: reference.resource_id,
    resourceType: request.operation === "files.resolve" ? "file" : "artifact",
    state,
    ...(path ? { path } : {}),
    name: String(descriptor.name || descriptor.display_name || reference.label || reference.resource_id),
    ...(typeof descriptor.mime_type === "string" ? { mime: descriptor.mime_type } : {}),
    ...(typeof descriptor.size === "number" ? { size: descriptor.size } : {}),
    ...(typeof descriptor.digest === "string"
      ? { digest: descriptor.digest }
      : typeof descriptor.sha256 === "string" ? { digest: `sha256:${descriptor.sha256}` } : {}),
    ...(typeof descriptor.created_at === "string" ? { modifiedAt: descriptor.created_at } : {}),
    capabilities: {
      read: readBoolean(capabilities, "read"),
      preview: readBoolean(capabilities, "preview"),
      download: readBoolean(capabilities, "download"),
      reveal: readBoolean(capabilities, "reveal"),
      openExternal: readBoolean(capabilities, "open_external"),
      copyLogicalPath: readBoolean(capabilities, "copy_logical_path"),
    },
  };
}

export interface PreviewedOaepResource {
  workspacePath: string;
  path: string;
  relativePath: string;
  name: string;
  kind: "text" | "code" | "markdown" | "html" | "json" | "config" | "structured" | "table" | "image" | "notebook" | "pdf" | "office" | "media" | "binary" | "large" | "unknown";
  mime: string;
  size: number;
  modifiedAt: string;
  truncated: boolean;
  fileHash?: string;
  content?: string;
  dataUrl?: string;
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

interface DownloadCommitFileSystem {
  lstat(path: string): Promise<unknown>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const downloadCommitFileSystem: DownloadCommitFileSystem = { lstat, rename, rm };

/**
 * Commit a fully validated same-directory partial without ever deleting the old
 * destination first. Windows cannot rename over an existing file, so retain a
 * private backup until the new file is in place and roll back on any failure.
 */
export async function commitValidatedDownload(
  temporaryPath: string,
  destinationPath: string,
  fileSystem: DownloadCommitFileSystem = downloadCommitFileSystem,
): Promise<void> {
  let destinationExists = false;
  try {
    await fileSystem.lstat(destinationPath);
    destinationExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!destinationExists) {
    await fileSystem.rename(temporaryPath, destinationPath);
    return;
  }

  const backupPath = `${destinationPath}.${process.pid}.${randomUUID()}.backup`;
  await fileSystem.rename(destinationPath, backupPath);
  try {
    await fileSystem.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fileSystem.rename(backupPath, destinationPath).catch((rollbackError) => {
      throw new AggregateError([error, rollbackError], "oaep_resource_download_commit_and_rollback_failed");
    });
    throw error;
  }
  await fileSystem.rm(backupPath, { force: true });
}

/** Read a bounded Runtime-owned Artifact without materializing or exposing its host path. */
export async function previewOaepResource(
  client: Pick<RuntimeClient, "executeOWOP">,
  reference: OaepResourceRef,
  workspacePath: string,
  maxBytes = 1_000_000,
): Promise<PreviewedOaepResource> {
  if (reference.resource_type !== "artifact") throw new Error("oaep_resource_preview_requires_artifact");
  const resolved = await resolveOaepResource(client, reference);
  if (resolved.state === "deleted" || !resolved.capabilities.preview) {
    throw new Error("oaep_resource_preview_unavailable");
  }
  const bounded = Math.max(1, Math.min(Math.trunc(maxBytes), 1_000_000));
  const length = Math.max(1, Math.min(resolved.size ?? bounded, bounded));
  const raw = await client.executeOWOP(reference.workspace_id, "artifact.chunk", {
    artifact_id: reference.resource_id,
    offset: 0,
    length,
  });
  const encoded = typeof raw.content_base64 === "string" ? raw.content_base64 : "";
  if (!encoded) throw new Error("oaep_resource_preview_invalid");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  const mime = resolved.mime || "application/octet-stream";
  const kind = previewKind(resolved.name, mime, resolved.size ?? bytes.byteLength);
  const truncated = raw.eof !== true;
  const virtualPath = `artifact://${reference.workspace_id}/${reference.resource_id}`;
  const preview: PreviewedOaepResource = {
    workspacePath,
    path: virtualPath,
    relativePath: resolved.name,
    name: resolved.name,
    kind,
    mime,
    size: resolved.size ?? bytes.byteLength,
    modifiedAt: resolved.modifiedAt || "",
    truncated,
    ...(resolved.digest ? { fileHash: resolved.digest.replace(/^sha256:/, "") } : {}),
    metadata: {
      runtimeOwned: true,
      resourceId: reference.resource_id,
      workspaceId: reference.workspace_id,
    },
  };
  if (kind === "image") {
    preview.dataUrl = `data:${mime};base64,${encoded}`;
  } else if (["text", "code", "markdown", "html", "json", "config", "structured", "table"].includes(kind)) {
    preview.content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } else {
    preview.message = "This Runtime-owned artifact is available for download but has no safe inline preview.";
  }
  return preview;
}

/** Stream an authorized Runtime Artifact to an explicit Host-selected destination. */
export async function saveOaepResourceToFile(
  client: Pick<RuntimeClient, "executeOWOP">,
  reference: OaepResourceRef,
  destinationPath: string,
): Promise<{ name: string; size: number; digest?: string }> {
  if (reference.resource_type !== "artifact") throw new Error("oaep_resource_download_requires_artifact");
  const resolved = await resolveOaepResource(client, reference);
  if (resolved.state === "deleted" || !resolved.capabilities.download) {
    throw new Error("oaep_resource_download_unavailable");
  }
  const expectedSize = resolved.size;
  if (!Number.isSafeInteger(expectedSize) || expectedSize! < 0 || expectedSize! > 2 * 1024 * 1024 * 1024) {
    throw new Error("oaep_resource_download_size_invalid");
  }
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.partial`;
  const handle = await open(temporaryPath, "wx", 0o600);
  const digest = createHash("sha256");
  let offset = 0;
  try {
    while (offset < expectedSize!) {
      const length = Math.min(1_048_576, expectedSize! - offset);
      const raw = await client.executeOWOP(reference.workspace_id, "artifact.chunk", {
        artifact_id: reference.resource_id,
        offset,
        length,
      });
      const encoded = typeof raw.content_base64 === "string" ? raw.content_base64 : "";
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > length) throw new Error("oaep_resource_download_chunk_invalid");
      await handle.write(bytes, 0, bytes.length, offset);
      digest.update(bytes);
      offset += bytes.length;
      if (raw.eof === true && offset !== expectedSize) throw new Error("oaep_resource_download_truncated");
    }
    await handle.sync();
    await handle.close();
    const actualDigest = `sha256:${digest.digest("hex")}`;
    if (resolved.digest && resolved.digest !== actualDigest) throw new Error("oaep_resource_download_digest_mismatch");
    await commitValidatedDownload(temporaryPath, destinationPath);
    return { name: resolved.name, size: offset, digest: resolved.digest || actualDigest };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function previewKind(name: string, mime: string, size: number): PreviewedOaepResource["kind"] {
  const lower = name.toLowerCase();
  if (size > 1_000_000 && !mime.startsWith("image/")) return "large";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mime === "application/json" || lower.endsWith(".json")) return "json";
  if (mime === "text/markdown" || /\.(md|mdx)$/.test(lower)) return "markdown";
  if (mime === "text/html" || /\.html?$/.test(lower)) return "html";
  if (/\.(csv|tsv)$/.test(lower)) return "table";
  if (/\.(ya?ml|toml|ini|env)$/.test(lower)) return "config";
  if (/\.(py|ts|tsx|js|jsx|java|kt|swift|rs|go|c|cpp|h|hpp|css|scss|sql|sh|ps1)$/.test(lower)) return "code";
  if (mime.startsWith("text/")) return "text";
  if (/\.(docx?|xlsx?|pptx?)$/.test(lower)) return "office";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media";
  return "binary";
}

/** Resolve an OAEP Artifact only through its authorized OWOP resource reference. */
export function oaepArtifactMetadataRequest(item: OaepItem): OaepArtifactMetadataRequest {
  if (item.type !== "artifact") throw new Error("oaep_artifact_item_required");
  const reference = item.content.resource_refs?.find((candidate) =>
    candidate.protocol === "owop/1"
    && candidate.resource_type === "artifact"
    && candidate.resource_id === item.content.artifact_id,
  );
  if (!reference) throw new Error("oaep_artifact_resource_ref_required");
  return {
    workspaceId: reference.workspace_id,
    operation: "artifact.metadata",
    params: { artifact_id: reference.resource_id },
  };
}

export async function readOaepArtifactMetadata(
  client: Pick<RuntimeClient, "executeOWOP">,
  item: OaepItem,
): Promise<Record<string, unknown>> {
  const request = oaepArtifactMetadataRequest(item);
  return client.executeOWOP(request.workspaceId, request.operation, request.params);
}
