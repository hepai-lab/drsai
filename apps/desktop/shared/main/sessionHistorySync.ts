import type { RuntimeClient } from "./runtimeClient";

export type SessionHistorySyncResult = Awaited<ReturnType<RuntimeClient["syncBackendSessionHistory"]>>;

interface Entry {
  promise: Promise<SessionHistorySyncResult>;
  expiresAt: number;
  controller: AbortController;
  waiters: number;
}

export type SessionHistorySyncPhase = "discovered" | "persisted";
export type SessionHistorySyncOptions = { signal?: AbortSignal; onProgress?: (phase: SessionHistorySyncPhase) => void };

const inflightAndRecent = new Map<string, Entry>();
const RECENT_SYNC_TTL_MS = 30_000;
const MAX_RECENT_SYNCS = 128;

/** Coalesces get+subscribe hydration and briefly reuses the resulting watermark. */
export function syncSessionHistorySingleflight(
  client: RuntimeClient,
  sessionId: string,
  options: SessionHistorySyncOptions = {},
): Promise<SessionHistorySyncResult> {
  const key = `${client.streamIdentity}\u0000${sessionId}`;
  const now = Date.now();
  const existing = inflightAndRecent.get(key);
  if (existing && existing.expiresAt > now) return joinEntry(existing, options);

  options.onProgress?.("discovered");
  const controller = new AbortController();
  const promise = client.syncBackendSessionHistory(sessionId, controller.signal);
  const entry = { promise, expiresAt: Number.POSITIVE_INFINITY, controller, waiters: 0 };
  inflightAndRecent.set(key, entry);
  void promise.then(
    () => { entry.expiresAt = Date.now() + RECENT_SYNC_TTL_MS; trimRecentEntries(); },
    () => { if (inflightAndRecent.get(key) === entry) inflightAndRecent.delete(key); },
  );
  trimRecentEntries();
  return joinEntry(entry, options);
}

function trimRecentEntries(): void {
  while (inflightAndRecent.size > MAX_RECENT_SYNCS) {
    const oldest = [...inflightAndRecent.entries()]
      .filter(([, candidate]) => candidate.expiresAt !== Number.POSITIVE_INFINITY)
      .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
      .find(([, candidate]) => candidate.expiresAt !== Number.POSITIVE_INFINITY)?.[0];
    if (!oldest) break;
    inflightAndRecent.delete(oldest);
  }
}

function joinEntry(entry: Entry, options: SessionHistorySyncOptions): Promise<SessionHistorySyncResult> {
  options.signal?.throwIfAborted();
  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      entry.waiters = Math.max(0, entry.waiters - 1);
    };
    const abort = () => {
      finish();
      if (entry.waiters === 0 && entry.expiresAt === Number.POSITIVE_INFINITY) entry.controller.abort(options.signal?.reason);
      reject(options.signal?.reason ?? new DOMException("History sync cancelled.", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    void entry.promise.then((value) => {
      if (settled) return;
      options.onProgress?.("persisted");
      finish(); resolve(value);
    }, (error) => { if (!settled) { finish(); reject(error); } });
  });
}

export function invalidateSessionHistorySync(client?: RuntimeClient, sessionId?: string): void {
  if (!client) {
    for (const entry of inflightAndRecent.values()) {
      if (entry.expiresAt === Number.POSITIVE_INFINITY) entry.controller.abort(new DOMException("History sync invalidated.", "AbortError"));
    }
    inflightAndRecent.clear();
    return;
  }
  const prefix = `${client.streamIdentity}\u0000`;
  for (const key of inflightAndRecent.keys()) {
    if (key.startsWith(prefix) && (!sessionId || key === `${prefix}${sessionId}`)) {
      const entry = inflightAndRecent.get(key);
      if (entry?.expiresAt === Number.POSITIVE_INFINITY) entry.controller.abort(new DOMException("History sync invalidated.", "AbortError"));
      inflightAndRecent.delete(key);
    }
  }
}

export function getSessionHistorySyncDiagnostics(): { entries: number; active: number; recent: number; waiters: number } {
  const values = [...inflightAndRecent.values()];
  const active = values.filter((entry) => entry.expiresAt === Number.POSITIVE_INFINITY).length;
  return { entries: values.length, active, recent: values.length - active,
    waiters: values.reduce((total, entry) => total + entry.waiters, 0) };
}
