export interface ChatInputMessage {
  role: string;
  content: string;
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
