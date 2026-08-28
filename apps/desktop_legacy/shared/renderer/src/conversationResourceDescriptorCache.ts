export const CONVERSATION_RESOURCE_DESCRIPTOR_TTL_MS = 30_000;

export function visibleConversationResourceWindow<T>(items: readonly T[], start: number, limit = 100): T[] {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("conversation_resource_viewport_invalid");
  }
  return items.slice(start, start + limit);
}

interface Entry<T> { value: T; expiresAt: number; resourceId?: string }

/** Display-only Descriptor cache. Host actions still re-resolve and authorize. */
export class ConversationResourceDescriptorCache<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs = CONVERSATION_RESOURCE_DESCRIPTOR_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(scope: string, identity: string, load: () => Promise<T>, resourceId?: string): Promise<T> {
    const key = `${scope}\u0000${identity}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = load().then((value) => {
      this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs, resourceId });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  invalidateActionFailure(scope: string, identity: string): void {
    this.entries.delete(`${scope}\u0000${identity}`);
  }

  invalidateWatch(resourceId: string): void {
    for (const [key, entry] of this.entries) if (entry.resourceId === resourceId) this.entries.delete(key);
  }

  invalidateScope(scope: string): void {
    const prefix = `${scope}\u0000`;
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  clear(): void { this.entries.clear(); this.pending.clear(); }
  size(): number { return this.entries.size; }
}
