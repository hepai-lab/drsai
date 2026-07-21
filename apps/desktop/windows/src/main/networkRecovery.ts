export interface StreamResumeState {
  content: string;
  fileEventKeys: Set<string>;
  planAdjustmentKeys?: Set<string>;
}

export interface StreamAttemptCursor {
  baseline: string;
  received: string;
  emitted: number;
}

export class RecoverableStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverableStreamError";
  }
}

export function createStreamAttemptCursor(state: StreamResumeState): StreamAttemptCursor {
  return { baseline: state.content, received: "", emitted: 0 };
}

export function appendResumedContent(
  state: StreamResumeState,
  cursor: StreamAttemptCursor,
  chunk: string,
): string {
  cursor.received += chunk;
  let novel = "";
  if (cursor.baseline.startsWith(cursor.received)) {
    return "";
  }
  if (cursor.received.startsWith(cursor.baseline)) {
    const suffix = cursor.received.slice(cursor.baseline.length);
    novel = suffix.slice(cursor.emitted);
    cursor.emitted = suffix.length;
  } else {
    novel = cursor.received.slice(cursor.emitted);
    cursor.emitted = cursor.received.length;
  }
  state.content += novel;
  return novel;
}

export function isRecoverableNetworkError(error: unknown): boolean {
  if (error instanceof RecoverableStreamError) return true;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /fetch failed|network|socket|connection|ECONN|UND_ERR|terminated|other side closed/i.test(error.message);
}

export async function waitForNetworkRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Request was aborted.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Request was aborted."));
    }, { once: true });
  });
}

export function networkRetryDelayMs(attempt: number): number {
  return Math.min(5_000, 500 * (2 ** Math.min(attempt, 4)));
}
