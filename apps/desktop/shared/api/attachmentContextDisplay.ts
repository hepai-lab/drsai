/** Marker injected into the model prompt; must never be shown in chat bubbles. */
export const LOCAL_ATTACHMENT_CONTEXT_MARKER =
  "The user attached the following local context.";

/**
 * Strip the desktop-side attachment injection block from user-visible text.
 * The model still receives the full prompt at send time; conversation history
 * and UI should only keep the user's original question.
 */
export function stripAttachmentContextFromUserContent(content: string): string {
  if (!content) return content;
  const markerIndex = content.indexOf(LOCAL_ATTACHMENT_CONTEXT_MARKER);
  if (markerIndex < 0) return content;
  const before = content.slice(0, markerIndex).replace(/\s+$/u, "");
  return before;
}

export function attachmentNameFromPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "attachment";
  const parts = trimmed.split(/[/\\]/u).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}
