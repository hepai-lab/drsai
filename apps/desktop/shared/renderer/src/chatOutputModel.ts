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

  // Scan tag boundaries rather than slicing and matching the remaining string
  // for every character. The previous loop was quadratic for long answers and
  // ran several times per displayed frame through the message/search helpers.
  const tagPattern = /<think(?:\s[^>]*)?>|<\/(?:think|redacted_thinking)>|&lt;think(?:\s.*?)?&gt;|&lt;\/(?:think|redacted_thinking)&gt;/gi;
  let cursor = 0;
  for (const match of content.matchAll(tagPattern)) {
    const index = match.index ?? cursor;
    const tag = match[0];
    buffer += content.slice(cursor, index);
    const isOpen = OPEN_TAG.test(tag) || ESCAPED_OPEN_TAG.test(tag);
    const isClose = CLOSE_TAG.test(tag) || ESCAPED_CLOSE_TAG.test(tag);
    if (mode === "text" && isOpen) {
      flush();
      mode = "reasoning";
    } else if (mode === "reasoning" && isClose) {
      flush(true);
      mode = "text";
    } else {
      // A close tag outside reasoning, or a nested open tag, is ordinary text.
      buffer += tag;
    }
    cursor = index + tag.length;
  }
  buffer += content.slice(cursor);
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

  // Model sometimes prints raw DSML / tool-call markup as the final answer
  // (e.g. when GFS tools are off and it invents run_bash + jcli). Replace with
  // a short user-readable explanation instead of leaking internals.
  if (looksLikeRawToolCallMarkup(text)) {
    return explainRawToolCallMarkup(text);
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function looksLikeRawToolCallMarkup(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  if (/DSML/i.test(compact) && /tool_calls|invoke\s+name=/i.test(compact)) return true;
  if (/<\s*\|\s*\|\s*DSML/i.test(compact)) return true;
  // Entire bubble is a fenced dump of a single shell/tool invoke.
  if (
    compact.length < 1200
    && /```/.test(text)
    && /(?:run_bash|run_powershell|jcli\s)/i.test(compact)
    && /invoke|tool_calls|parameter\s+name=/i.test(compact)
  ) {
    return true;
  }
  return false;
}

function explainRawToolCallMarkup(text: string): string {
  const wantsGfs = /gfs|jcli|云盘|ihep-gfs/i.test(text);
  if (wantsGfs) {
    return [
      "当前会话没有可用的 GFS 云盘工具，所以没法直接列出云盘内容。",
      "",
      "请打开左侧「GFS 云盘」，开启开关并保存 Access Key / Secret Key / 桶名后，再新建任务重试。",
      "若已开启仍出现此提示，请重启桌面端后再试。",
    ].join("\n");
  }
  return [
    "模型输出了未执行的内部工具调用标记，而不是可用的结果。",
    "请换一种说法重试，或新建任务后再问一次。",
  ].join("\n");
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
