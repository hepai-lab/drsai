/**
 * A chat turn reached a terminal state and its Thread status was persisted.
 *
 * A turn that finishes while the user is reading another Session would
 * otherwise never reach the renderer: the send pipeline only persists to disk,
 * and the renderer stops applying chat events for a non-active thread. The
 * owning process uses this to broadcast the catalog row and, for a backgrounded
 * conversation, raise a completion notification.
 */
export interface ChatThreadCompletion {
  /** Thread whose turn reached a terminal state. */
  threadId: string;
  /** Terminal status persisted for the thread. */
  status: "idle" | "error";
  /** True when the turn ended in error. */
  failed: boolean;
  /** True when the user cancelled the turn (not a failure). */
  cancelled: boolean;
  /**
   * The user input that started this turn, when the pipeline still has it in
   * scope. Notifications prefer it over the (first-message-derived) title so
   * the bubble reflects the question that just finished.
   */
  prompt?: string;
}

/** The renderer frame a completion is delivered to (structural subset of WebContents). */
export interface ChatThreadCompletionTarget {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed?(): boolean;
}

export interface ChatThreadCompletionSink {
  publish: (completion: ChatThreadCompletion, target: ChatThreadCompletionTarget) => void;
}

let sink: ChatThreadCompletionSink | null = null;

export function configureChatThreadCompletion(next: ChatThreadCompletionSink): void {
  sink = next;
}

/**
 * Notify the owning process that a chat turn settled. Errors here must never
 * fail the run pipeline, so the sink is called defensively.
 */
export function notifyChatThreadCompletion(
  target: ChatThreadCompletionTarget,
  completion: ChatThreadCompletion,
): void {
  if (completion.status !== "idle" && completion.status !== "error") return;
  try {
    sink?.publish(completion, target);
  } catch {
    // A terminal broadcast must never fail the run pipeline.
  }
}

/** Test-only: reset the configured sink. */
export function resetChatThreadCompletionForTesting(): void {
  sink = null;
}
