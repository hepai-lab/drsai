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
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}
