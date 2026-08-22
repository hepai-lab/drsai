import type { WebContents } from "electron";
import { getRuntimeThreadSnapshot, subscribeRuntimeThreadSnapshot } from "../../../shared/main/threadRuntimeSubscription";
import type { SessionConversationSubscription } from "../../../shared/main/sessionConversationSubscription";
import { listThreads, updateThread } from "../../../shared/main/threads";

export interface MacosThreadSnapshotControllerDependencies {
  listThreads: typeof listThreads;
  updateThread: typeof updateThread;
  getRuntimeThreadSnapshot: typeof getRuntimeThreadSnapshot;
  subscribeRuntimeThreadSnapshot: typeof subscribeRuntimeThreadSnapshot;
}

export class MacosThreadSnapshotController {
  readonly #subscriptions = new Map<string, SessionConversationSubscription>();
  readonly #catalogTimers = new Map<number, NodeJS.Timeout>();
  readonly #catalogBusy = new Set<number>();
  readonly #dependencies: MacosThreadSnapshotControllerDependencies;

  constructor(dependencies: MacosThreadSnapshotControllerDependencies = { listThreads, updateThread, getRuntimeThreadSnapshot, subscribeRuntimeThreadSnapshot }) {
    this.#dependencies = dependencies;
  }

  async subscribe(target: WebContents, threadId: string): Promise<boolean> {
    if (!validThreadId(threadId) || target.isDestroyed()) return false;
    const thread = (await this.#dependencies.listThreads()).find((item) => item.id === threadId);
    if (!thread) return false;
    this.#startCatalogSync(target, threadId);
    const key = subscriptionKey(target.id, threadId);
    this.#subscriptions.get(key)?.stop();
    this.#subscriptions.delete(key);
    const subscription = await this.#dependencies.subscribeRuntimeThreadSnapshot(thread, target).catch(() => null);
    if (!subscription) return false;
    this.#subscriptions.set(key, subscription);
    target.once("destroyed", () => this.stopForTarget(target.id));
    void subscription.done.finally(() => {
      if (this.#subscriptions.get(key) === subscription) this.#subscriptions.delete(key);
    });
    return true;
  }

  unsubscribe(targetId: number, threadId: string): boolean {
    if (!validThreadId(threadId)) return false;
    const key = subscriptionKey(targetId, threadId);
    const subscription = this.#subscriptions.get(key);
    subscription?.stop();
    return this.#subscriptions.delete(key);
  }

  stopForTarget(targetId: number): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (!key.startsWith(`${targetId}:`)) continue;
      subscription.stop();
      this.#subscriptions.delete(key);
    }
    const timer = this.#catalogTimers.get(targetId);
    if (timer) clearInterval(timer);
    this.#catalogTimers.delete(targetId);
    this.#catalogBusy.delete(targetId);
  }

  stopAll(): void {
    for (const subscription of this.#subscriptions.values()) subscription.stop();
    this.#subscriptions.clear();
    for (const timer of this.#catalogTimers.values()) clearInterval(timer);
    this.#catalogTimers.clear();
    this.#catalogBusy.clear();
  }

  #startCatalogSync(target: WebContents, activeThreadId: string): void {
    const current = this.#catalogTimers.get(target.id);
    if (current) clearInterval(current);
    void this.#syncCatalog(target, activeThreadId);
    const timer = setInterval(() => void this.#syncCatalog(target, activeThreadId), 5_000);
    timer.unref();
    this.#catalogTimers.set(target.id, timer);
  }

  async #syncCatalog(target: WebContents, activeThreadId: string): Promise<void> {
    if (target.isDestroyed() || this.#catalogBusy.has(target.id)) return;
    this.#catalogBusy.add(target.id);
    try {
      for (const thread of (await this.#dependencies.listThreads()).filter((item) => item.runtimeSessionId && !item.archived)) {
        const snapshot = await this.#dependencies.getRuntimeThreadSnapshot(thread).catch(() => null);
        if (!snapshot || snapshot.updatedAt <= Date.parse(thread.updatedAt)) continue;
        const updated = await this.#dependencies.updateThread({ id: thread.id, messageCount: snapshot.messageCount, unread: thread.id !== activeThreadId });
        if (!target.isDestroyed()) target.send("desktop:thread-catalog", { thread: updated, source: "runtime-session" });
      }
    } finally {
      this.#catalogBusy.delete(target.id);
    }
  }
}

function subscriptionKey(targetId: number, threadId: string): string {
  return `${targetId}:${threadId}`;
}

function validThreadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

export const macosThreadSnapshotController = new MacosThreadSnapshotController();
