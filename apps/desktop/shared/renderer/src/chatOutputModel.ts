import type { ChatToolTimelineEvent } from "@shared/desktopApi";

export type ChatOutputPart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "reasoning"; text: string; complete: boolean };

const OPEN_TAG = /^<think(?:\s[^>]*)?>/i;
const CLOSE_TAG = /^<\/(?:think|redacted_thinking)>/i;
const ESCAPED_OPEN_TAG = /^&lt;think(?:\s.*?)?&gt;/i;
const ESCAPED_CLOSE_TAG = /^&lt;\/(?:think|redacted_thinking)&gt;/i;

/**
 * Converts provider text containing reasoning tags into stable display parts.
 * It deliberately scans instead of using a whole-message regex so incomplete
 * streaming tags and tags split across chunks remain safe once accumulated.
 */
export function parseChatOutput(content: string, options: { streaming?: boolean } = {}): ChatOutputPart[] {
  const parts: ChatOutputPart[] = [];
  let mode: "text" | "reasoning" = "text";
  let buffer = "";
  let index = 0;

  const flush = (complete = true): void => {
    if (!buffer) return;
    const text = mode === "reasoning" ? buffer.trim() : buffer;
    if (text.trim()) {
      const previous = parts[parts.length - 1];
      if (
        (mode === "text" && previous?.type === "text") ||
        (mode === "reasoning" && previous?.type === "reasoning" && previous.complete === complete)
      ) {
        previous.text += text;
      } else if (mode === "text") {
        parts.push({ id: `text-${parts.length}`, type: "text", text });
      } else {
        parts.push({ id: `reasoning-${parts.length}`, type: "reasoning", text, complete });
      }
    }
    buffer = "";
  };

  while (index < content.length) {
    const rest = content.slice(index);
    const open = rest.match(OPEN_TAG) ?? rest.match(ESCAPED_OPEN_TAG);
    const close = rest.match(CLOSE_TAG) ?? rest.match(ESCAPED_CLOSE_TAG);
    if (mode === "text" && open) {
      flush();
      mode = "reasoning";
      index += open[0].length;
      continue;
    }
    if (mode === "reasoning" && close) {
      flush(true);
      mode = "text";
      index += close[0].length;
      continue;
    }
    buffer += content[index];
    index += 1;
  }
  if (options.streaming) {
    buffer = stripPartialTagSuffix(buffer, mode);
  }
  flush(mode === "text");
  return parts;
}

function stripPartialTagSuffix(value: string, mode: "text" | "reasoning"): string {
  const candidates = mode === "text"
    ? ["<think>", "&lt;think&gt;"]
    : ["</think>", "</redacted_thinking>", "&lt;/think&gt;", "&lt;/redacted_thinking&gt;"];
  const lower = value.toLowerCase();
  let withheld = 0;
  for (const candidate of candidates) {
    for (let length = 1; length < candidate.length; length += 1) {
      if (lower.endsWith(candidate.slice(0, length).toLowerCase())) withheld = Math.max(withheld, length);
    }
  }
  return withheld ? value.slice(0, -withheld) : value;
}

export function acceptChatEventSequence(
  lastByRequest: Record<string, number>,
  requestId: string,
  seq: number | undefined,
): boolean {
  if (seq === undefined) return true;
  const previous = lastByRequest[requestId] ?? 0;
  if (!Number.isSafeInteger(seq) || seq <= previous) return false;
  lastByRequest[requestId] = seq;
  return true;
}

export function getVisibleChatText(content: string): string {
  return parseChatOutput(content)
    .filter((part): part is Extract<ChatOutputPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

export function getReasoningChatText(content: string): string {
  return parseChatOutput(content)
    .filter((part): part is Extract<ChatOutputPart, { type: "reasoning" }> => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

export function mergeReasoningText(primary: string | undefined, secondary: string | undefined): string {
  const left = primary?.trim() ?? "";
  const right = secondary?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right) || right.includes(left)) {
    return left.length >= right.length ? left : right;
  }
  return `${left}\n\n${right}`;
}

export function getAssistantVisibleAnswer(content: string, reasoningContent?: string): string {
  let visible = stripAgentToolDebugText(getVisibleChatText(content));
  const reasoning = mergeReasoningText(reasoningContent, getReasoningChatText(content));
  if (!visible || !reasoning) return visible.trim();

  if (visible.includes(reasoning)) {
    visible = visible.replace(reasoning, "");
  }

  for (const paragraph of splitReasoningParagraphs(reasoning)) {
    if (paragraph.length < 32) continue;
    while (visible.endsWith(paragraph)) {
      visible = visible.slice(0, visible.length - paragraph.length).trimEnd();
    }
    if (visible.includes(paragraph)) {
      visible = visible.replace(paragraph, "");
    }
  }

  return stripAgentToolDebugText(visible.replace(/\n{3,}/g, "\n\n").trim());
}

export function stripAgentToolDebugText(content: string): string {
  let text = content.trim();
  if (!text) return "";

  text = text.replace(/^undefined(?=[A-Za-z])/i, "");
  text = text.replace(/I am using tools?:[^\n]*/gi, "");
  text = text.replace(/\[FunctionCall\([\s\S]*?\)\]/g, "");
  text = text.replace(/^LOG Tool:?[^\n]*/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export function isUserVisibleChatStatus(statusContent: string): boolean {
  const raw = statusContent.trim();
  if (!raw) return false;
  return /LLM Retry|retry|重试|模型调用失败/i.test(raw);
}

export function sanitizeChatToolTimelineEvents(
  events: ChatToolTimelineEvent[] | undefined,
): ChatToolTimelineEvent[] {
  if (!events?.length) return [];
  const seen = new Set<string>();
  const sanitized: ChatToolTimelineEvent[] = [];

  for (const event of events) {
    const toolName = event.toolName?.trim() || extractToolNameFromTitle(event.title);
    const content = event.content?.trim() ?? "";
    if (isRawAgentToolDebugEvent(event, content)) continue;

    const title = toolName
      ? `调用 ${toolName}`
      : event.title.replace(/^Using\s+/i, "调用 ").replace(/^Tool:\s*/i, "调用 ");
    const key = `${event.kind}:${toolName || title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sanitized.push({
      ...event,
      title,
      content: undefined,
      kind: "tool_call",
      status: event.status === "failed" ? "failed" : "completed",
    });
  }

  return sanitized.slice(-4);
}

function extractToolNameFromTitle(title: string): string {
  const using = title.match(/(?:Using|调用)\s+([A-Za-z0-9_.-]+)/i);
  if (using?.[1]) return using[1];
  const logTool = title.match(/^LOG Tool:?\s*(.+)$/i);
  if (logTool?.[1]) return logTool[1].trim();
  return "";
}

function isRawAgentToolDebugEvent(
  event: ChatToolTimelineEvent,
  content: string,
): boolean {
  if (/^\[FunctionCall\(/i.test(content) || /^\[FunctionCall\(/i.test(event.title)) return true;
  if (/^I am using tools?:/i.test(event.title)) return true;
  if (event.kind === "log" && /FunctionCall|tool\.progress/i.test(`${event.title}\n${content}`)) return true;
  return false;
}

function splitReasoningParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}
