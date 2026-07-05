export interface ChatSseChoice {
  delta?: { content?: string };
  message?: { content?: string };
}

export interface ChatSsePayload {
  error?: string | { message?: string };
  choices?: ChatSseChoice[];
}

export function parseCompletionSseFrame(frame: string): string[] {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload || payload === "[DONE]") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }

  const value = parsed as ChatSsePayload;
  if (value.error) {
    const error = value.error;
    throw new Error(typeof error === "string" ? error : error.message || JSON.stringify(error));
  }

  const content = value.choices?.[0]?.delta?.content ?? value.choices?.[0]?.message?.content ?? "";
  return content ? [content] : [];
}

export function isCompletionDoneFrame(frame: string): boolean {
  return frame
    .split(/\r?\n/)
    .some((line) => line.startsWith("data:") && line.slice(5).trim() === "[DONE]");
}

export const parseChatSseFrame = parseCompletionSseFrame;
export const parseAgentRunSseFrame = parseCompletionSseFrame;
