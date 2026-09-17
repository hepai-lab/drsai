export interface ConversationResourcePreviewFrameProps {
  url: string;
  isolatedOrigin: string;
  title: string;
}

export function conversationResourcePreviewFrameProps({ url, isolatedOrigin, title }: ConversationResourcePreviewFrameProps) {
  const target = new URL(url);
  const isolated = new URL(isolatedOrigin);
  if (target.protocol !== "https:" || isolated.protocol !== "https:" || target.origin !== isolated.origin) {
    throw new Error("conversation_resource_preview_origin_invalid");
  }
  return { src: target.toString(), title: title.slice(0, 512), sandbox: "" as const, referrerPolicy: "no-referrer" as const, allow: "" };
}
