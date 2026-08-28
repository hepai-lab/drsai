import { basename } from "node:path";
import type {
  ConversationResourceDownloadProgressEvent,
  ConversationResourceDownloadRequest,
  ConversationResourceDownloadResult,
} from "../api/desktopApi";
import {
  prepareConversationResourceDownload,
  saveConversationResourceRequest,
} from "./conversationResourceActions";

type Register = (channel: string, handler: (event: unknown, request: never) => unknown) => void;

export interface ConversationResourceDownloadIpcActions {
  prepare: typeof prepareConversationResourceDownload;
  save: typeof saveConversationResourceRequest;
}

const productionActions: ConversationResourceDownloadIpcActions = {
  prepare: prepareConversationResourceDownload,
  save: saveConversationResourceRequest,
};

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Shared download task lifecycle; platform code only owns the native Save dialog. */
export function registerConversationResourceDownloadIpc(
  register: Register,
  selectDestination: (suggestedName: string) => Promise<string | null>,
  emit: (event: unknown, progress: ConversationResourceDownloadProgressEvent) => void,
  actions: ConversationResourceDownloadIpcActions = productionActions,
): void {
  const active = new Map<string, AbortController>();

  register("desktop:conversation-resource-download", async (event, raw) => {
    const request = raw as ConversationResourceDownloadRequest;
    const operationId = request?.operationId;
    if (typeof operationId !== "string" || !OPERATION_ID.test(operationId) || active.has(operationId)) {
      throw new Error("conversation_resource_download_operation_invalid");
    }
    const prepared = await actions.prepare(request);
    const suggestedName = basename(request.suggestedName || prepared.name);
    emit(event, progress(operationId, "preparing", suggestedName, 0));
    const destinationPath = await selectDestination(suggestedName);
    if (!destinationPath) {
      emit(event, progress(operationId, "cancelled", suggestedName, 0));
      return { canceled: true, name: suggestedName } satisfies ConversationResourceDownloadResult;
    }
    const controller = new AbortController();
    active.set(operationId, controller);
    try {
      const saved = await actions.save(
        request,
        destinationPath,
        prepared.workspaceId,
        controller.signal,
        (transferredBytes, totalBytes) => emit(event, progress(operationId, "downloading", suggestedName, transferredBytes, totalBytes)),
      );
      emit(event, progress(operationId, "completed", saved.name, saved.size, saved.size));
      return { canceled: false, destinationPath, ...saved } satisfies ConversationResourceDownloadResult;
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      emit(event, {
        ...progress(operationId, cancelled ? "cancelled" : "failed", suggestedName, 0),
        ...(!cancelled ? { errorCode: safeErrorCode(error) } : {}),
      });
      if (cancelled) return { canceled: true, name: suggestedName } satisfies ConversationResourceDownloadResult;
      throw error;
    } finally {
      active.delete(operationId);
    }
  });

  register("desktop:conversation-resource-download-cancel", (_event, raw) => {
    const operationId = raw as string;
    if (typeof operationId !== "string" || !OPERATION_ID.test(operationId)) return false;
    const controller = active.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  });
}

function progress(
  operationId: string,
  phase: ConversationResourceDownloadProgressEvent["phase"],
  name: string,
  transferredBytes: number,
  totalBytes?: number,
): ConversationResourceDownloadProgressEvent {
  return {
    operationId,
    phase,
    name,
    transferredBytes,
    ...(totalBytes !== undefined ? {
      totalBytes,
      percent: totalBytes === 0 ? 100 : Math.max(0, Math.min(100, (transferredBytes / totalBytes) * 100)),
    } : {}),
  };
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return /^conversation_resource_[a-z0-9_]+$/.test(value) ? value : "conversation_resource_download_failed";
}
