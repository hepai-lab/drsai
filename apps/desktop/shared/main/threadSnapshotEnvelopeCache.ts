import type { DesktopThreadSnapshotEnvelope } from "../api/desktopApi";

interface Entry { value: DesktopThreadSnapshotEnvelope; bytes: number; touchedAt: number; pins: number; stale: boolean }

export class ThreadSnapshotEnvelopeCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private readonly pinCounts = new Map<string, number>();

  constructor(
    private readonly maximumEntries = 128,
    private readonly maximumBytes = 64 * 1024 * 1024,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  get(threadId: string): DesktopThreadSnapshotEnvelope | undefined {
    const entry = this.entries.get(threadId);
    if (!entry) { this.misses += 1; return undefined; }
    if (!entry.pins && Date.now() - entry.touchedAt > this.ttlMs) {
      this.remove(threadId); this.misses += 1; return undefined;
    }
    entry.touchedAt = Date.now();
    this.entries.delete(threadId); this.entries.set(threadId, entry);
    this.hits += 1;
    return entry.value;
  }

  set(threadId: string, value: DesktopThreadSnapshotEnvelope): void {
    const previous = this.entries.get(threadId);
    if (previous) this.bytes -= previous.bytes;
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    this.entries.set(threadId, { value, bytes, touchedAt: Date.now(), pins: this.pinCounts.get(threadId) ?? 0, stale: false });
    this.bytes += bytes;
    this.evict();
  }

  isStale(threadId: string): boolean { return this.entries.get(threadId)?.stale ?? false; }
  markStale(threadId: string): void { const entry = this.entries.get(threadId); if (entry) entry.stale = true; }
  pin(threadId: string): void {
    const count = (this.pinCounts.get(threadId) ?? 0) + 1;
    this.pinCounts.set(threadId, count);
    const entry = this.entries.get(threadId); if (entry) entry.pins = count;
  }
  unpin(threadId: string): void {
    const count = Math.max(0, (this.pinCounts.get(threadId) ?? 0) - 1);
    if (count) this.pinCounts.set(threadId, count); else this.pinCounts.delete(threadId);
    const entry = this.entries.get(threadId); if (entry) entry.pins = count;
    this.evict();
  }

  private remove(threadId: string): void {
    const entry = this.entries.get(threadId);
    if (!entry) return;
    this.bytes -= entry.bytes; this.entries.delete(threadId); this.evictions += 1;
  }

  private evict(): void {
    for (const [threadId, entry] of this.entries) {
      const expired = !entry.pins && Date.now() - entry.touchedAt > this.ttlMs;
      const overBudget = this.entries.size > this.maximumEntries || this.bytes > this.maximumBytes;
      if (!expired && !overBudget) break;
      if (!entry.pins) this.remove(threadId);
    }
  }

  diagnostics() {
    return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses,
      evictions: this.evictions, pinned: [...this.entries.values()].filter((entry) => entry.pins > 0).length,
      stale: [...this.entries.values()].filter((entry) => entry.stale).length,
      maximumEntries: this.maximumEntries, maximumBytes: this.maximumBytes };
  }
}
