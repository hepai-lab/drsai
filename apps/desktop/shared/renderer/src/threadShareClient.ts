import type {
  CreateThreadShareRequest,
  DesktopThreadMessageSnapshot,
  DesktopThreadShareResult,
} from "@shared/desktopApi";
import { renderThreadShareHtml, extractShareMessageText } from "@shared/threadShareHtml";
import { desktopApi } from "./desktopApi";

export type LocalThreadShare = DesktopThreadShareResult & {
  mode: "ipc" | "local";
  blobUrl?: string;
  html?: string;
  fileName?: string;
};

const localShareCache = new Map<string, LocalThreadShare>();

export function hasThreadShareBridge(): boolean {
  const api = window.openDrSai;
  return (
    typeof api?.createThreadShare === "function" &&
    typeof api?.openThreadShare === "function" &&
    typeof api?.revealThreadShare === "function"
  );
}

export async function createThreadShareClient(input: {
  request: CreateThreadShareRequest;
  messages: DesktopThreadMessageSnapshot[];
}): Promise<LocalThreadShare> {
  if (hasThreadShareBridge()) {
    const share = await desktopApi.createThreadShare(input.request);
    return { ...share, mode: "ipc" };
  }

  const selected = input.request.messageIds ? new Set(input.request.messageIds) : null;
  const messages = input.messages
    .filter(
      (message) => message.role !== "system" && (!selected || selected.has(message.id)),
    )
    .map((message) =>
      message.role === "assistant"
        ? {
            ...message,
            // Keep only the final answer in locally generated share pages.
            content: extractShareMessageText(message),
            reasoningContent: undefined,
            statusContent: undefined,
            parts: message.parts?.filter((part) => part.type === "text" || part.type === "error"),
            toolTimeline: undefined,
          }
        : {
            ...message,
            reasoningContent: undefined,
            toolTimeline: undefined,
          },
    );
  if (!messages.length) {
    throw new Error("Select at least one message to share.");
  }

  const shareId = `share-local-${Date.now().toString(36)}`;
  const title = (input.request.title?.trim() || "Shared conversation").slice(0, 120);
  const createdAt = new Date().toISOString();
  const html = renderThreadShareHtml({ shareId, title, createdAt, messages });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const fileName = `${sanitizeFileName(title)}-${shareId.slice(-8)}.html`;
  const share: LocalThreadShare = {
    shareId,
    threadId: input.request.threadId,
    title,
    messageCount: messages.length,
    filePath: fileName,
    fileUrl: blobUrl,
    deepLink: `opendrsai://share/${encodeURIComponent(shareId)}`,
    createdAt,
    readOnly: true,
    mode: "local",
    blobUrl,
    html,
    fileName,
  };
  localShareCache.set(share.shareId, share);
  return share;
}

export async function openThreadShareClient(share: LocalThreadShare): Promise<void> {
  if (share.mode === "ipc" && hasThreadShareBridge()) {
    await desktopApi.openThreadShare(share.filePath);
    return;
  }
  const url = share.blobUrl || share.fileUrl;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    // Popup blocked — fall back to same-tab navigation via temporary anchor.
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }
}

export async function copyThreadShareLinkClient(share: LocalThreadShare): Promise<string> {
  if (share.mode === "ipc" && !share.publicShareUrl) {
    throw new Error(
      share.publishError ||
        "尚未生成可公开访问的分享链接。请先登录，并确认 WebUI 分享服务可用。",
    );
  }
  const text =
    share.publicShareUrl ||
    share.fileName ||
    share.filePath ||
    share.fileUrl;
  await copyTextReliable(text);
  return text;
}

/** Prefer Electron IPC clipboard; fall back to browser APIs when unavailable. */
export async function copyTextReliable(text: string): Promise<void> {
  if (typeof window.openDrSai?.copyTextToClipboard === "function") {
    const ok = await desktopApi.copyTextToClipboard(text);
    if (ok) return;
  }
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Last resort for restricted Chromium clipboard policy.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("Unable to copy to clipboard.");
  }
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "share";
  return cleaned.slice(0, 60);
}
