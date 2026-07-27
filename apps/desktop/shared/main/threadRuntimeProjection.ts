import { createHash } from "node:crypto";
import type {
  DesktopThread,
  DesktopThreadMessageSnapshot,
  DesktopThreadSnapshot,
} from "../api/desktopApi";
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

function toMessage(item: RuntimeConversationItem): DesktopThreadMessageSnapshot | null {
  const at = timestamp(item.updated_at);
  if (item.kind === "message") {
    const role = item.role === "user" || item.role === "system" ? item.role : "assistant";
    return {
      id: item.item_id, role, content: text(item.payload),
      streaming: role === "assistant" && item.payload.status !== "completed",
      startedAt: timestamp(item.created_at), lastEventAt: at,
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
  const messages = [...items]
    .sort((left, right) => left.session_sequence - right.session_sequence || left.item_id.localeCompare(right.item_id))
    .map(toMessage)
    .filter((item): item is DesktopThreadMessageSnapshot => item !== null);
  return {
    threadId: thread.id,
    title: thread.title,
    messages,
    updatedAt: Math.max(timestamp(thread.updatedAt), ...messages.map((message) => message.lastEventAt || 0)),
    messageCount: messages.length,
  };
}
