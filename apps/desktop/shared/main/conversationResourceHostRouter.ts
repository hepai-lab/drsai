import {
  parseConversationResourceAssociation,
  projectOaepConversationResources,
  type ConversationResourceAssociation,
} from "../../../../cores/protocol/oaep/conversationResourceProjection";
import { createHash } from "node:crypto";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { OaepSnapshot } from "../api/oaep.generated";
import {
  commitValidatedDownload,
  type PreviewedOaepResource,
  type ResolvedOaepResource,
} from "./oaepOwopResources";

interface RouterRuntimeClient {
  getOaepSnapshot(sessionId: string): Promise<OaepSnapshot>;
  executeOWOP(
    workspaceId: string,
    operation: string,
    params: Record<string, unknown>,
    context?: { sessionId: string },
  ): Promise<Record<string, unknown>>;
}

const STATES = new Set<ResolvedOaepResource["state"]>([
  "available", "moved", "changed", "deleted", "offline", "unsupported",
]);
const CAPABILITIES = ["read_current", "read_snapshot", "preview", "download", "reveal", "open_external", "copy_logical_path"] as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unsupported(association: ConversationResourceAssociation): ResolvedOaepResource {
  return {
    workspaceId: association.resource.workspace_id,
    resourceId: association.resource.resource_id,
    resourceType: association.resource.resource_type === "artifact" ? "artifact" : "file",
    state: "unsupported",
    name: association.label_snapshot,
    capabilities: { read: false, preview: false, download: false, reveal: false, openExternal: false, copyLogicalPath: false },
  };
}

/**
 * Main-process trust boundary for P2 conversation resource actions.
 * Renderer identity is only sessionId + associationId. The authoritative
 * ResourceKey, locator, version and authority are reloaded from OAEP.
 */
export class ConversationResourceHostRouter {
  constructor(private readonly client: RouterRuntimeClient) {}

  async association(sessionId: string, associationId: string): Promise<ConversationResourceAssociation> {
    if (!sessionId || !associationId) throw new Error("conversation_resource_identity_invalid");
    const snapshot = await this.client.getOaepSnapshot(sessionId);
    if (snapshot.session.id !== sessionId) throw new Error("conversation_resource_session_mismatch");
    const projection = projectOaepConversationResources(snapshot);
    const raw = projection.associations.find((candidate) => candidate.association_id === associationId);
    const association = parseConversationResourceAssociation(raw);
    if (!association) throw new Error("conversation_resource_association_not_found");
    return association;
  }

  private async resolved(
    sessionId: string,
    associationId: string,
    requestedAction: "resolve" | "reveal" | "open_external" | "copy_logical_path" | "open_snapshot" = "resolve",
  ): Promise<{ association: ConversationResourceAssociation; descriptor: Record<string, unknown> | null; result: ResolvedOaepResource }> {
    const association = await this.association(sessionId, associationId);
    const raw = await this.client.executeOWOP(
      association.resource.workspace_id,
      "resources.resolve_batch",
      { observations: [{
        association_id: association.association_id,
        resource: association.resource,
        requested_action: requestedAction,
        ...(association.version_snapshot?.version_id
          ? { observed_version_id: association.version_snapshot.version_id }
          : {}),
      }] },
      { sessionId },
    );
    const first = Array.isArray(raw.results) ? record(raw.results[0]) : null;
    const descriptor = record(first?.descriptor);
    const resource = record(descriptor?.resource);
    const capabilities = record(descriptor?.capabilities);
    const currentVersion = record(descriptor?.current_version);
    if (!descriptor || !resource || !capabilities || !currentVersion ||
        !STATES.has(descriptor.state as ResolvedOaepResource["state"]) ||
        CAPABILITIES.some((name) => typeof capabilities[name] !== "boolean") ||
        typeof descriptor.display_name !== "string" || typeof currentVersion.version_id !== "string" ||
        typeof currentVersion.size !== "number" || typeof currentVersion.digest !== "string" ||
        !DIGEST.test(currentVersion.digest)) {
      return { association, descriptor: null, result: unsupported(association) };
    }
    const result: ResolvedOaepResource = {
      workspaceId: association.resource.workspace_id,
      resourceId: association.resource.resource_id,
      resourceType: association.resource.resource_type === "artifact" ? "artifact" : "file",
      state: descriptor.state as ResolvedOaepResource["state"],
      name: descriptor.display_name,
      ...(typeof descriptor.logical_path === "string" ? { logicalPath: descriptor.logical_path } : {}),
      ...(typeof currentVersion.mime_type === "string" ? { mime: currentVersion.mime_type } : {}),
      ...(typeof currentVersion.size === "number" ? { size: currentVersion.size } : {}),
      ...(typeof currentVersion.digest === "string" ? { digest: currentVersion.digest } : {}),
      ...(typeof currentVersion.modified_at === "string" ? { modifiedAt: currentVersion.modified_at } : {}),
      observedVersionAvailable: Boolean(
        ["changed", "deleted"].includes(String(descriptor.state))
        && record(descriptor.observed_version)
        && capabilities.read_snapshot === true,
      ),
      capabilities: {
        read: capabilities.read_current === true,
        preview: capabilities.preview === true,
        download: capabilities.download === true,
        reveal: capabilities.reveal === true,
        openExternal: capabilities.open_external === true,
        copyLogicalPath: capabilities.copy_logical_path === true,
      },
    };
    return { association, descriptor, result };
  }

