import type { ChatAttachment, ChatDraftPart } from "@shared/desktopApi";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isAbsoluteLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveMentionPath(rawPath: string, workspacePath: string): string {
  const trimmed = rawPath.trim();
  if (isAbsoluteLocalPath(trimmed) || !workspacePath.trim()) return trimmed;
  const separator = workspacePath.includes("/") && !workspacePath.includes("\\") ? "/" : "\\";
  const base = workspacePath.replace(/[\\/]+$/, "");
  const relative = trimmed.replace(/^[.][\\/]/, "").replace(/[\\/]+/g, separator);
  return `${base}${separator}${relative}`;
}

/** Convert Composer mentions into ordered text/attachment Parts without exposing paths as prose. */
export function buildComposerDraftParts(
  input: string,
  attachments: ChatAttachment[],
  inlineMentions: ChatAttachment[],
  workspacePath: string,
): ChatDraftPart[] {
  const inlineIndexes = new Map<string, number>();
  for (const mention of inlineMentions) {
    const key = `${mention.kind}:${normalizePath(mention.path)}`;
    for (let index = attachments.length - 1; index >= 0; index -= 1) {
      const candidate = attachments[index];
      if (`${candidate.kind}:${normalizePath(candidate.path)}` === key) {
        inlineIndexes.set(key, index);
        break;
      }
    }
  }
  const parts: ChatDraftPart[] = [];
  const inlineAttachmentIndexes = new Set(inlineIndexes.values());
  attachments.forEach((_attachment, index) => {
    if (!inlineAttachmentIndexes.has(index)) parts.push({ type: "attachment", attachmentIndex: index });
  });
  const appendText = (text: string): void => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.type === "text") previous.text += text;
    else parts.push({ type: "text", text });
  };
  const pattern = /(?:^|\s)@(file|folder):(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+))/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const leadingWhitespace = /^\s/.test(match[0]) ? match[0][0] : "";
    const mentionStart = match.index + leadingWhitespace.length;
    const rawPath = (match[2] || match[3] || match[4] || match[5] || "").trim();
    const key = `${match[1].toLowerCase()}:${normalizePath(resolveMentionPath(rawPath, workspacePath))}`;
    const attachmentIndex = inlineIndexes.get(key);
    if (attachmentIndex === undefined) continue;
    appendText(input.slice(cursor, mentionStart));
    parts.push({ type: "attachment", attachmentIndex });
    cursor = pattern.lastIndex;
  }
  appendText(input.slice(cursor));
  return parts;
}
