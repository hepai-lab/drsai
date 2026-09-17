import type { RuntimeWorkspaceSessionCatalogEvent } from "./runtimeClient";

const EVENT_TYPES = new Set<RuntimeWorkspaceSessionCatalogEvent["type"]>([
  "event.session.created", "event.session.updated", "event.session.archived",
  "event.session.unarchived", "event.session.deleted",
]);

export type WorkspaceSessionCatalogDecision = "apply" | "duplicate" | "stale";

export function decodeWorkspaceSessionCatalogEvent(raw: string): RuntimeWorkspaceSessionCatalogEvent {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session_catalog_event_shape_invalid");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "event_id,sequence,session_id,type"
    || typeof row.event_id !== "string" || !row.event_id || row.event_id.length > 240
    || typeof row.session_id !== "string" || !row.session_id || row.session_id.length > 200
    || typeof row.type !== "string" || !EVENT_TYPES.has(row.type as RuntimeWorkspaceSessionCatalogEvent["type"])
    || typeof row.sequence !== "number" || !Number.isSafeInteger(row.sequence) || row.sequence < 1) {
    throw new Error("session_catalog_event_invalid");
  }
  return row as unknown as RuntimeWorkspaceSessionCatalogEvent;
}

export class WorkspaceSessionCatalogGate {
  readonly #events = new Map<string, string>();
  readonly #sessions = new Map<string, number>();
  readonly eventCapacity: number;
  readonly sessionCapacity: number;
  constructor(eventCapacity = 4096, sessionCapacity = 20_000) {
    if (eventCapacity < 1 || eventCapacity > 65_536 || sessionCapacity < 1 || sessionCapacity > 100_000) {
      throw new Error("session_catalog_gate_capacity_invalid");
    }
    this.eventCapacity = eventCapacity;
    this.sessionCapacity = sessionCapacity;
  }

  accept(event: RuntimeWorkspaceSessionCatalogEvent): WorkspaceSessionCatalogDecision {
    const signature = `${event.session_id}\0${event.type}\0${event.sequence}`;
    const duplicate = this.#events.get(event.event_id);
    if (duplicate !== undefined) {
      if (duplicate !== signature) throw new Error("session_catalog_event_id_collision");
      return "duplicate";
    }
    const last = this.#sessions.get(event.session_id);
    if (last !== undefined && event.sequence <= last) {
      if (event.sequence === last) throw new Error("session_catalog_event_sequence_collision");
      return "stale";
    }
    this.#events.set(event.event_id, signature);
    this.#sessions.set(event.session_id, event.sequence);
    while (this.#events.size > this.eventCapacity) this.#events.delete(this.#events.keys().next().value!);
    while (this.#sessions.size > this.sessionCapacity) this.#sessions.delete(this.#sessions.keys().next().value!);
    return "apply";
  }
}

/** Parse a finite or live SSE body without retaining payloads after delivery. */
export async function consumeWorkspaceSessionCatalogStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: RuntimeWorkspaceSessionCatalogEvent) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (!line && data.length) {
          await onEvent(decodeWorkspaceSessionCatalogEvent(data.join("\n")));
          data = [];
        }
      }
      if (next.done) break;
    }
    if (data.length) await onEvent(decodeWorkspaceSessionCatalogEvent(data.join("\n")));
  } finally {
    reader.releaseLock();
  }
}
