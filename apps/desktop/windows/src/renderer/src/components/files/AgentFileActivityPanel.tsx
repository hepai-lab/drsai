import { History } from "lucide-react";
import type { AgentRunFileEvent, ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export interface AgentFileTraceEvent {
  action:
    | "authorized_context"
    | "attached_diff"
    | "attached_instruction"
    | "attached_folder"
    | "agent_run_context_sent"
    | "agent_file_read"
    | "agent_file_write"
    | "agent_file_delete"
    | "agent_artifact";
  at: string;
  hash: string;
  name: string;
  path: string;
  scopeId: string;
  snapshotId: string;
  source?: string;
}

export function AgentFileActivityPanel({
  currentAttachments,
  events,
  language,
  scopeId,
}: {
  currentAttachments: ChatAttachment[];
  events: AgentFileTraceEvent[];
  language: AppLanguage;
  scopeId: string;
}): React.JSX.Element {
  const zh = language === "zh";
  const currentHashes = new Map(
    currentAttachments.map((attachment) => [
      getAttachmentKey(attachment),
      hashAttachment(attachment),
    ]),
  );
  return (
    <section className="files-agent-activity" aria-label="Agent file activity">
      <div className="files-agent-activity-title">
        <History size={13} />
        <span>{zh ? "Agent 文件痕迹" : "Agent File Trace"}</span>
        <small>{events.length} events · {scopeId}</small>
      </div>
      {events.length === 0 ? (
        <p>
          {zh
            ? "尚无文件上下文授权。真实 Agent 读写痕迹将在后续事件流接入。"
            : "No file context authorization yet. Real agent read/write traces will attach to this surface later."}
        </p>
      ) : (
        <ol>
          {events.slice(0, 20).map((event) => {
            const key = `${event.path}\n${event.name}`;
            const stale = currentHashes.has(key) && currentHashes.get(key) !== event.hash;
            return (
              <li
                className={stale ? "stale" : ""}
                key={`${event.snapshotId}-${event.path}`}
              >
                <strong>{formatAction(event.action)}</strong>
                <span title={event.path}>{event.name}</span>
                <small>
                  {new Date(event.at).toLocaleTimeString()} · {event.snapshotId} · {event.hash}
                  {" · "}{event.scopeId}
                  {event.source ? ` · ${event.source}` : ""}
                  {stale ? " · stale" : ""}
                </small>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function createTraceEventsFromAttachments(
  attachments: ChatAttachment[],
  scopeId = "local",
): AgentFileTraceEvent[] {
  const snapshotId = `ctx-${Date.now().toString(36)}`;
  const at = new Date().toISOString();
  return attachments.map((attachment) => ({
    action: classifyAttachmentAction(attachment),
    at,
    hash: hashAttachment(attachment),
    name: attachment.name,
    path: attachment.path,
    scopeId,
    snapshotId,
    source: "explicit user authorization",
  }));
}

export function createAgentRunContextTraceEvents({
  attachments,
  requestId,
  runId,
  scopeId,
}: {
  attachments: ChatAttachment[];
  requestId: string;
  runId: string;
  scopeId: string;
}): AgentFileTraceEvent[] {
  const at = new Date().toISOString();
  return attachments.map((attachment) => ({
    action: "agent_run_context_sent",
    at,
    hash: hashAttachment(attachment),
    name: attachment.name,
    path: attachment.path,
    scopeId,
    snapshotId: `run-${runId}-${requestId.slice(0, 8)}`,
    source: "sent to agent run from Files context",
  }));
}

export function createTraceEventFromAgentFileEvent({
  event,
  requestId,
  runId,
  scopeId,
}: {
  event: AgentRunFileEvent;
  requestId: string;
  runId: string;
  scopeId: string;
}): AgentFileTraceEvent {
  return {
    action: classifyAgentFileEvent(event),
    at: event.timestamp ?? new Date().toISOString(),
    hash: event.hash ?? hashString([event.action, event.path, event.diff ?? ""].join("\n")),
    name: event.name ?? event.path.split(/[\\/]/).filter(Boolean).at(-1) ?? event.path,
    path: event.path,
    scopeId,
    snapshotId: `evt-${runId}-${requestId.slice(0, 8)}`,
    source: event.source ?? "agent file event",
  };
}

function classifyAgentFileEvent(event: AgentRunFileEvent): AgentFileTraceEvent["action"] {
  if (event.action === "read") return "agent_file_read";
  if (event.action === "delete") return "agent_file_delete";
  if (event.action === "artifact") return "agent_artifact";
  return "agent_file_write";
}

function classifyAttachmentAction(
  attachment: ChatAttachment,
): AgentFileTraceEvent["action"] {
  if (attachment.kind === "folder") return "attached_folder";
  if (attachment.name.startsWith("Diff:") || attachment.name.startsWith("Staged Diff:")) {
    return "attached_diff";
  }
  if (/^(AGENTS|DRSAI|CLAUDE|project)\.md$/i.test(attachment.name)) {
    return "attached_instruction";
  }
  return "authorized_context";
}

function formatAction(action: AgentFileTraceEvent["action"]): string {
  if (action === "agent_run_context_sent") return "run";
  if (action === "agent_file_read") return "read";
  if (action === "agent_file_write") return "write";
  if (action === "agent_file_delete") return "delete";
  if (action === "agent_artifact") return "artifact";
  if (action === "attached_diff") return "diff";
  if (action === "attached_folder") return "folder";
  if (action === "attached_instruction") return "instruction";
  return "context";
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getAttachmentKey(attachment: ChatAttachment): string {
  return `${attachment.path}\n${attachment.name}`;
}

function hashAttachment(attachment: ChatAttachment): string {
  if (attachment.fileHash) return attachment.fileHash;
  const input = [
    attachment.kind,
    attachment.path,
    attachment.name,
    attachment.visibleText ?? "",
    attachment.note ?? "",
  ].join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
