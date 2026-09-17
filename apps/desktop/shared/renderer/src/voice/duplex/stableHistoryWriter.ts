import type { DesktopDuplexVoiceHistoryAppendRequest } from "../../../../api/desktopApi";
import type { DuplexTranscriptProjection } from "./transcriptProjection";

export interface DuplexStableHistoryWriterOptions {
  threadId: string;
  projection: DuplexTranscriptProjection;
  append: (request: DesktopDuplexVoiceHistoryAppendRequest) => Promise<unknown>;
}

/** Serializes stable transcript revisions and keeps failed revisions dirty for a bounded terminal retry. */
export class DuplexStableHistoryWriter {
  readonly #options: DuplexStableHistoryWriterOptions;
  #tail: Promise<boolean> = Promise.resolve(true);

  constructor(options: DuplexStableHistoryWriterOptions) { this.#options = options; }

  enqueue(): Promise<boolean> {
    const operation = this.#tail.catch(() => false).then(() => this.#persistPending());
    this.#tail = operation;
    return operation;
  }

  async flush(maxAttempts = 2): Promise<boolean> {
    await this.#tail.catch(() => false);
    const attempts = Math.max(1, Math.min(5, Math.trunc(maxAttempts)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.#options.projection.pendingStableRevisions().length === 0) return true;
      if (await this.#persistPending()) return true;
    }
    return this.#options.projection.pendingStableRevisions().length === 0;
  }

  async #persistPending(): Promise<boolean> {
    const messages = this.#options.projection.pendingStableRevisions();
    if (messages.length === 0) return true;
    try {
      await this.#options.append({ threadId: this.#options.threadId, messages });
      this.#options.projection.acknowledgeStableRevisions(messages);
      return true;
    } catch {
      return false;
    }
  }
}
