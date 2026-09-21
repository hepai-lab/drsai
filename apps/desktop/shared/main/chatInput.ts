export interface ChatInputMessage {
  role: string;
  content: string;
}

/**
 * Upper bound for the transcript a single Desktop chat request may carry.
 *
 * `messages` normally holds the whole visible thread, but only
 * `selectCurrentUserInput` below reaches the Runtime: the transcript travels
 * with the request for local bookkeeping (thread title, catalog, search), not
 * to build the Codex prompt.  A cap of 40 therefore rejected every conversation
 * longer than 20 turns with "Chat request cannot exceed 40 messages."
 *
 * The value is a payload sanity bound, in the same spirit as the shape bounds
 * the renderer applies to thread snapshot patches (10_000 entries per array),
 * never a limit on how long a user may talk.  Main cannot import that renderer
 * module, so the two numbers are kept deliberately equal rather than shared.
 */
export const MAX_REQUEST_MESSAGES = 10_000;

/**
 * Reject a transcript no real conversation produces, and nothing else.
 */
export function assertRequestMessageCount(messageCount: number): void {
  if (messageCount < 1) {
    throw new Error("Chat request must include messages.");
  }
  if (messageCount > MAX_REQUEST_MESSAGES) {
    throw new Error(`Chat request cannot exceed ${MAX_REQUEST_MESSAGES} messages.`);
  }
}

/**
 * Return the one user-authored input that starts the current Runtime Run.
 *
 * Runtime Sessions and Backend Threads own conversation history. Re-encoding
 * the complete Desktop transcript here would duplicate context and leak role
 * prefixes into the user's actual Codex prompt.
 */
export function selectCurrentUserInput(messages: readonly ChatInputMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim()) return message.content;
  }
  return messages.at(-1)?.content ?? "";
}
