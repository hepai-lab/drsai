/**
 * Chat content-plane contract
 * ---------------------------
 * Agents often mix three roles into one text stream. The UI must not.
 *
 *   reply   — user-visible answer (one bubble)
 *   thought — planner/model monologue (muted annotation)
 *   control — e.g. waiting_for_user_response → input UI only, never text
 *
 * Ideal live lifecycle:
 *   message_chunk*  → live reply draft (reply plane only)
 *   message_thinking → muted thought
 *   message (final)  → sealed reply (replaces draft)
 *   input_request    → await user (from protocol, not from content tokens)
 *
 * This module is the single place that splits mixed agent text into planes
 * and decides what the chat list should keep.
 */
import { Message } from "../../components/types/datamodel";
import { messageUtils } from "./rendermessage";

export type ChatMsgKind =
  | "user"
  | "thought"
  | "stream"
  | "reply"
  | "process"
  | "files"
  | "empty"
  | "other";

export type ChatMsgDecision = "keep" | "drop" | "demote-thought";

export interface SplitAgentContent {
  /** User-visible answer only. */
  reply: string;
  /** Reasoning / planner monologue. */
  thought: string;
  /** Model asked to pause for the user (control token was present). */
  awaitsUser: boolean;
}

const LOG_KEY = "drsai:chatRenderLog";
const CONTROL_TOKEN_RE = /\bwaiting_for_user_response\b/gi;
const THINK_BLOCK_RE =
  /<think>([\s\S]*?)<\/(?:think|redacted_thinking)>/gi;

