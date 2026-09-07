/**
 * Chat turn document
 * ------------------
 * One user turn is a fixed layout, not an inference over array order:
 *
 *   user / plan / step
 *   process[]   — ReAct: thinking, narration, tools, logs
 *   final       — turn.ready (or live candidate), reply text only
 *   files[]
 *
 * Slot assignment prefers ``turn_plane`` stamped by the stream protocol.
 * Array order inside a turn is ignored for slot placement.
 */
import type { Message } from "../../components/types/datamodel";
import { classifyMessage, splitAgentVisibleContent } from "./chatMessagePipeline";
import { messageUtils } from "./rendermessage";
import { streamMessageId } from "./chatStreamReducer";

export type MessageSegment =
  | { kind: "single"; idx: number; msg: Message }
  | { kind: "process"; items: Array<{ idx: number; msg: Message }> };

type Indexed = { idx: number; msg: Message };

function metaOf(msg: Message): Record<string, unknown> {
  return (msg.config.metadata || {}) as Record<string, unknown>;
}

function cfgOf(msg: Message): any {
  return msg.config as any;
}

export function turnPlaneOf(msg: Message): "process" | "final" | undefined {
  const plane = metaOf(msg).turn_plane;
  if (plane === "process" || plane === "final") return plane;
  if (metaOf(msg).stream_status === "interrupted") return "process";
  return undefined;
}

function isUserMsg(msg: Message): boolean {
  return classifyMessage(msg) === "user";
}

function isPlanOrStep(msg: Message): boolean {
  const meta = metaOf(msg);
  return (
    messageUtils.isPlanMessage(meta) || messageUtils.isStepExecution(meta)
  );
}

function isFilesMsg(msg: Message): boolean {
  return cfgOf(msg).type === "FilesEvent" || metaOf(msg).type === "FilesEvent";
}

function isTurnLead(msg: Message): boolean {
  return isUserMsg(msg) || isPlanOrStep(msg);
}

function thoughtTextOf(msg: Message): string {
  const raw = typeof msg.config.content === "string" ? msg.config.content : "";
  const meta = metaOf(msg);
  const split = splitAgentVisibleContent(raw);
  const extra = [meta._peeled_thought, meta.reasoning_summary, meta._live_thought]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  return (split.thought || extra || "").trim();
}

function replyOnly(msg: Message): Message {
  const raw = typeof msg.config.content === "string" ? msg.config.content : "";
  const { reply } = splitAgentVisibleContent(raw);
  const meta = metaOf(msg);
  const thought = thoughtTextOf(msg);
  if (reply === raw && !thought) return msg;
  return {
    ...msg,
    config: {
      ...msg.config,
      content: reply,
      metadata: {
        ...meta,
        ...(thought ? { _peeled_thought: thought } : {}),
      },
    } as any,
  };
}

function asProcessThought(source: Message, idx: number, thought: string): Indexed {
  return {
    idx,
    msg: {
      ...source,
      uuid: `${streamMessageId(source) || idx}-reasoning`,
      config: {
        ...source.config,
        content: thought,
        type: "ThoughtEvent",
        metadata: {
          ...metaOf(source),
          type: "ThoughtEvent",
          turn_plane: "process",
          _from_final_reasoning: true,
        },
      } as any,
    },
  };
}

function alreadyHasThought(items: Indexed[], thought: string): boolean {
  const head = thought.slice(0, 80);
  if (!head) return false;
  return items.some((item) => {
    const content =
      typeof item.msg.config.content === "string" ? item.msg.config.content : "";
    return content.includes(head) || thought.includes(content.slice(0, 80));
  });
}

function fallbackFinalIndex(body: Indexed[]): number {
  for (let i = body.length - 1; i >= 0; i--) {
    const msg = body[i].msg;
    if (isFilesMsg(msg)) continue;
    const kind = classifyMessage(msg);
    if (kind === "process" || kind === "thought" || kind === "empty") continue;
    if (metaOf(msg).stream_status === "interrupted") continue;
    if (kind === "reply" || kind === "stream") return i;
  }
  return -1;
}

function assembleTurnBody(body: Indexed[]): MessageSegment[] {
  if (!body.length) return [];

  const stampedFinal = body.reduce(
    (found, item, index) => (turnPlaneOf(item.msg) === "final" ? index : found),
    -1
  );
  const finalIndex =
    stampedFinal >= 0 ? stampedFinal : fallbackFinalIndex(body);

  const process: Indexed[] = [];
  const finals: Indexed[] = [];
  const files: Indexed[] = [];

  body.forEach((item, index) => {
    if (isFilesMsg(item.msg)) {
      files.push(item);
      return;
    }
    if (index === finalIndex) {
      const thought = thoughtTextOf(item.msg);
      const reply = replyOnly(item.msg);
      if (thought && !alreadyHasThought(process, thought)) {
        process.push(asProcessThought(item.msg, item.idx, thought));
      }
      const text =
        typeof reply.config.content === "string" ? reply.config.content.trim() : "";
      const streaming =
        metaOf(reply).stream_status === "streaming" ||
        metaOf(reply)._stream_draft === true ||
        metaOf(reply)._is_streaming_chunk === true;
      if (text || streaming) {
        finals.push({ idx: item.idx, msg: reply });
      } else if (thought) {
        // Reasoning-only hop with no visible reply stays in the process box.
      }
      return;
    }
    process.push(item);
  });

  const segments: MessageSegment[] = [];
  if (process.length > 0) {
    segments.push({ kind: "process", items: process });
  }
  finals.forEach((item) => {
    segments.push({ kind: "single", idx: item.idx, msg: item.msg });
  });
  files.forEach((item) => {
    segments.push({ kind: "single", idx: item.idx, msg: item.msg });
  });
  return segments;
}

/** Project a flat run message list onto the turn document, then flatten to render segments. */
export function buildTurnSegments(messages: Message[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (isTurnLead(msg)) {
      segments.push({ kind: "single", idx: i, msg });
      i += 1;
      const body: Indexed[] = [];
      while (i < messages.length && !isTurnLead(messages[i])) {
        body.push({ idx: i, msg: messages[i] });
        i += 1;
      }
      segments.push(...assembleTurnBody(body));
      continue;
    }
    const body: Indexed[] = [];
    while (i < messages.length && !isTurnLead(messages[i])) {
      body.push({ idx: i, msg: messages[i] });
      i += 1;
    }
    segments.push(...assembleTurnBody(body));
  }
  return segments;
}
