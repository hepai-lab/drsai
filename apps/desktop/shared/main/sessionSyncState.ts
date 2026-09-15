import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";
import { replaceFileSafely } from "./atomicFileReplace";
import { advanceMessageDelivery, type MessageDeliveryState } from "./messageDelivery";

export interface SessionOutboxEntry {
  sourceMessageId: string;
  idempotencyKey: string;
  payloadHash: string;
  runId?: string;
  deliveryState: MessageDeliveryState;
  createdAt: string;
}

interface SessionSyncEntry {
  cursor: number;
  updatedAt: string;
  outbox?: SessionOutboxEntry;
}

interface SessionSyncFile {
  version: 1;
  sessions: Record<string, SessionSyncEntry>;
}

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const HASH = /^[a-f0-9]{64}$/;

export function sessionPayloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class SessionSyncStateStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pendingCursors = new Map<string, {
    cursor: number;
    waiters: Array<{ resolve: (entry: SessionSyncEntry) => void; reject: (error: unknown) => void }>;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    readonly path = join(DRSAI_HOME, "desktop", "session-sync-state.json"),
  ) {}

  async get(sessionId: string): Promise<SessionSyncEntry> {
    this.requireId(sessionId);
    const file = await this.read();
    return file.sessions[sessionId] ?? { cursor: 0, updatedAt: new Date(0).toISOString() };
  }

  /** Release an outbox entry after inspecting/recovering its Runtime run. */
  completeOutboxIfMatches(sessionId: string, sourceMessageId: string): Promise<boolean> {
    return this.completeOutbox(sessionId, sourceMessageId);
  }

  /**
   * Release an outbox entry whose Runtime acknowledgement this Desktop process
   * can no longer observe (degraded OAEP subscription, fatal stream error, or a
   * Runtime restart during the Run).
   *
   * The row is marked `failed` rather than deleted, because the POST may have
   * been accepted by the Runtime: the row keeps the idempotency key and Run id
   * that the restart-recovery path needs to resolve that exact message. A
   * `failed` row is not "pending" for `beginOutbox` purposes - it is treated as
   * stale and reconciled before the next send - so the Session can no longer
   * stay blocked on "awaiting Runtime acknowledgement" forever.
   */
  async abandonOutbox(sessionId: string, sourceMessageId: string): Promise<boolean> {
    this.requireId(sessionId);
    this.requireId(sourceMessageId);
    const current = await this.get(sessionId);
    const outbox = current.outbox;
    if (!outbox || outbox.sourceMessageId !== sourceMessageId) return false;
    if (outbox.deliveryState === "terminal" || outbox.deliveryState === "failed") return false;
    try {
      await this.markOutboxDelivery(sessionId, sourceMessageId, "failed");
      return true;
    } catch {
      // The row was completed or replaced between the read and the write, so
      // there is nothing left to release.
      return false;
    }
  }

  advanceCursor(sessionId: string, cursor: number): Promise<SessionSyncEntry> {
    this.requireId(sessionId);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Session cursor is invalid.");
    return new Promise<SessionSyncEntry>((resolve, reject) => {
      const pending = this.pendingCursors.get(sessionId);
      if (pending) {
        pending.cursor = Math.max(pending.cursor, cursor);
        pending.waiters.push({ resolve, reject });
        return;
      }
      const entry = {
        cursor,
        waiters: [{ resolve, reject }],
        timer: setTimeout(() => this.flushCursor(sessionId), 16),
      };
      this.pendingCursors.set(sessionId, entry);
    });
  }

  private flushCursor(sessionId: string): void {
    const pending = this.pendingCursors.get(sessionId);
    if (!pending) return;
    this.pendingCursors.delete(sessionId);
    void this.mutate((file) => {
      const current = file.sessions[sessionId] ?? { cursor: 0, updatedAt: new Date(0).toISOString() };
      const next = { ...current, cursor: Math.max(current.cursor, pending.cursor), updatedAt: new Date().toISOString() };
      file.sessions[sessionId] = next;
      return next;
    }).then(
      (result) => pending.waiters.forEach(({ resolve }) => resolve(result)),
      (error) => pending.waiters.forEach(({ reject }) => reject(error)),
    );
  }

  beginOutbox(
    sessionId: string,
    entry: Omit<SessionOutboxEntry, "createdAt" | "runId" | "deliveryState">,
  ): Promise<SessionOutboxEntry> {
    this.requireId(sessionId);
    this.requireId(entry.sourceMessageId);
    if (!ID.test(entry.idempotencyKey) || !HASH.test(entry.payloadHash)) throw new Error("Session outbox entry is invalid.");
    return this.mutate((file) => {
      const current = file.sessions[sessionId] ?? { cursor: 0, updatedAt: new Date(0).toISOString() };
      if (current.outbox) {
        if (
          current.outbox.sourceMessageId !== entry.sourceMessageId
          || current.outbox.idempotencyKey !== entry.idempotencyKey
          || current.outbox.payloadHash !== entry.payloadHash
        ) throw new Error("Another Session message is awaiting Runtime acknowledgement.");
        return current.outbox;
      }
      const outbox = { ...entry, deliveryState: "optimistic" as const, createdAt: new Date().toISOString() };
      file.sessions[sessionId] = { ...current, outbox, updatedAt: new Date().toISOString() };
      return outbox;
    });
  }

  attachRun(sessionId: string, sourceMessageId: string, runId: string): Promise<SessionOutboxEntry> {
    this.requireId(sessionId);
    this.requireId(sourceMessageId);
    this.requireId(runId);
    return this.mutate((file) => {
      const current = file.sessions[sessionId];
      if (!current?.outbox || current.outbox.sourceMessageId !== sourceMessageId) {
        throw new Error("Session outbox acknowledgement does not match.");
      }
      const outbox = {
        ...current.outbox,
        runId,
        deliveryState: advanceMessageDelivery(current.outbox.deliveryState, "accepted"),
      };
      file.sessions[sessionId] = { ...current, outbox, updatedAt: new Date().toISOString() };
      return outbox;
    });
  }

  markOutboxDelivery(
    sessionId: string,
    sourceMessageId: string,
    deliveryState: MessageDeliveryState,
  ): Promise<SessionOutboxEntry> {
    this.requireId(sessionId);
    this.requireId(sourceMessageId);
    return this.mutate((file) => {
      const current = file.sessions[sessionId];
      if (!current?.outbox || current.outbox.sourceMessageId !== sourceMessageId) {
        throw new Error("Session outbox delivery update does not match.");
      }
      const outbox = {
        ...current.outbox,
        deliveryState: advanceMessageDelivery(current.outbox.deliveryState, deliveryState),
      };
      file.sessions[sessionId] = { ...current, outbox, updatedAt: new Date().toISOString() };
      return outbox;
    });
  }

  completeOutbox(sessionId: string, sourceMessageId: string): Promise<boolean> {
    this.requireId(sessionId);
    this.requireId(sourceMessageId);
    return this.mutate((file) => {
      const current = file.sessions[sessionId];
      if (!current?.outbox) return false;
      if (current.outbox.sourceMessageId !== sourceMessageId) {
        throw new Error("Session outbox completion does not match.");
      }
      const { outbox: _completed, ...remaining } = current;
      file.sessions[sessionId] = { ...remaining, updatedAt: new Date().toISOString() };
      return true;
    });
  }

  private requireId(value: string): void {
    if (!ID.test(value)) throw new Error("Session sync identifier is invalid.");
  }

  private async read(): Promise<SessionSyncFile> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as Partial<SessionSyncFile>;
      if (raw.version !== 1 || !raw.sessions || typeof raw.sessions !== "object") throw new Error();
      const sessions: Record<string, SessionSyncEntry> = {};
      for (const [id, value] of Object.entries(raw.sessions)) {
        if (!ID.test(id) || !value || typeof value !== "object") continue;
        const row = value as Partial<SessionSyncEntry>;
        if (!Number.isSafeInteger(row.cursor) || Number(row.cursor) < 0) continue;
        sessions[id] = {
          cursor: Number(row.cursor),
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date(0).toISOString(),
          ...(row.outbox && ID.test(row.outbox.sourceMessageId) && ID.test(row.outbox.idempotencyKey)
            && HASH.test(row.outbox.payloadHash)
            ? { outbox: {
              ...row.outbox,
              deliveryState: isMessageDeliveryState(row.outbox.deliveryState)
                ? row.outbox.deliveryState : row.outbox.runId ? "accepted" : "optimistic",
              ...(row.outbox.runId && ID.test(row.outbox.runId) ? { runId: row.outbox.runId } : {}),
            } }
            : {}),
        };
      }
      return { version: 1, sessions };
    } catch {
      return { version: 1, sessions: {} };
    }
  }

  private mutate<T>(operation: (file: SessionSyncFile) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const file = await this.read();
      const result = operation(file);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await replaceFileSafely(temporary, this.path);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function isMessageDeliveryState(value: unknown): value is MessageDeliveryState {
  return ["optimistic", "sending", "accepted", "running", "terminal", "uncertain", "failed"].includes(String(value));
}

export const sessionSyncState = new SessionSyncStateStore();
