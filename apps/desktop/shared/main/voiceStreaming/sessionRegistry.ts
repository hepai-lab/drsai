// Platform-neutral owner-scoped streaming session registry.
export type StreamingVoiceSessionTerminal = "completed" | "cancelled" | "failed";

export interface StreamingVoiceSessionRecord<T> {
  sessionId: string;
  turnId: string;
  ownerId: string;
  createdAt: number;
  value: T;
  terminal: StreamingVoiceSessionTerminal | null;
}

export class StreamingVoiceSessionRegistry<T> {
  readonly maxSessions: number;
  #sessions = new Map<string, StreamingVoiceSessionRecord<T>>();

  constructor(maxSessions = 3) {
    if (!Number.isInteger(maxSessions) || maxSessions <= 0) throw new Error("maxSessions must be a positive integer.");
    this.maxSessions = maxSessions;
  }

  get size(): number { return this.#sessions.size; }

  register(input: Omit<StreamingVoiceSessionRecord<T>, "createdAt" | "terminal">, now = Date.now()): StreamingVoiceSessionRecord<T> {
    if (!input.sessionId || !input.turnId || !input.ownerId) throw new Error("Session, turn, and owner IDs are required.");
    if (this.#sessions.has(input.sessionId)) throw new Error("Streaming voice session already exists.");
    if ([...this.#sessions.values()].some((session) => session.ownerId === input.ownerId && session.terminal === null)) {
      throw new Error("The owner already has an active streaming voice session.");
    }
    if ([...this.#sessions.values()].filter((session) => session.terminal === null).length >= this.maxSessions) {
      throw new Error("Too many active streaming voice sessions.");
    }
    const record = { ...input, createdAt: now, terminal: null };
    this.#sessions.set(input.sessionId, record);
    return record;
  }

  get(sessionId: string): StreamingVoiceSessionRecord<T> | undefined { return this.#sessions.get(sessionId); }

  activeSessionIdsForOwner(ownerId: string): string[] {
    return [...this.#sessions.values()]
      .filter((session) => session.ownerId === ownerId && session.terminal === null)
      .map((session) => session.sessionId);
  }

  finish(sessionId: string, terminal: StreamingVoiceSessionTerminal): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session || session.terminal !== null) return false;
    session.terminal = terminal;
    return true;
  }

  cancelOwner(ownerId: string): string[] {
    const cancelled: string[] = [];
    for (const session of this.#sessions.values()) {
      if (session.ownerId === ownerId && session.terminal === null && this.finish(session.sessionId, "cancelled")) {
        cancelled.push(session.sessionId);
      }
    }
    return cancelled;
  }

  delete(sessionId: string): boolean { return this.#sessions.delete(sessionId); }

  clear(): void { this.#sessions.clear(); }
}
