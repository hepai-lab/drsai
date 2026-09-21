import type {
  ConversationResourceDownloadRequest,
  ConversationResourcePreviewRequest,
  ConversationResourceResolveRequest,
  ConversationResourceResolveResult,
  ConversationResourceStateEvent,
  ConversationResourceSubscriptionRequest,
  WorkspaceFilePreview,
} from "../api/desktopApi";
import { ConversationResourceHostRouter } from "./conversationResourceHostRouter";
import { previewOaepResource, resolveOaepResource, saveOaepResourceToFile } from "./oaepOwopResources";
import { withRuntimeClientForWorkspace } from "./runtimeClient";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const RESOURCE_EVENT_STATES = new Set<ConversationResourceResolveResult["state"]>([
  "available", "moved", "changed", "deleted", "offline", "unsupported",
]);

type ValidIdentity =
  | { kind: "p2"; sessionId: string; associationId: string }
  | { kind: "p1"; resourceRef: NonNullable<ConversationResourceResolveRequest["resourceRef"]> };

export function conversationResourceIdentity(request: ConversationResourceResolveRequest): ValidIdentity {
  if (!request?.workspacePath) throw new Error("conversation_resource_request_invalid");
  const hasSession = typeof request.sessionId === "string" && request.sessionId.length > 0;
  const hasAssociation = typeof request.associationId === "string" && request.associationId.length > 0;
  if (hasSession !== hasAssociation) throw new Error("conversation_resource_request_invalid");
  if (hasSession && hasAssociation) {
    if (request.resourceRef) throw new Error("conversation_resource_request_ambiguous");
    return { kind: "p2", sessionId: request.sessionId!, associationId: request.associationId! };
  }
  if (!request.resourceRef) throw new Error("conversation_resource_request_invalid");
  return { kind: "p1", resourceRef: request.resourceRef };
}

export async function pollConversationResourceEvents(
  request: ConversationResourceSubscriptionRequest,
  afterSequence: number,
): Promise<{ cursor: number; events: Omit<ConversationResourceStateEvent, "subscriptionId">[] }> {
  if (!request?.workspacePath || !request.sessionId || !Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error("conversation_resource_subscription_invalid");
  }
  return withRuntimeClientForWorkspace(request.workspacePath, undefined, async ({ client, workspaceId }) => {
    const raw = await client.executeOWOP(
      workspaceId, "resources.subscribe",
      { after_sequence: afterSequence, limit: 100 },
      { sessionId: request.sessionId },
    );
    const cursor = Number(raw.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < afterSequence || !Array.isArray(raw.events)) {
      throw new Error("conversation_resource_subscription_result_invalid");
    }
    const events = raw.events.map((candidate): Omit<ConversationResourceStateEvent, "subscriptionId"> | null => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
      const event = candidate as Record<string, unknown>;
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? event.data as Record<string, unknown> : null;
      const resource = data?.resource && typeof data.resource === "object" && !Array.isArray(data.resource)
        ? data.resource as Record<string, unknown> : null;
      const sequence = Number(event.sequence);
      if (!Number.isSafeInteger(sequence) || sequence <= afterSequence || typeof event.type !== "string") return null;
      const state = typeof data?.state === "string" && RESOURCE_EVENT_STATES.has(data.state as ConversationResourceResolveResult["state"])
        ? data.state as ConversationResourceResolveResult["state"] : undefined;
      return {
        workspacePath: request.workspacePath, sessionId: request.sessionId,
        sequence, eventType: event.type,
        ...(typeof resource?.resource_id === "string" ? { resourceId: resource.resource_id } : {}),
        ...(state ? { state } : {}),
        ...(typeof data?.version_id === "string" ? { versionId: data.version_id } : {}),
      };
    }).filter((event): event is Omit<ConversationResourceStateEvent, "subscriptionId"> => event !== null);
    return { cursor, events };
  });
}

export async function resolveConversationResourceRequest(
  request: ConversationResourceResolveRequest,
  requestedAction: "resolve" | "reveal" | "copy_logical_path" = "resolve",
): Promise<ConversationResourceResolveResult> {
  const selected = conversationResourceIdentity(request);
  return withRuntimeClientForWorkspace(
    request.workspacePath,
    selected.kind === "p1" ? selected.resourceRef.workspace_id : undefined,
    async ({ client, workspaceId }) => {
      const result = selected.kind === "p2"
        ? await new ConversationResourceHostRouter(client).resolve(selected.sessionId, selected.associationId, requestedAction)
        : await resolveOaepResource(client, selected.resourceRef);
      if (workspaceId !== result.workspaceId) throw new Error("conversation_resource_workspace_mismatch");
      return result;
    },
  );
}

