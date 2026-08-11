import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  ChatAttachment,
  DesktopThread,
  DesktopThreadMessageSnapshot,
  DesktopThreadSnapshot,
  DesktopThreadHistoryState,
} from "../api/desktopApi";
import {
  attachmentNameFromPath,
  stripAttachmentContextFromUserContent,
} from "../api/attachmentContextDisplay";
import type {
  StructuredActivityEvent,
  StructuredAssistantPart,
  StructuredPartStatus,
  StructuredTurnState,
} from "../api/structuredConversation";
import type { RuntimeConversationItem } from "./runtimeClient";
import type { OaepItem, OaepRun } from "./runtimeClient";

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

function oaepRecord(content: object): Record<string, unknown> {
  return content as unknown as Record<string, unknown>;
}

function oaepText(content: object): string {
  const record = oaepRecord(content);
  // OAEP parts are the canonical multimodal representation. Prefer their
  // textual projection over the legacy flat `text` compatibility field so a
  // corrected adapter projection renders immediately, even while persisted
  // v1 records are being revision-migrated in the background.
  if (Array.isArray(record.parts)) {
    const partText = record.parts
      .flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const value = (part as Record<string, unknown>).text;
        return typeof value === "string" && value ? [value] : [];
      })
      .join("\n");
    if (partText) return partText;
  }
  const value = record.text ?? record.output ?? record.summary ?? record.message ?? record.name;
  return typeof value === "string" ? value : "";
}

function compactValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function oaepDetail(item: OaepItem): string {
  if (item.type === "tool_call") {
    const content = item.content;
    const name = compactValue(content.tool_name || "tool");
    const result = compactValue(content.result);
    return result ? `${name}: ${result}` : name;
  }
  if (item.type === "interaction") {
    const content = item.content;
    return compactValue(content.prompt);
  }
  if (item.type === "artifact") {
    const content = item.content;
    const name = compactValue(content.name || content.artifact_id || "artifact");
    const summary = compactValue(content.summary);
    return summary ? `${name}: ${summary}` : name;
  }
  if (item.type === "notice") {
    const content = item.content;
    const code = compactValue(content.code);
    const message = compactValue(content.message);
    return code && message ? `${code}: ${message}` : (message || code);
  }
  return oaepText(item.content);
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
  const labels = { tool: "Tool", file_change: "File change", approval: "Approval", artifact: "Artifact" } as const;
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

export function oaepToMessage(item: OaepItem): DesktopThreadMessageSnapshot | null {
  const at = timestamp(item.updated_at);
  if (item.type === "message") {
    const rawRole = item.content.role;
    const role = rawRole === "user" || rawRole === "system" ? rawRole : "assistant";
    return {
      id: item.id, role, content: oaepText(item.content),
      streaming: role === "assistant" && item.status !== "completed",
      startedAt: timestamp(item.created_at), lastEventAt: at,
    };
  }
  if (item.type === "reasoning") {
    const segments = Array.isArray(item.content.segments) ? item.content.segments : [];
    const reasoning = segments
      .filter((segment) => !segment.visibility || segment.visibility === "user")
      .map((segment) => segment && typeof segment === "object" && "text" in segment ? String((segment as { text?: unknown }).text ?? "") : "")
      .filter(Boolean)
      .join("\n");
    return {
      id: item.id, role: "assistant", content: "",
      reasoningContent: reasoning || oaepText(item.content), startedAt: timestamp(item.created_at), lastEventAt: at,
    };
  }
  if (item.type === "notice") {
    return {
      id: item.id, role: "assistant", content: oaepText(item.content),
      error: item.content.level === "error" || item.status === "failed",
      startedAt: timestamp(item.created_at), lastEventAt: at,
    };
  }
  const labels: Record<string, string> = {
    command_execution: "Command",
    tool_call: "Tool",
    interaction: "Interaction",
    artifact: "Artifact",
    file_change: "File change",
    plan: "Plan",
    subtask: "Subtask",
  };
  const label = labels[item.type];
  if (!label) return null;
  const detail = oaepDetail(item);
  return {
    id: item.id, role: "assistant", content: "",
    statusContent: `${label}${detail ? `: ${detail}` : ""} · ${item.status}`,
    startedAt: timestamp(item.created_at), lastEventAt: at,
  };
}

function structuredStatus(status: OaepItem["status"] | OaepRun["status"]): StructuredPartStatus {
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  if (status === "pending") return "pending";
  return "running";
}

export function projectOaepAssistantItem(item: OaepItem, runId: string, includeEmpty = false): {
  parts: StructuredAssistantPart[];
  activities: StructuredActivityEvent[];
} {
  const status = structuredStatus(item.status);
  if (item.type === "message") {
    const markdown = oaepText(item.content);
    if ((!markdown && !includeEmpty) || item.content.role !== "assistant") return { parts: [], activities: [] };
    return item.content.phase === "commentary"
      ? { parts: [{ id: item.id, kind: "progress", status, summary: markdown, phase: "commentary" }], activities: [] }
      : { parts: [{ id: item.id, kind: "markdown", status, markdown }], activities: [] };
  }
  if (item.type === "reasoning") {
    const visibleSegments = item.content.segments.filter((segment) => !segment.visibility || segment.visibility === "user");
    if (!visibleSegments.length && !includeEmpty) return { parts: [], activities: [] };
    return { parts: [{
      id: item.id, kind: "reasoning", status,
      segments: visibleSegments.flatMap((segment, index) => {
        const text = segment && typeof segment.text === "string" ? segment.text : "";
        return text ? [{
          id: String(segment.id || `${item.id}:${index + 1}`), text, status,
          reasoningKind: segment.kind,
          visibility: segment.visibility,
          source: segment.source,
        }] : [];
      }),
    }], activities: [] };
  }
  if (item.type === "plan") return { parts: [{ id: item.id, kind: "progress", status, summary: oaepText(item.content) || "Plan", phase: "plan" }], activities: [] };
  if (item.type === "notice") return { parts: [{
    id: item.id, kind: "notice", status,
    level: item.content.level === "error" ? "error" : item.content.level === "warning" ? "warning" : "info",
    message: String(item.content.message || item.content.code || "Runtime notice"),
  }], activities: [] };
  if (item.type === "subtask") return { parts: [{
    id: item.id, kind: "subtask", status, taskId: item.id, title: String(item.content.title || "Subtask"),
    ...(item.content.agent_name ? { agentName: String(item.content.agent_name) } : {}),
    ...(item.content.summary ? { summary: String(item.content.summary) } : {}),
  }], activities: [] };
  if (item.type === "artifact") {
    const candidate = String(item.content.artifact_type);
    const artifactType = ["file", "image", "table", "report", "patch", "web"].includes(candidate)
      ? candidate as "file" | "image" | "table" | "report" | "patch" | "web" : "file";
    return { parts: [{
      id: item.id, kind: "artifact", status, artifactId: String(item.content.artifact_id || item.id),
      artifactType, name: String(item.content.name || item.id),
      ...(item.content.summary ? { summary: String(item.content.summary) } : {}),
      ...(item.content.path ? { path: String(item.content.path) } : {}),
    }], activities: [] };
  }
  if (item.type === "interaction") {
    const candidate = String(item.content.interaction_type);
    const interactionType = ["approval", "text_input", "choice", "confirmation", "capability_configuration"].includes(candidate)
      ? candidate as "approval" | "text_input" | "choice" | "confirmation" | "capability_configuration" : "approval";
    const summary = item.content.request_summary && typeof item.content.request_summary === "object"
      ? item.content.request_summary as Record<string, unknown> : {};
    return { parts: [{
      id: item.id, kind: "interaction", status, requestId: String(item.content.approval_id || item.id),
      interactionType, prompt: String(item.content.prompt || "Input required"),
      ...(summary.capability ? { capability: String(summary.capability) } : {}),
      ...(summary.resource_kind ? { resourceKind: String(summary.resource_kind) } : {}),
      ...(summary.preferred_adapter ? { preferredAdapter: String(summary.preferred_adapter) } : {}),
      ...(summary.reason ? { reason: String(summary.reason) } : {}),
      ...(typeof summary.query_disclosed === "boolean" ? { queryDisclosed: summary.query_disclosed } : {}),
    }], activities: [] };
  }
  if (item.type === "file_change") {
    const changes = item.content.changes.length ? item.content.changes : [{}];
    return { parts: [], activities: changes.map((change, index) => {
      const candidate = String(change.operation || "modify");
      const action = ["create", "modify", "delete", "rename", "patch"].includes(candidate)
        ? candidate as "create" | "modify" | "delete" | "rename" | "patch" : "modify";
      return {
        id: `${item.id}:${index + 1}`, oaepItemId: item.id, turnId: runId, timestamp: item.updated_at, source: item.source.backend,
        status, title: String(change.path || item.content.summary || "File change"), kind: "file_change" as const,
        path: String(change.path || ""), action,
      };
    }) };
  }
  if (item.type === "command_execution" || item.type === "tool_call") {
    const toolName = item.type === "command_execution"
      ? String(item.content.display_command || "Command") : String(item.content.tool_name || "Tool");
    return { parts: [], activities: [{
      id: item.id, oaepItemId: item.id, turnId: runId, timestamp: item.updated_at, source: item.source.backend,
      status, title: toolName, kind: "tool", toolName, callId: item.type === "tool_call" ? item.content.call_id : item.id,
      ...(item.content.operation_ref ? {
        operationId: item.content.operation_ref.operation_id,
        correlationId: item.content.operation_ref.correlation_id,
        runtimeRunId: item.run_id,
      } : {}),
      input: item.type === "command_execution" ? item.content.command : item.content.arguments,
      output: item.type === "command_execution" ? item.content.output : item.content.result,
      durationMs: item.content.duration_ms ?? undefined,
    }] };
  }
  return { parts: [], activities: [] };
}

function userAttachments(item: OaepItem): ChatAttachment[] {
  if (item.type !== "message") return [];
  return (item.content.parts || []).flatMap<ChatAttachment>((part, index) => {
    if (part.type === "text") return [];
    const reference = part.resource_ref;
    const name = String(part.name || reference?.label || `${part.type} ${index + 1}`);
    if (part.url) return [{ kind: "browser" as const, path: "", name, url: part.url }];
    return [{
      kind: "file" as const, path: "", name,
      ...(reference ? { note: `${reference.resource_type}:${reference.resource_id}` }
        : { blockedReason: "Media content is available only from its source Codex runtime." }),
    }];
  });
}

export function projectOaepThreadSnapshot(
  thread: DesktopThread,
  items: Iterable<OaepItem>,
  runs: Iterable<OaepRun> = [],
  history?: DesktopThreadHistoryState,
): DesktopThreadSnapshot {
  const allItems = [...items];
  const runById = new Map([...runs].map((run) => [run.id, run]));
  let runIds = [...new Set([...runById.keys(), ...allItems.map((item) => item.run_id)])];
  const runsByBackendId = new Map<string, string[]>();
  for (const runId of runIds) {
    const backendRunId = runById.get(runId)?.source?.backend_run_id;
    if (!backendRunId) continue;
    runsByBackendId.set(backendRunId, [...(runsByBackendId.get(backendRunId) || []), runId]);
  }
  const supersededRuns = new Set<string>();
  const mappedItemCounts = new Map<string, number>();
  for (const item of allItems) {
    if (item.source.mapping_version) mappedItemCounts.set(item.run_id, (mappedItemCounts.get(item.run_id) || 0) + 1);
  }
  for (const duplicateRunIds of runsByBackendId.values()) {
    if (duplicateRunIds.length < 2) continue;
    duplicateRunIds.sort((left, right) => {
      return (mappedItemCounts.get(right) || 0) - (mappedItemCounts.get(left) || 0)
        || Number(right.startsWith("run-import-")) - Number(left.startsWith("run-import-"))
        || left.localeCompare(right);
    });
    duplicateRunIds.slice(1).forEach((runId) => supersededRuns.add(runId));
  }
  runIds = runIds.filter((runId) => !supersededRuns.has(runId));
  let projectionWarnings = 0;
  for (const runId of runIds) {
    const sequences = allItems.filter((item) => item.run_id === runId).map((item) => item.sequence).sort((left, right) => left - right);
    for (let index = 0; index < sequences.length; index += 1) {
      if (sequences[index] <= 0 || (index > 0 && sequences[index] === sequences[index - 1])) projectionWarnings += 1;
      if (index > 0 && sequences[index] > sequences[index - 1] + 1) projectionWarnings += 1;
    }
  }
  runIds.sort((leftId, rightId) => {
    const left = runById.get(leftId);
    const right = runById.get(rightId);
    const leftSequence = left?.sequence ?? (left?.source?.backend_run_index != null ? left.source.backend_run_index + 1 : Number.MAX_SAFE_INTEGER);
    const rightSequence = right?.sequence ?? (right?.source?.backend_run_index != null ? right.source.backend_run_index + 1 : Number.MAX_SAFE_INTEGER);
    return leftSequence - rightSequence
      || String(left?.created_at || "").localeCompare(String(right?.created_at || ""))
      || leftId.localeCompare(rightId);
  });
  const messages: DesktopThreadMessageSnapshot[] = [];
  for (const runId of runIds) {
    const runItems = allItems.filter((item) => item.run_id === runId)
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    const run = runById.get(runId);
    let assistantItems: OaepItem[] = [];
    let assistantSegment = 0;
    const flushAssistant = (isLast: boolean) => {
      if (!assistantItems.length) return;
      assistantSegment += 1;
      const turnId = assistantSegment === 1 ? runId : `${runId}:segment:${assistantSegment}`;
      const projected = assistantItems.map((item) => projectOaepAssistantItem(item, turnId));
      const parts = projected.flatMap((value) => value.parts);
      const activities = projected.flatMap((value) => value.activities);
      const status = !isLast ? "completed" : run?.status === "failed" ? "error"
        : run?.status === "cancelled" ? "cancelled" : run?.status === "completed" ? "completed" : "running";
      const itemStartedAt = Math.min(...assistantItems.map((item) => timestamp(item.created_at)));
      const itemCompletedAt = Math.max(...assistantItems.map((item) => timestamp(item.updated_at)));
      const runStartedAt = isLast && run ? timestamp(run.created_at) : itemStartedAt;
      const runCompletedAt = isLast && run
        ? timestamp(run.completed_at || run.updated_at)
        : itemCompletedAt;
      const durationMs = runCompletedAt > runStartedAt ? runCompletedAt - runStartedAt : undefined;
      const structuredTurn: StructuredTurnState = {
        version: 2, turnId, status, parts, activities,
        lastSequence: Math.max(0, ...assistantItems.map((item) => item.sequence)),
        seenDedupeKeys: [], protocolIssues: [],
        meta: {
          backend: run?.source?.backend || assistantItems[0]?.source.backend,
          workspaceLabel: thread.workspacePath?.split(/[\\/]/).filter(Boolean).pop(),
          ...(durationMs !== undefined ? { durationMs } : {}),
        },
      };
      messages.push({
        id: `oaep:${turnId}:assistant`, role: "assistant",
        content: parts.filter((part) => part.kind === "markdown").map((part) => part.markdown).join("\n\n"),
        structuredTurn, streaming: status === "running", error: status === "error",
        reasoningContent: parts.filter((part) => part.kind === "reasoning")
          .flatMap((part) => part.segments).map((segment) => segment.text).join("\n"),
        startedAt: runStartedAt,
        lastEventAt: runCompletedAt,
      });
      assistantItems = [];
    };
    for (const [index, item] of runItems.entries()) {
      if (item.type === "message" && item.content.role === "user") {
        flushAssistant(false);
        messages.push({ id: item.id, role: "user", content: stripAttachmentContextFromUserContent(oaepText(item.content)),
          attachments: userAttachments(item),
          startedAt: timestamp(item.created_at), lastEventAt: timestamp(item.updated_at) });
      } else {
        assistantItems.push(item);
      }
      if (index === runItems.length - 1) flushAssistant(true);
    }
  }
  const effectiveHistory = history && projectionWarnings
    ? {
        ...history,
        state: "partial" as const,
        warningCount: (history.warningCount || 0) + projectionWarnings,
        message: "Some historical content required stable fallback ordering.",
      }
    : history;
  return {
    threadId: thread.id,
    title: thread.title,
    messages,
    updatedAt: Math.max(timestamp(thread.updatedAt), ...messages.map((message) => message.lastEventAt || 0)),
    messageCount: messages.length,
    ...(effectiveHistory ? { history: effectiveHistory } : {}),
  };
}