  async resolve(
    sessionId: string,
    associationId: string,
    requestedAction: "resolve" | "reveal" | "open_external" | "copy_logical_path" | "open_snapshot" = "resolve",
  ): Promise<ResolvedOaepResource> {
    return (await this.resolved(sessionId, associationId, requestedAction)).result;
  }

  async preview(
    sessionId: string,
    associationId: string,
    workspacePath: string,
    maxBytes = 1_000_000,
    requestedVersion: "current" | "observed" = "current",
  ): Promise<PreviewedOaepResource> {
    const { association, descriptor, result } = await this.resolved(sessionId, associationId);
    if (!descriptor || (result.state === "deleted" && requestedVersion !== "observed") || result.state === "offline" ||
        result.state === "unsupported" || (!result.capabilities.preview && requestedVersion !== "observed")) {
      throw new Error("conversation_resource_preview_unavailable");
    }
    const version = requestedVersion === "observed" ? record(descriptor.observed_version) : record(descriptor.current_version);
    if (!version || (requestedVersion === "observed" && !result.observedVersionAvailable)) {
      throw new Error("conversation_resource_observed_version_unavailable");
    }
    const bounded = Math.max(1, Math.min(Math.trunc(maxBytes), 1_000_000));
    const raw = await this.client.executeOWOP(association.resource.workspace_id, "resources.preview", {
      resource: association.resource,
      version_id: version.version_id,
      accept_kinds: ["text", "markdown", "json", "image", "pdf", "office"],
      max_bytes: bounded,
    }, { sessionId });
    const encoded = typeof raw.content_base64 === "string" ? raw.content_base64 : "";
    const kind = typeof raw.kind === "string" ? raw.kind : "unknown";
    const mime = typeof raw.mime_type === "string" ? raw.mime_type : result.mime || "application/octet-stream";
    const virtualPath = `resource://${association.resource.authority_id}/${association.resource.workspace_id}/${association.resource.resource_id}`;
    const preview: PreviewedOaepResource = {
      workspacePath, path: virtualPath, relativePath: result.name, name: result.name,
      kind: (["text", "markdown", "json", "image", "pdf", "office"].includes(kind) ? kind : "unknown") as PreviewedOaepResource["kind"],
      mime, size: result.size ?? 0, modifiedAt: result.modifiedAt || "", truncated: false,
      ...(result.digest ? { fileHash: result.digest.replace(/^sha256:/, "") } : {}),
      metadata: { runtimeOwned: true, associationId, resourceId: result.resourceId, workspaceId: result.workspaceId, version: requestedVersion },
    };
    if (encoded) {
      const bytes = strictBase64(encoded);
      if (kind === "image") preview.dataUrl = `data:${mime};base64,${encoded}`;
      else if (["text", "markdown", "json", "office"].includes(kind)) preview.content = new TextDecoder().decode(bytes);
    }
    if (!preview.content && !preview.dataUrl) preview.message = "This resource has no safe inline representation.";
    return preview;
  }

