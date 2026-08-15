import type { WebContents } from "electron";
import { getRuntimeThreadSnapshot, subscribeRuntimeThreadSnapshot } from "../../../shared/main/threadRuntimeSubscription";
import type { SessionConversationSubscription } from "../../../shared/main/sessionConversationSubscription";
import { listThreads, updateThread } from "../../../shared/main/threads";
import { upsertThreadFromRun } from "../../../shared/main/threads";
import { listWorkspaces } from "../../../shared/main/workspaces";
import { LocalRuntimeClient } from "../../../shared/main/runtimeClient";
import type { RuntimeSession } from "../../../shared/main/runtimeClient";
import { bootstrapRuntimeSessionCatalog } from "../../../shared/main/runtimeSessionCatalogBootstrap";
import { consumeWorkspaceSessionCatalogStream, WorkspaceSessionCatalogGate } from "../../../shared/main/workspaceSessionCatalog";

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
  readonly #workspaceCatalogs = new Map<string, AbortController>();
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

  async ensureWorkspaceCatalogs(target: WebContents): Promise<void> {
    if (target.isDestroyed()) return;
    const client = await LocalRuntimeClient.connect();
    for (const workspace of (await client.listWorkspaces(false))) {
      const key = `${target.id}:${workspace.workspace_id}`;
      if (this.#workspaceCatalogs.has(key)) continue;
      const controller = new AbortController();
      this.#workspaceCatalogs.set(key, controller);
      const gate = new WorkspaceSessionCatalogGate();
      void (async () => {
        while (!controller.signal.aborted && !target.isDestroyed()) {
          try {
            const client = await LocalRuntimeClient.connect();
            const stream = await client.openWorkspaceSessionCatalogStream(workspace.workspace_id, controller.signal);
            await bootstrapRuntimeSessionCatalog(client, workspace.workspace_id, async (runtime) => {
              await this.#applyWorkspaceCatalogSession(target, runtime);
            });
            await consumeWorkspaceSessionCatalogStream(stream.events, async (event) => {
              if (gate.accept(event) !== "apply" || target.isDestroyed()) return;
              const runtime = await (await LocalRuntimeClient.connect()).getSession(event.session_id);
              await this.#applyWorkspaceCatalogSession(target, runtime);
            });
          } catch {
            if (controller.signal.aborted || target.isDestroyed()) break;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        }
      })().finally(() => { if (this.#workspaceCatalogs.get(key) === controller) this.#workspaceCatalogs.delete(key); });
      target.once("destroyed", () => this.stopForTarget(target.id));
    }
  }

  async #applyWorkspaceCatalogSession(target: WebContents, runtime: RuntimeSession): Promise<void> {
    if (target.isDestroyed()) return;
    const localWorkspace = (await listWorkspaces()).find((item) => item.id === runtime.workspace_id);
    if (!localWorkspace) return;
    const thread = await upsertThreadFromRun({
      id: runtime.session_id, kind: "chat", title: runtime.title,
      workspacePath: localWorkspace.path, runtimeSessionId: runtime.session_id,
      sourceChannel: runtime.origin?.provider === "wechat" ? "wechat" : undefined,
      status: "idle", messageCount: runtime.message_count ?? 0,
    });
    const updated = await updateThread({
      id: thread.id,
      archived: runtime.archived === true || runtime.lifecycle === "archived" || runtime.lifecycle === "removed",
      archiveSource: runtime.archived === true || runtime.lifecycle === "archived" ? "opendrsai" : undefined,
    });
    if (!target.isDestroyed()) {
      target.send("desktop:thread-catalog", { thread: updated, source: "runtime-session" });
    }
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
    for (const [key, controller] of this.#workspaceCatalogs) {
      if (!key.startsWith(`${targetId}:`)) continue;
      controller.abort();
      this.#workspaceCatalogs.delete(key);
    }
  }

  stopAll(): void {
    for (const subscription of this.#subscriptions.values()) subscription.stop();
    this.#subscriptions.clear();
    for (const timer of this.#catalogTimers.values()) clearInterval(timer);
    this.#catalogTimers.clear();
    this.#catalogBusy.clear();
    for (const controller of this.#workspaceCatalogs.values()) controller.abort();
    this.#workspaceCatalogs.clear();
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