const MONOLOGUE_START_RE =
  /(?:^|\n\s*)((?:we need to|i need to|i(?:'m| am) the\b|as (?:the )?planner|the user (?:is asking|asked|didn't)|i(?:'ll| will) (?:answer|craft|emit|describe)|i should (?:answer|not)|this is (?:a |not a )?(?:general|free-style|knowledge)|output as per|i must (?:stay|not)|i'll end with|i'll emit|state needed info)\b[\s\S]*)$/i;

export function isChatRenderLogEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage?.getItem(LOG_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return process.env.NODE_ENV === "development";
}

export function chatRenderLog(
  phase: string,
  payload: Record<string, unknown>
): void {
  if (!isChatRenderLogEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug(`[chat-render] ${phase}`, payload);
}

function contentPreview(content: unknown, max = 96): string {
  if (typeof content !== "string") return typeof content;
  const t = content.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function contentLen(content: unknown): number {
  return typeof content === "string" ? content.trim().length : 0;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when two replies are essentially the same rewrite. */
export function isNearDuplicateReply(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const head = 160;
  if (
    na.length >= head &&
    nb.length >= head &&
    na.slice(0, head) === nb.slice(0, head)
  ) {
    return true;
  }
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length >= 80 && longer.includes(shorter)) return true;
  return false;
}

/** Whole-message planner monologue (no user-facing answer). */
export function looksLikeAgentMonologue(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  // Short control-only
  if (/^waiting_for_user_response\.?$/.test(t)) return true;
  return (
    /\bi(?:'m| am) the \w*agent\b/.test(t) ||
    /\bwe need to answer (the )?question\b/.test(t) ||
    /\bi can answer directly\b/.test(t) ||
    /\bno (?:further|need to) (?:action|dispatch)/.test(t) ||
    /\bdispatch(?:ing)? to (?:any |an )?agent\b/.test(t) ||
    /\bthe user's request is complete\b/.test(t) ||
    /\bi should not emit\b/.test(t) ||
    /\bnot a task that requires\b/.test(t) ||
    /\bkeep(?:ing)? it within \d+ words\b/.test(t) ||
    /\bthis is a (?:general|free-style|knowledge)/.test(t) ||
    /\bi'll (?:craft|emit|answer|end with)\b/.test(t)
  );
}

function peelTrailingMonologue(text: string): {
  reply: string;
  monologue: string;
} {
  const m = text.match(MONOLOGUE_START_RE);
  if (!m || m.index === undefined) return { reply: text.trim(), monologue: "" };
  const reply = text.slice(0, m.index).trim();
  const monologue = (m[1] || "").trim();
  // Don't peel if that would leave almost nothing and monologue is the whole body.
  if (!reply && monologue) return { reply: "", monologue };
  if (!reply) return { reply: text.trim(), monologue: "" };
  return { reply, monologue };
}

/**
 * Split mixed agent text into the three content planes.
 * Safe to call on every chunk accumulate / TextMessage / history load.
 */
export function splitAgentVisibleContent(raw: string): SplitAgentContent {
  let text = typeof raw === "string" ? raw : "";
  const thoughts: string[] = [];

  text = text.replace(THINK_BLOCK_RE, (_, body: string) => {
    if (body.trim()) thoughts.push(body.trim());
    return "\n";
  });

  const awaitsUser = CONTROL_TOKEN_RE.test(text);
  CONTROL_TOKEN_RE.lastIndex = 0;
  const segments = text
    .split(CONTROL_TOKEN_RE)
    .map((s) => s.trim())
    .filter(Boolean);

  let reply = "";
  for (const seg of segments) {
    const peeled = peelTrailingMonologue(seg);
    if (peeled.monologue) thoughts.push(peeled.monologue);

    const candidate = peeled.reply.trim();
    if (!candidate) continue;

    if (looksLikeAgentMonologue(candidate) && candidate.length < 400) {
      thoughts.push(candidate);
      continue;
    }

    if (!reply) {
      reply = candidate;
      continue;
    }

    // Later segment: rewrite of the same answer → keep the later one;
    // unrelated monologue → thought.
    if (isNearDuplicateReply(reply, candidate)) {
      reply = candidate.length >= reply.length ? candidate : reply;
    } else if (looksLikeAgentMonologue(candidate)) {
      thoughts.push(candidate);
    } else {
      // Prefer the longer substantive answer when the model rewrote once.
      reply = candidate.length >= reply.length ? candidate : reply;
    }
  }

  // No control token — still peel trailing monologue from a single block.
  if (!awaitsUser && segments.length <= 1) {
    const peeled = peelTrailingMonologue(reply || text.trim());
    reply = peeled.reply;
    if (peeled.monologue) thoughts.push(peeled.monologue);
  }

  if (reply && looksLikeAgentMonologue(reply) && thoughts.length === 0) {
    thoughts.push(reply);
    reply = "";
  }

  const thought = thoughts.join("\n\n").trim();
  chatRenderLog("split", {
    awaitsUser,
    reply: contentPreview(reply),
    thought: contentPreview(thought),
    raw: contentPreview(raw),
  });

  return { reply: reply.trim(), thought, awaitsUser };
}

export function classifyMessage(msg: Message): ChatMsgKind {
  const cfg = msg.config as any;
  const meta = (cfg.metadata || {}) as Record<string, unknown>;

  if (messageUtils.isUser(cfg.source) || cfg.source === "user_proxy") {
    return "user";
  }
  if (
    cfg.type === "ThoughtEvent" ||
    meta.type === "ThoughtEvent" ||
    meta._is_streaming_think
  ) {
    return "thought";
  }
  if (
    meta.start_flag !== undefined ||
    meta._is_streaming_chunk ||
    meta._stream_draft
  ) {
    const raw = typeof cfg.content === "string" ? cfg.content : "";
    if (/<think>/.test(raw) && !/<\/(?:think|redacted_thinking)>/.test(raw)) {
      return "thought";
    }
    return "stream";
  }
  if (cfg.type === "FilesEvent" || meta.type === "FilesEvent") {
    return "files";
  }
  if (
    meta.type === "log" ||
    cfg.content_type === "log" ||
    cfg.type === "AgentLogEvent" ||
    meta.type === "AgentLogEvent" ||
    cfg.type === "ToolCallSummaryMessage" ||
    meta.type === "ToolCallSummaryMessage" ||
    cfg.content_type === "tools" ||
    meta.content_type === "tools" ||
    cfg.type === "ToolCallRequestEvent" ||
    cfg.type === "ToolCallExecutionEvent"
  ) {
    return "process";
  }
  if (
    cfg.type === "TextMessage" ||
    meta._is_final_reply ||
    meta._sealed_from_stream
  ) {
    if (contentLen(cfg.content) === 0) return "empty";
    if (typeof cfg.content === "string" && looksLikeAgentMonologue(cfg.content)) {
      return "thought";
    }
    return "reply";
  }
  if (contentLen(cfg.content) === 0 && !meta.type) return "empty";
  if (typeof cfg.content === "string" && looksLikeAgentMonologue(cfg.content)) {
    return "thought";
  }
  return "other";
}

export interface PipelineResult {
  messages: Message[];
  decisions: Array<{
    idx: number;
    kind: ChatMsgKind;
    decision: ChatMsgDecision;
    source: string;
    preview: string;
  }>;
}

function toThoughtMessage(msg: Message, thought: string): Message {
  return {
    ...msg,
    config: {
      ...msg.config,
      content: thought,
      type: "ThoughtEvent",
      metadata: {
        ...(msg.config.metadata || {}),
        type: "ThoughtEvent",
        _demoted_monologue: true,
      },
    } as any,
  };
}

function withReplyContent(msg: Message, reply: string): Message {
  const meta = { ...(msg.config.metadata || {}) } as Record<string, unknown>;
  delete meta.start_flag;
  delete meta._stream_draft;
  delete meta._is_streaming_chunk;
  return {
    ...msg,
    config: {
      ...msg.config,
      content: reply,
      type:
        (msg.config as any).type === "ModelClientStreamingChunkEvent" ||
        meta._sealed_from_stream
          ? "TextMessage"
          : (msg.config as any).type || "TextMessage",
      metadata: {
        ...meta,
        _is_final_reply: true,
      },
    } as any,
  };
}

/**
 * Project messages onto the content-plane contract, then collapse safely.
 * - Split mixed reply+thought+control text
 * - Keep all distinct replies (tool agents emit many)
 * - Drop near-duplicate rewrites (keep last)
 * - Drop empty / control-only shells
 */
export function collapseMessagesForDisplay(messages: Message[]): PipelineResult {
  const projected: Message[] = [];
  const decisions: PipelineResult["decisions"] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const kind = classifyMessage(msg);
    const source = String(msg.config.source || "assistant");

    if (kind === "user" || kind === "process" || kind === "files" || kind === "other") {
      projected.push(msg);
      decisions.push({
        idx: i,
        kind,
        decision: "keep",
        source,
        preview: contentPreview(msg.config.content),
      });
      continue;
    }

    if (kind === "thought") {
      const raw =
        typeof msg.config.content === "string" ? msg.config.content : "";
      const { thought, reply } = splitAgentVisibleContent(raw);
      const body = thought || reply || raw.trim();
      if (!body) {
        decisions.push({
          idx: i,
          kind,
          decision: "drop",
          source,
          preview: "",
        });
        continue;
      }
      projected.push(toThoughtMessage(msg, body));
      decisions.push({
        idx: i,
        kind,
        decision: "demote-thought",
        source,
        preview: contentPreview(body),
      });
      continue;
    }

    if (kind === "empty") {
      decisions.push({ idx: i, kind, decision: "drop", source, preview: "" });
      continue;
    }

    if (kind === "stream" || kind === "reply") {
      const raw =
        typeof msg.config.content === "string" ? msg.config.content : "";
      const meta = (msg.config.metadata || {}) as Record<string, unknown>;

      // Live stream already carries a stable thought plane — keep the bubble intact.
      if (kind === "stream" && typeof meta._live_thought === "string") {
        projected.push(msg);
        decisions.push({
          idx: i,
          kind,
          decision: "keep",
          source,
          preview: contentPreview(raw || meta._live_thought),
        });
        continue;
      }

      const { reply, thought } = splitAgentVisibleContent(raw);
      // Keep think embedded in the same message so ThinkBubble does not remount
      // as a separate list item.
      const display = thought
        ? `<think>${thought}</think>\n\n${reply}`
        : reply;

      if (display) {
        if (kind === "stream") {
          projected.push({
            ...msg,
            config: {
              ...msg.config,
              content: reply,
              metadata: {
                ...meta,
                _stream_draft: true,
                ...(thought
                  ? { _live_thought: thought, _thought_done: true }
                  : {}),
              },
            } as any,
          });
        } else {
          projected.push(withReplyContent(msg, display));
        }
        decisions.push({
          idx: i,
          kind,
          decision: "keep",
          source,
          preview: contentPreview(reply || thought),
        });
      } else {
        decisions.push({
          idx: i,
          kind,
          decision: "drop",
          source,
          preview: contentPreview(raw),
        });
      }
      continue;
    }
  }

  // Second pass: drop near-duplicate replies per source (keep last).
  const keep = new Set(projected.map((_, i) => i));
  const lastReplyText = new Map<string, { idx: number; text: string }>();
  projected.forEach((msg, idx) => {
    const kind = classifyMessage(msg);
    if (kind !== "reply" && kind !== "stream") return;
    const source = String(msg.config.source || "assistant");
    const text =
      typeof msg.config.content === "string" ? msg.config.content : "";
    const prev = lastReplyText.get(source);
    if (prev && isNearDuplicateReply(prev.text, text)) {
      keep.delete(prev.idx);
    }
    lastReplyText.set(source, { idx, text });
  });

  // Prefer a sealed/final reply over an earlier stream draft of the same answer.
  for (let i = 0; i < projected.length; i++) {
    if (!keep.has(i)) continue;
    const msg = projected[i];
    if (classifyMessage(msg) !== "stream") continue;
    const source = String(msg.config.source || "assistant");
    const text =
      typeof msg.config.content === "string" ? msg.config.content : "";
    for (let j = i + 1; j < projected.length; j++) {
      if (!keep.has(j)) continue;
      const later = projected[j];
      if (String(later.config.source || "assistant") !== source) continue;
      if (classifyMessage(later) !== "reply") continue;
      const laterText =
        typeof later.config.content === "string" ? later.config.content : "";
      if (
        isNearDuplicateReply(text, laterText) ||
        contentLen(laterText) >= Math.min(contentLen(text), 40)
      ) {
        keep.delete(i);
        break;
      }
    }
  }

  const out = projected.filter((_, i) => keep.has(i));

  // Final pass: if a ThoughtEvent trails a same-source reply, fold it INTO the
  // reply as a leading <think> block so "思考完成" never sits under the answer.
  const folded: Message[] = [];
  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    if (classifyMessage(msg) !== "thought") {
      folded.push(msg);
      continue;
    }
    const source = String(msg.config.source || "assistant");
    const thoughtBody =
      typeof msg.config.content === "string" ? msg.config.content.trim() : "";
    let mergedIntoPrior = false;
    for (let j = folded.length - 1; j >= 0; j--) {
      const prior = folded[j];
      if (String(prior.config.source || "assistant") !== source) continue;
      const priorKind = classifyMessage(prior);
      if (priorKind !== "reply" && priorKind !== "stream") continue;
      const raw =
        typeof prior.config.content === "string" ? prior.config.content : "";
      const split = splitAgentVisibleContent(raw);
      if (
        split.thought &&
        thoughtBody &&
        (split.thought.includes(thoughtBody.slice(0, 80)) ||
          thoughtBody.includes(split.thought.slice(0, 80)))
      ) {
        mergedIntoPrior = true;
        break;
      }
      const mergedThought = [split.thought, thoughtBody]
        .filter(Boolean)
        .join("\n\n");
      if (priorKind === "stream") {
        folded[j] = {
          ...prior,
          config: {
            ...prior.config,
            metadata: {
              ...((prior.config.metadata || {}) as Record<string, unknown>),
              _live_thought: mergedThought,
              _thought_done: true,
            },
          } as any,
        };
      } else {
        folded[j] = withReplyContent(
          prior,
          `<think>${mergedThought}</think>\n\n${split.reply}`
        );
      }
      mergedIntoPrior = true;
      break;
    }
    if (!mergedIntoPrior && thoughtBody) {
      folded.push(msg);
    }
  }

  chatRenderLog("collapse", {
    in: messages.length,
    projected: projected.length,
    out: folded.length,
    decisions,
  });

  return { messages: folded, decisions };
}

/** Convert an active stream draft into a durable reply bubble (reply + think). */
export function sealStreamMessage(msg: Message): Message {
  const raw =
    typeof (msg.config.metadata as any)?._stream_raw === "string"
      ? String((msg.config.metadata as any)._stream_raw)
      : typeof msg.config.content === "string"
      ? msg.config.content
      : "";
  const liveThought =
    typeof (msg.config.metadata as any)?._live_thought === "string"
      ? String((msg.config.metadata as any)._live_thought)
      : "";
  const { reply, thought } = splitAgentVisibleContent(raw);
  const finalThought = thought || liveThought;
  const content = finalThought
    ? `<think>${finalThought}</think>\n\n${reply}`
    : reply;
  const meta = { ...(msg.config.metadata || {}) } as Record<string, unknown>;
  delete meta.start_flag;
  delete meta._is_streaming_chunk;
  delete meta._stream_draft;
  delete meta._stream_raw;
  delete meta._live_thought;
  delete meta._thought_done;
  return {
    ...msg,
    config: {
      ...msg.config,
      content,
      type: "TextMessage",
      metadata: {
        ...meta,
        _is_final_reply: true,
        _sealed_from_stream: true,
      },
    } as any,
  };
}
