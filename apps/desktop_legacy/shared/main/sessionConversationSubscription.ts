import type {
  RuntimeConversationSnapshot,
  RuntimeSessionEvent,
  RuntimeSessionEventStream,
} from "./runtimeClient";

export interface SessionConversationTransport {
  getConversationSnapshot(sessionId: string): Promise<RuntimeConversationSnapshot>;
  openSessionEventStream(
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): Promise<RuntimeSessionEventStream>;
}

export interface SessionConversationSubscriber {
  onSnapshot(snapshot: RuntimeConversationSnapshot): void | Promise<void>;
  onEvent(event: RuntimeSessionEvent): void | Promise<void>;
  onConnection?(state: "connected" | "retrying" | "stopped", attempt: number): void;
}

export interface SessionConversationSubscription {
  readonly sessionId: string;
  readonly cursor: number;
  readonly terminalError?: unknown;
  readonly phase?: string;
  stop(): void;
  done: Promise<void>;
}

class SessionEventGap extends Error {
  constructor() {
    super("Runtime Session Event sequence has a gap.");
  }
}

function isCursorExpired(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "cursor_expired",
  );
}

async function consumeEventStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: RuntimeSessionEvent) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) await onEvent(JSON.parse(data) as RuntimeSessionEvent);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function subscribeSessionConversation(
  transport: SessionConversationTransport,
  sessionId: string,
  subscriber: SessionConversationSubscriber,
  options: { retryDelayMs?: number; signal?: AbortSignal } = {},
): SessionConversationSubscription {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(sessionId)) {
    throw new Error("Session ID is invalid.");
  }
  const controller = new AbortController();
  options.signal?.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  const retryDelayMs = Math.max(10, Math.min(30_000, options.retryDelayMs ?? 500));
  let cursor = 0;

  const done = (async () => {
    let needsSnapshot = true;
    let attempt = 0;
    while (!controller.signal.aborted) {
      try {
        if (needsSnapshot) {
          const snapshot = await transport.getConversationSnapshot(sessionId);
          if (snapshot.session_id !== sessionId || snapshot.snapshot_sequence < 0) {
            throw new Error("Runtime Conversation snapshot is invalid.");
          }
          await subscriber.onSnapshot(snapshot);
          cursor = snapshot.snapshot_sequence;
          needsSnapshot = false;
        }
        const opened = await transport.openSessionEventStream(sessionId, cursor, controller.signal);
        attempt = 0;
        subscriber.onConnection?.("connected", attempt);
        await consumeEventStream(opened.events, controller.signal, async (event) => {
          if (event.session_id !== sessionId) throw new Error("Cross-Session Event rejected.");
          if (event.session_sequence <= cursor) return;
          if (event.session_sequence !== cursor + 1) throw new SessionEventGap();
          await subscriber.onEvent(event);
          cursor = event.session_sequence;
        });
      } catch (error) {
        if (controller.signal.aborted) break;
        needsSnapshot = needsSnapshot || isCursorExpired(error) || error instanceof SessionEventGap;
        attempt += 1;
        subscriber.onConnection?.("retrying", attempt);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryDelayMs);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    }
    subscriber.onConnection?.("stopped", attempt);
  })();

  return {
    sessionId,
    get cursor() { return cursor; },
    stop: () => controller.abort("subscription_stopped"),
    done,
  };
}
