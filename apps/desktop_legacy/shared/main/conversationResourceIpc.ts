import type {
  ConversationResourcePreviewRequest,
  ConversationResourceResolveRequest,
} from "../api/desktopApi";
import {
  previewConversationResourceRequest,
  resolveConversationResourceRequest,
  resolveConversationResourceRevealPath,
  resolveConversationResourceLogicalPath,
} from "./conversationResourceActions";

type Register = (channel: string, handler: (event: unknown, request: never) => unknown) => void;

export interface ConversationResourceReadIpcActions {
  resolve: typeof resolveConversationResourceRequest;
  preview: typeof previewConversationResourceRequest;
  revealPath: typeof resolveConversationResourceRevealPath;
  logicalPath: typeof resolveConversationResourceLogicalPath;
}

const productionActions: ConversationResourceReadIpcActions = {
  resolve: resolveConversationResourceRequest,
  preview: previewConversationResourceRequest,
  revealPath: resolveConversationResourceRevealPath,
  logicalPath: resolveConversationResourceLogicalPath,
};

/** One production registration surface shared by Windows and macOS. */
export function registerConversationResourceReadIpc(
  register: Register,
  revealInSystemFileManager: (canonicalPath: string) => void | Promise<void>,
  actions: ConversationResourceReadIpcActions = productionActions,
): void {
  register("desktop:conversation-resource-resolve", async (_event, raw) =>
    actions.resolve(raw as ConversationResourceResolveRequest));
  register("desktop:conversation-resource-preview", async (_event, raw) =>
    actions.preview(raw as ConversationResourcePreviewRequest));
  register("desktop:conversation-resource-reveal", async (_event, raw) => {
    const path = await actions.revealPath(raw as ConversationResourceResolveRequest);
    await revealInSystemFileManager(path);
    return true;
  });
  register("desktop:conversation-resource-copy-logical-path", async (_event, raw) =>
    actions.logicalPath(raw as ConversationResourceResolveRequest));
}
