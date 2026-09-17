import type { DesktopThreadSnapshot } from "../../api/desktopApi";

interface SnapshotEntry { snapshot: DesktopThreadSnapshot; bytes: number; touchedAt: number }

/** Session-keyed bounded store: body deltas notify only consumers of that Session. */
export class ThreadSnapshotStore {
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private totalBytes = 0;
  private evictions = 0;

  constructor(
    initial: Record<string, DesktopThreadSnapshot> = {},
    private readonly maximumSessions = 128,
    private readonly maximumBytes = 64 * 1024 * 1024,
    private readonly ttlMs = 10 * 60_000,
  ) {
    for (const [threadId, snapshot] of Object.entries(initial)) this.set(threadId, snapshot);
  }

  get(threadId: string): DesktopThreadSnapshot | null {
    const entry = this.snapshots.get(threadId);
    if (!entry) return null;
    if (!this.listeners.has(threadId) && Date.now() - entry.touchedAt > this.ttlMs) {
      this.delete(threadId); return null;
    }
    entry.touchedAt = Date.now();
    this.snapshots.delete(threadId); this.snapshots.set(threadId, entry);
    return entry.snapshot;
  }

  all(): Record<string, DesktopThreadSnapshot> {
    return Object.fromEntries([...this.snapshots].map(([threadId, entry]) => [threadId, entry.snapshot]));
  }

  set(threadId: string, snapshot: DesktopThreadSnapshot, estimatedByteDelta?: number): void {
    const previous = this.snapshots.get(threadId);
    if (previous?.snapshot === snapshot) return;
    if (previous) this.totalBytes -= previous.bytes;
    const bytes = previous && Number.isFinite(estimatedByteDelta) && Number(estimatedByteDelta) >= 0
      ? previous.bytes + Number(estimatedByteDelta)
      : new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    this.snapshots.set(threadId, { snapshot, bytes, touchedAt: Date.now() });
    this.totalBytes += bytes;
    for (const listener of this.listeners.get(threadId) ?? []) listener();
    this.evict();
  }

  update(threadId: string, updater: (current: DesktopThreadSnapshot | null) => DesktopThreadSnapshot | null): void {
    const next = updater(this.get(threadId));
    if (next) this.set(threadId, next);
  }

  delete(threadId: string): void {
    const entry = this.snapshots.get(threadId);
    if (!entry) return;
    this.snapshots.delete(threadId); this.totalBytes -= entry.bytes; this.evictions += 1;
  }

  subscribe(threadId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(threadId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(threadId);
      this.evict();
    };
  }

  private evict(): void {
    for (const [threadId, entry] of this.snapshots) {
      const expired = !this.listeners.has(threadId) && Date.now() - entry.touchedAt > this.ttlMs;
      const overBudget = this.snapshots.size > this.maximumSessions || this.totalBytes > this.maximumBytes;
      if (!expired && !overBudget) break;
      if (!this.listeners.has(threadId)) this.delete(threadId);
    }
  }

  diagnostics(): { sessions: number; subscribers: number; bytes: number; evictions: number; maximumSessions: number; maximumBytes: number } {
    return {
      sessions: this.snapshots.size,
      subscribers: [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
      bytes: this.totalBytes, evictions: this.evictions,
      maximumSessions: this.maximumSessions, maximumBytes: this.maximumBytes,
    };
  }
}
