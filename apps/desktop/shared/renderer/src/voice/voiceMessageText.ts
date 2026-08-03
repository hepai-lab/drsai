import type { StructuredTurnState } from "@shared/structuredConversation";

export interface VoiceReadableAssistantMessage {
  content: string;
  reasoningContent?: string;
  structuredTurn?: StructuredTurnState;
}

export function getAssistantSpeechText(
  message: VoiceReadableAssistantMessage,
  getVisibleText: (content: string) => string = (content) => content.trim(),
): string {
  if (message.structuredTurn) {
    return message.structuredTurn.parts
      .filter((part): part is Extract<typeof part, { kind: "markdown" }> => part.kind === "markdown")
      .map((part) => part.markdown)
      .join("\n\n")
      .trim();
  }
  const content = getVisibleText(message.content);
  if (!message.reasoningContent) return content;
  return removeDuplicatedReasoning(content, getVisibleText(message.reasoningContent));
}

function removeDuplicatedReasoning(content: string, reasoning: string): string {
  const visible = content.trim();
  const thought = reasoning.trim();
  if (!visible || !thought) return visible;
  // Same text in both fields → still read it once (do not wipe speech text).
  if (normalizeChatText(visible) === normalizeChatText(thought)) return visible;
  if (normalizeChatText(visible).startsWith(normalizeChatText(thought))) {
    const directPrefix = visible.slice(0, thought.length);
    if (normalizeChatText(directPrefix) === normalizeChatText(thought)) {
      return visible.slice(thought.length).trimStart();
    }
  }
  return visible;
}

function normalizeChatText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