  async save(
    sessionId: string,
    associationId: string,
    destinationPath: string,
    signal?: AbortSignal,
    onProgress?: (transferredBytes: number, totalBytes: number) => void,
  ): Promise<{ name: string; size: number; digest: string }> {
    const { association, descriptor, result } = await this.resolved(sessionId, associationId);
    if (!descriptor || result.state === "deleted" || result.state === "offline" ||
        result.state === "unsupported" || !result.capabilities.download) {
      throw new Error("conversation_resource_download_unavailable");
    }
    const version = record(descriptor.current_version)!;
    const expectedVersionId = String(version.version_id);
    const expectedSizeFromDescriptor = Number(version.size);
    const partial = resumablePartialPath(destinationPath, sessionId, associationId, expectedVersionId);
    await removeStaleResumablePartials(partial);
    const { handle, resumedBytes } = await openResumablePartial(partial.path, expectedSizeFromDescriptor);
    const digest = createHash("sha256");
    let offset = resumedBytes;
    let downloadId = "";
    let expectedSize = expectedSizeFromDescriptor;
    let expectedDigest = String(version.digest || "");
    try {
      for (let position = 0; position < offset;) {
        const buffer = Buffer.allocUnsafe(Math.min(1_048_576, offset - position));
        const read = await handle.read(buffer, 0, buffer.length, position);
        if (read.bytesRead !== buffer.length) throw new Error("conversation_resource_download_partial_invalid");
        digest.update(buffer);
        position += read.bytesRead;
      }
      const prepared = await this.client.executeOWOP(association.resource.workspace_id, "resources.download.prepare", {
        resource: association.resource, version_id: expectedVersionId, suggested_name: result.name,
        ...(offset ? { resume_offset: offset } : {}),
      }, { sessionId });
      downloadId = typeof prepared.download_id === "string" ? prepared.download_id : "";
      expectedSize = Number(prepared.size);
      expectedDigest = typeof prepared.digest === "string" ? prepared.digest : "";
      if (!downloadId || prepared.version_id !== expectedVersionId || !Number.isSafeInteger(expectedSize) || expectedSize < 0 ||
          expectedSize > 2 * 1024 * 1024 * 1024 || expectedSize !== expectedSizeFromDescriptor ||
          !DIGEST.test(expectedDigest) || (result.digest && result.digest !== expectedDigest) || offset > expectedSize) {
        throw new Error("conversation_resource_download_prepare_invalid");
      }
      onProgress?.(offset, expectedSize);
      while (offset < Number(expectedSize)) {
        if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
        const requested = Math.max(65_536, Math.min(1_048_576, Number(expectedSize) - offset));
        const chunk = await this.client.executeOWOP(association.resource.workspace_id, "resources.download.chunk", {
          download_id: downloadId, offset, length: requested,
        }, { sessionId });
        if (chunk.offset !== offset || typeof chunk.content_base64 !== "string" || typeof chunk.chunk_digest !== "string") {
          throw new Error("conversation_resource_download_chunk_invalid");
        }
        const bytes = strictBase64(chunk.content_base64);
        const chunkDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (!bytes.length || bytes.length > requested || chunk.length !== bytes.length || chunk.chunk_digest !== chunkDigest) {
          throw new Error("conversation_resource_download_chunk_integrity_mismatch");
        }
        await handle.write(bytes, 0, bytes.length, offset);
        digest.update(bytes);
        offset += bytes.length;
        onProgress?.(offset, Number(expectedSize));
        if (chunk.eof === true && offset !== Number(expectedSize)) throw new Error("conversation_resource_download_truncated");
      }
      await handle.sync();
      await handle.close();
      const actualDigest = `sha256:${digest.digest("hex")}`;
      if (actualDigest !== expectedDigest || (result.digest && result.digest !== actualDigest)) {
        throw new Error("conversation_resource_download_digest_mismatch");
      }
      await commitValidatedDownload(partial.path, destinationPath);
      return { name: result.name, size: offset, digest: actualDigest };
    } catch (error) {
      await handle.close().catch(() => undefined);
      const resumableInterruption = offset > 0 && expectedSize > 100 * 1024 * 1024
        && !signal?.aborted && !isTerminalDownloadError(error);
      if (!resumableInterruption) await rm(partial.path, { force: true }).catch(() => undefined);
      if (downloadId) await this.client.executeOWOP(association.resource.workspace_id, "resources.download.cancel", {
          download_id: downloadId,
        }, { sessionId }).catch(() => undefined);
      throw error;
    }
  }
}

function resumablePartialPath(destinationPath: string, sessionId: string, associationId: string, versionId: string): {
  directory: string; prefix: string; path: string;
} {
  const directory = dirname(destinationPath);
  const identity = createHash("sha256").update(`${sessionId}\0${associationId}`).digest("hex").slice(0, 24);
  const version = createHash("sha256").update(versionId).digest("hex").slice(0, 24);
  const prefix = `.${basename(destinationPath)}.opendrsai-${identity}-`;
  return { directory, prefix, path: join(directory, `${prefix}${version}.partial`) };
}

async function removeStaleResumablePartials(current: { directory: string; prefix: string; path: string }): Promise<void> {
  const names = await readdir(current.directory).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(current.prefix) || !name.endsWith(".partial")) continue;
    const candidate = join(current.directory, name);
    if (candidate === current.path) continue;
    const info = await lstat(candidate).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) await rm(candidate, { force: true });
  }
}

async function openResumablePartial(path: string, expectedSize: number): Promise<{
  handle: Awaited<ReturnType<typeof open>>; resumedBytes: number;
}> {
  try {
    return { handle: await open(path, "wx+", 0o600), resumedBytes: 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 0 || before.size > expectedSize) {
    throw new Error("conversation_resource_download_partial_invalid");
  }
  const handle = await open(path, "r+");
  const after = await handle.stat();
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
    await handle.close().catch(() => undefined);
    throw new Error("conversation_resource_download_partial_identity_changed");
  }
  return { handle, resumedBytes: after.size };
}

function isTerminalDownloadError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const code = error instanceof Error ? error.message : String(error);
  return /^conversation_resource_(?:base64|download_(?:partial|prepare|chunk|truncated|digest)|resource_version_conflict)/.test(code)
    || code === "resource_version_conflict";
}

function strictBase64(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("conversation_resource_base64_invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("conversation_resource_base64_invalid");
  return bytes;
}
