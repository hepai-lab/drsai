import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  ChatAttachment,
  DesktopThread,
  DesktopThreadMessageSnapshot,
  DesktopThreadSnapshot,
} from "../api/desktopApi";
import {
  attachmentNameFromPath,
  stripAttachmentContextFromUserContent,
} from "../api/attachmentContextDisplay";
import type { RuntimeConversationItem } from "./runtimeClient";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("conversation_digest_number_invalid");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`conversation_digest_value_invalid:${typeof value}`);
}

export function runtimeConversationDigest(items: Iterable<RuntimeConversationItem>): string {
  const canonical = [...items]
    .sort((left, right) => left.session_sequence - right.session_sequence || left.item_id.localeCompare(right.item_id))
    .map((item) => ({
      item_id: item.item_id,
      session_id: item.session_id,
      run_id: item.run_id,
      kind: item.kind,
      role: item.role,
      revision: item.revision,
      session_sequence: item.session_sequence,
      source_client: item.source_client,
      source_message_id: item.source_message_id,
      payload: item.payload,
    }));
  return createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function text(payload: Record<string, unknown>): string {
  const value = payload.content ?? payload.text ?? payload.delta ?? payload.summary ?? payload.name;
  return typeof value === "string" ? value : "";
}

function attachmentsFromPayload(payload: Record<string, unknown>): ChatAttachment[] | undefined {
  const refs = payload.attachment_refs;
  if (!Array.isArray(refs) || !refs.length) return undefined;
  const attachments = refs
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 40)
    .map((path): ChatAttachment => {
      const normalized = path.trim();
      const name = attachmentNameFromPath(normalized);
      // Runtime only stores paths; folders still render as file chips which is acceptable.
      return { kind: "file", path: normalized, name: name || basename(normalized) || "attachment" };
    });
  return attachments.length ? attachments : undefined;
}

function toMessage(item: RuntimeConversationItem): DesktopThreadMessageSnapshot | null {
  const at = timestamp(item.updated_at);
  if (item.kind === "message") {
    const role = item.role === "user" || item.role === "system" ? item.role : "assistant";
    const rawContent = text(item.payload);
    const content = role === "user" ? stripAttachmentContextFromUserContent(rawContent) : rawContent;
    const attachments = role === "user" ? attachmentsFromPayload(item.payload) : undefined;
    return {
      id: item.item_id,
      role,
      content,
      streaming: role === "assistant" && item.payload.status !== "completed",
      ...(attachments ? { attachments } : {}),
      startedAt: timestamp(item.created_at),
      lastEventAt: at,
    };
  }
  if (item.kind === "reasoning") {
    return {
      id: item.item_id, role: "assistant", content: "",
      reasoningContent: text(item.payload), startedAt: timestamp(item.created_at), lastEventAt: at,
    };
  }
  if (item.kind === "error") {
    return {
      id: item.item_id, role: "assistant", content: text(item.payload),
      error: true, startedAt: timestamp(item.created_at), lastEventAt: at,
    };
  }
  const labels = { tool: "Tool", approval: "Approval", artifact: "Artifact" } as const;
  const label = labels[item.kind as keyof typeof labels];
  if (!label) return null;
  const detail = text(item.payload);
  const status = typeof item.payload.status === "string" ? ` · ${item.payload.status}` : "";
  return {
    id: item.item_id, role: "assistant", content: "",
    statusContent: `${label}${detail ? `: ${detail}` : ""}${status}`,
    startedAt: timestamp(item.created_at), lastEventAt: at,
  };
}

export function projectRuntimeThreadSnapshot(
  thread: DesktopThread,
  items: Iterable<RuntimeConversationItem>,
): DesktopThreadSnapshot {
  const projected = [...items]
    .sort((left, right) => left.session_sequence - right.session_sequence || left.item_id.localeCompare(right.item_id))
    .map(toMessage)
    .filter((item): item is DesktopThreadMessageSnapshot => item !== null);
  const messages = coalesceRuntimeAssistantMessages(projected);
  return {
    threadId: thread.id,
    title: thread.title,
    messages,
    updatedAt: Math.max(timestamp(thread.updatedAt), ...messages.map((message) => message.lastEventAt || 0), 0),
    messageCount: messages.length,
  };
}

function assistantBody(message: DesktopThreadMessageSnapshot): string {
  return [
    message.content,
    message.reasoningContent,
    message.statusContent,
  ].map((value) => value?.trim() ?? "").filter(Boolean).join("\n");
}

function isThinAssistant(message: DesktopThreadMessageSnapshot): boolean {
  return message.role === "assistant" && !message.content.trim();
}

function mergeReasoningText(left?: string, right?: string): string | undefined {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  if (a.includes(b) || b.includes(a)) return a.length >= b.length ? a : b;
  return `${a}\n\n${b}`;
}

function mergeAssistantSnapshots(
  primary: DesktopThreadMessageSnapshot,
  secondary: DesktopThreadMessageSnapshot,
): DesktopThreadMessageSnapshot {
  const preferSecondaryContent = !primary.content.trim() && Boolean(secondary.content.trim());
  return {
    ...primary,
    id: preferSecondaryContent ? secondary.id : primary.id,
    content: primary.content.trim() || secondary.content,
    reasoningContent: mergeReasoningText(primary.reasoningContent, secondary.reasoningContent),
    statusContent: mergeReasoningText(primary.statusContent, secondary.statusContent),
    streaming: Boolean(primary.streaming || secondary.streaming),
    error: Boolean(primary.error || secondary.error),
    attachments: primary.attachments?.length ? primary.attachments : secondary.attachments,
    structuredTurn: primary.structuredTurn ?? secondary.structuredTurn,
    startedAt: Math.min(primary.startedAt ?? Number.MAX_SAFE_INTEGER, secondary.startedAt ?? Number.MAX_SAFE_INTEGER),
    lastEventAt: Math.max(primary.lastEventAt ?? 0, secondary.lastEventAt ?? 0),
  };
}

/**
 * Runtime journals reasoning / tool / message as separate items. Fold adjacent
 * assistant fragments into one bubble so the UI does not show empty
 * "No response content." shells plus a detached reasoning block.
 */
export function coalesceRuntimeAssistantMessages(
  messages: DesktopThreadMessageSnapshot[],
): DesktopThreadMessageSnapshot[] {
  const merged: DesktopThreadMessageSnapshot[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      merged.push(message);
      continue;
    }
    if (!assistantBody(message) && !message.streaming && !message.error) {
      continue;
    }
    const previous = merged[merged.length - 1];
    if (previous?.role === "assistant" && (isThinAssistant(previous) || isThinAssistant(message))) {
      merged[merged.length - 1] = mergeAssistantSnapshots(previous, message);
      continue;
    }
    merged.push(message);
  }
  return merged;
}
