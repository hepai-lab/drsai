// Platform-neutral ordering guard for streaming provider events.
export type StreamingEventCursorResult = "accepted" | "duplicate" | "out_of_order" | "wrong_session" | "terminal";

export class StreamingVoiceEventCursor {
  readonly sessionId: string;
  readonly turnId: string;
  #lastSequence = -1;
  #terminal = false;

  constructor(sessionId: string, turnId: string) {
    if (!sessionId || !turnId) throw new Error("Streaming event cursor requires session and turn IDs.");
    this.sessionId = sessionId;
    this.turnId = turnId;
  }

  get lastSequence(): number { return this.#lastSequence; }

  accept(event: { sessionId: string; turnId: string; sequence: number }, terminal = false): StreamingEventCursorResult {
    if (this.#terminal) return "terminal";
    if (event.sessionId !== this.sessionId || event.turnId !== this.turnId) return "wrong_session";
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) return "out_of_order";
    if (event.sequence === this.#lastSequence) return "duplicate";
    if (event.sequence !== this.#lastSequence + 1) return "out_of_order";
    this.#lastSequence = event.sequence;
    if (terminal) this.#terminal = true;
    return "accepted";
  }
}
