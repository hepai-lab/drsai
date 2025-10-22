import { AgentMessageConfig, Message } from "../../types/datamodel";

/**
 * Create a Message object from AgentMessageConfig
 */
export const createMessage = (
  config: AgentMessageConfig,
  runId: string,
  sessionId: number,
  userEmail?: string
): Message => ({
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  config,
  session_id: sessionId,
  run_id: runId,
  user_id: userEmail || undefined,
});

/**
 * Check if two messages are similar (for deduplication)
 */
export const areMessagesSimilar = (
  content1: string,
  content2: string
): boolean => {
  const trimmed1 = content1.trim();
  const trimmed2 = content2.trim();
  return (
    trimmed1 === trimmed2 ||
    trimmed2.includes(trimmed1) ||
    trimmed1.includes(trimmed2)
  );
};

/**
 * Check if a streaming message is a duplicate
 */
export const isStreamingDuplicate = (
  streamingMessage: { source: string; content: string } | null,
  messageData: { source?: string; content: string }
): boolean => {
  if (!streamingMessage) return false;

  const source = messageData.source || "assistant";
  const content = messageData.content.trim();

  return (
    streamingMessage.source === source &&
    (content === streamingMessage.content ||
      content.includes(streamingMessage.content) ||
      streamingMessage.content.includes(content))
  );
};

