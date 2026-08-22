import type {
  AgentRunEvent,
  AgentRunFileEvent,
  ChatEvent,
} from "../api/desktopApi";
import type {
  StructuredActivityEvent,
  StructuredAssistantPart,
} from "../api/structuredConversation";

export interface OaepAgentRunBridgeContext {
  requestId: string;
  sessionId: string;
  runId: string;
}

export interface OaepAgentRunBridge {
  map(event: ChatEvent): AgentRunEvent[];
}

/**
 * Adapts the canonical OAEP presentation stream to the compact Agent surface.
 * The bridge is stateful so terminal snapshots and live deltas converge without
 * duplicating text, activities, files, or terminal events.
 */
export function createOaepAgentRunBridge(fallback: OaepAgentRunBridgeContext): OaepAgentRunBridge {
  const textByPart = new Map<string, string>();
  const lastStatusByItem = new Map<string, string>();
  const lastActivityByItem = new Map<string, string>();
  const emittedFiles = new Set<string>();
  let terminal = false;

  return {
    map(event) {
      const base = {
        requestId: event.requestId || fallback.requestId,
        sessionId: event.sessionId || fallback.sessionId,
        runId: event.runId || fallback.runId,
      };
      if (terminal) return [];
      if (event.type === "start") return [{ ...base, type: "start" }];
      if (event.type === "chunk" || event.type === "reasoning") {
        return event.content ? [{ ...base, type: "chunk", content: event.content }] : [];
      }
      if (event.type === "status" || event.type === "connection" || event.type === "tool_timeline" || event.type === "input_request") {
        return [{ ...base, type: "status", content: event.content || event.prompt || event.toolTimeline?.title
          || (event.connection?.status === "restored" ? "Connection restored." : "Runtime activity updated.") }];
      }
      if (event.type === "done") return finish({ ...base, type: "done" });
      if (event.type === "aborted") return finish({ ...base, type: "aborted", error: event.error });
      if (event.type === "error") return finish({ ...base, type: "error", error: event.error, failureRecovery: event.failureRecovery });

      const structured = event.structuredEvent;
      if (!structured) return [];
      const common = { ...base, structuredSequence: structured.sequence };
      if (structured.type === "turn.completed") return finish({ ...common, type: "done" });
      if (structured.type === "turn.cancelled") return finish({ ...common, type: "aborted" });
      if (structured.type === "turn.error") return finish({ ...common, type: "error", error: structured.message });
      if (structured.type === "turn.waiting") {
        return [{ ...common, type: "status", content: structured.reason || "Waiting for the OpenDrSai runtime." }];
      }
      if (structured.type === "turn.resumed") {
        return [{ ...common, type: "status", content: structured.reason || "OpenDrSai runtime resumed." }];
      }
      if (structured.type === "part.delta") {
        const itemBase = { ...common, oaepItemId: structured.partId };
        if (structured.delta.kind === "markdown.append") {
          textByPart.set(structured.partId, `${textByPart.get(structured.partId) || ""}${structured.delta.text}`);
          return structured.delta.text ? [{ ...itemBase, type: "chunk", content: structured.delta.text }] : [];
        }
        if (structured.delta.kind === "reasoning.append") {
          return emitStatus(structured.partId, `Reasoning: ${structured.delta.text}`, itemBase);
        }
        if (structured.delta.kind === "progress.update") {
          return emitStatus(structured.partId, structured.delta.summary || "Plan updated.", itemBase);
        }
        if (structured.delta.kind === "subtask.update") {
          return emitStatus(structured.partId, structured.delta.summary || "Subtask updated.", itemBase);
        }
        if (structured.delta.kind === "notice.update") {
          return emitStatus(structured.partId, structured.delta.message, itemBase);
        }
        return [];
      }
      if (structured.type === "part.started" || structured.type === "part.completed") {
        return mapPart(structured.part, common);
      }
      if (structured.type === "activity.updated") return mapActivity(structured.activity, common);
      return [];
    },
  };

  function finish(event: AgentRunEvent): AgentRunEvent[] {
    if (terminal) return [];
    terminal = true;
    return [event];
  }

  function emitStatus(
    itemId: string,
    content: string,
    base: Omit<AgentRunEvent, "type">,
  ): AgentRunEvent[] {
    const normalized = content.trim();
    if (!normalized || lastStatusByItem.get(itemId) === normalized) return [];
    lastStatusByItem.set(itemId, normalized);
    return [{ ...base, type: "status", content: normalized }];
  }

  function mapPart(
    part: StructuredAssistantPart,
    base: Omit<AgentRunEvent, "type">,
  ): AgentRunEvent[] {
    const itemBase = { ...base, oaepItemId: part.id };
    if (part.kind === "markdown") {
      const previous = textByPart.get(part.id) || "";
      textByPart.set(part.id, part.markdown);
      if (!part.markdown || part.markdown === previous) return [];
      const content = part.markdown.startsWith(previous) ? part.markdown.slice(previous.length) : part.markdown;
      return content ? [{ ...itemBase, type: "chunk", content }] : [];
    }
    if (part.kind === "progress") return emitStatus(part.id, part.summary || "Plan updated.", itemBase);
    if (part.kind === "subtask") {
      return emitStatus(part.id, [part.title, part.summary].filter(Boolean).join(": "), itemBase);
    }
    if (part.kind === "notice") return emitStatus(part.id, part.message, itemBase);
    if (part.kind === "interaction") return emitStatus(part.id, part.prompt, itemBase);
    if (part.kind === "reasoning") {
      const summary = part.summary || part.segments.map((segment) => segment.text).filter(Boolean).join(" ");
      return emitStatus(part.id, summary ? `Reasoning: ${summary}` : "Reasoning in progress.", itemBase);
    }
    if (part.kind === "artifact" && part.status === "completed") {
      const key = `${part.id}:${part.path || part.name}`;
      if (emittedFiles.has(key)) return [];
      emittedFiles.add(key);
      return [{
        ...itemBase,
        type: "file_event",
        fileEvent: { action: "artifact", path: part.path || part.name, name: part.name },
      }];
    }
    return [];
  }

  function mapActivity(
    activity: StructuredActivityEvent,
    base: Omit<AgentRunEvent, "type">,
  ): AgentRunEvent[] {
    const itemId = activity.oaepItemId || activity.id;
    const itemBase = {
      ...base,
      oaepItemId: itemId,
      ...(activity.kind === "tool" ? {
        callId: activity.callId,
        operationId: activity.operationId,
        correlationId: activity.correlationId,
      } : {}),
    };
    if (activity.kind === "file_change") {
      if (activity.status !== "completed") return [];
      const key = `${itemId}:${activity.id}:${activity.action}:${activity.path}`;
      if (emittedFiles.has(key)) return [];
      emittedFiles.add(key);
      const fileEvent: AgentRunFileEvent = {
        action: activity.action,
        path: activity.path,
        name: activity.path.split(/[\\/]/).filter(Boolean).at(-1) || activity.path,
        source: activity.source,
        timestamp: activity.timestamp,
      };
      return [{ ...itemBase, type: "file_event", fileEvent }];
    }
    const status = `${activity.title} (${activity.status})`;
    if (lastActivityByItem.get(activity.id) === status) return [];
    lastActivityByItem.set(activity.id, status);
    return [{ ...itemBase, type: "status", content: status }];
  }
}