export async function previewConversationResourceRequest(
  request: ConversationResourcePreviewRequest,
): Promise<WorkspaceFilePreview> {
  const selected = conversationResourceIdentity(request);
  return withRuntimeClientForWorkspace(
    request.workspacePath,
    selected.kind === "p1" ? selected.resourceRef.workspace_id : undefined,
    async ({ client, workspaceId }) => {
      const result = selected.kind === "p2"
        ? await new ConversationResourceHostRouter(client).preview(
          selected.sessionId, selected.associationId, request.workspacePath, request.maxBytes,
          request.version,
        )
        : await previewOaepResource(client, selected.resourceRef, request.workspacePath, request.maxBytes);
      if (workspaceId !== result.metadata?.workspaceId && selected.kind === "p2") {
        throw new Error("conversation_resource_workspace_mismatch");
      }
      return result;
    },
  );
}

/** Re-authorize a local reveal and expose the canonical path only to main. */
export async function resolveConversationResourceRevealPath(
  request: ConversationResourceResolveRequest,
): Promise<string> {
  const resolved = await resolveConversationResourceRequest(request, "reveal");
  return canonicalConversationResourceRevealPath(request.workspacePath, resolved);
}

/** Re-authorize copy-path at click time; the Renderer never trusts menu state. */
export async function resolveConversationResourceLogicalPath(
  request: ConversationResourceResolveRequest,
): Promise<string> {
  const resolved = await resolveConversationResourceRequest(request, "copy_logical_path");
  if (!resolved.capabilities.copyLogicalPath || !resolved.logicalPath) {
    throw new Error("conversation_resource_copy_path_unavailable");
  }
  return resolved.logicalPath;
}

export async function canonicalConversationResourceRevealPath(
  workspacePath: string,
  resolved: ConversationResourceResolveResult,
): Promise<string> {
  if (!resolved.capabilities.reveal || ["deleted", "offline", "unsupported"].includes(resolved.state)) {
    throw new Error("conversation_resource_reveal_unavailable");
  }
  const root = await realpath(resolve(workspacePath));
  const candidateValue = resolved.logicalPath || resolved.path;
  if (!candidateValue) throw new Error("conversation_resource_reveal_unavailable");
  const candidate = await realpath(isAbsolute(candidateValue) ? candidateValue : resolve(root, candidateValue));
  const child = relative(root, candidate);
  if (child.startsWith("..") || isAbsolute(child)) throw new Error("conversation_resource_reveal_outside_workspace");
  return candidate;
}

/** Resolve and authorize download before a native Save dialog is shown. */
export async function prepareConversationResourceDownload(
  request: ConversationResourceDownloadRequest,
): Promise<{ name: string; workspaceId: string }> {
  const resolved = await resolveConversationResourceRequest(request);
  if (!resolved.capabilities.download || ["deleted", "offline", "unsupported"].includes(resolved.state)) {
    throw new Error("conversation_resource_download_unavailable");
  }
  return { name: resolved.name, workspaceId: resolved.workspaceId };
}

export async function saveConversationResourceRequest(
  request: ConversationResourceDownloadRequest,
  destinationPath: string,
  expectedWorkspaceId: string,
  signal?: AbortSignal,
  onProgress?: (transferredBytes: number, totalBytes: number) => void,
): Promise<{ name: string; size: number; digest?: string }> {
  const selected = conversationResourceIdentity(request);
  return withRuntimeClientForWorkspace(
    request.workspacePath,
    selected.kind === "p1" ? selected.resourceRef.workspace_id : undefined,
    ({ client, workspaceId }) => {
      if (workspaceId !== expectedWorkspaceId) throw new Error("conversation_resource_workspace_mismatch");
      return selected.kind === "p2"
        ? new ConversationResourceHostRouter(client).save(selected.sessionId, selected.associationId, destinationPath, signal, onProgress)
        : saveOaepResourceToFile(client, selected.resourceRef, destinationPath);
    },
  );
}
