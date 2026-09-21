import { randomUUID } from "node:crypto";
import type {
  ConversationResourceStateEvent,
  ConversationResourceSubscriptionRequest,
} from "../api/desktopApi";
import { pollConversationResourceEvents } from "./conversationResourceActions";

type Poll = typeof pollConversationResourceEvents;
type Timer = ReturnType<typeof setTimeout>;

interface ActiveSubscription {
  request: ConversationResourceSubscriptionRequest;
  cursor: number;
  timer?: Timer;
  stopped: boolean;
}

export class ConversationResourceSubscriptionManager {
  private readonly active = new Map<string, ActiveSubscription>();

  constructor(
    private readonly poll: Poll,
    private readonly emit: (event: ConversationResourceStateEvent) => void,
    private readonly intervalMs = 1_000,
  ) {}

  async start(request: ConversationResourceSubscriptionRequest): Promise<string> {
    if (!request?.workspacePath || !request.sessionId ||
        request.afterSequence !== undefined && (!Number.isSafeInteger(request.afterSequence) || request.afterSequence < 0)) {
      throw new Error("conversation_resource_subscription_invalid");
    }
    const subscriptionId = `resource-subscription-${randomUUID()}`;
    const active: ActiveSubscription = { request: { ...request }, cursor: request.afterSequence ?? 0, stopped: false };
    this.active.set(subscriptionId, active);
    await this.tick(subscriptionId, active);
    return subscriptionId;
  }

  stop(subscriptionId: string): boolean {
    const active = this.active.get(subscriptionId);
    if (!active) return false;
    active.stopped = true;
    if (active.timer) clearTimeout(active.timer);
    this.active.delete(subscriptionId);
    return true;
  }

  stopAll(): void {
    for (const subscriptionId of [...this.active.keys()]) this.stop(subscriptionId);
  }

  private async tick(subscriptionId: string, active: ActiveSubscription): Promise<void> {
    try {
      const result = await this.poll(active.request, active.cursor);
      if (active.stopped || this.active.get(subscriptionId) !== active) return;
      active.cursor = result.cursor;
      for (const event of result.events) this.emit({ subscriptionId, ...event });
    } catch {
      if (!active.stopped && this.active.get(subscriptionId) === active) this.emit({
        subscriptionId, workspacePath: active.request.workspacePath, sessionId: active.request.sessionId,
        sequence: active.cursor, eventType: "resource.subscription.invalidated", scopeInvalidated: true,
      });
    }
    if (!active.stopped && this.active.get(subscriptionId) === active) {
      active.timer = setTimeout(() => void this.tick(subscriptionId, active), this.intervalMs);
      active.timer.unref?.();
    }
  }
}

export function registerConversationResourceSubscriptionIpc(
  register: (channel: string, handler: (event: unknown, raw: unknown) => unknown) => void,
  emit: (event: unknown, value: ConversationResourceStateEvent) => void,
  poll: Poll = pollConversationResourceEvents,
): void {
  const senders = new WeakMap<object, ConversationResourceSubscriptionManager>();
  const managerFor = (event: unknown) => {
    const sender = (event as { sender?: object })?.sender ?? event as object;
    let manager = senders.get(sender);
    if (!manager) {
      manager = new ConversationResourceSubscriptionManager(poll, (value) => emit(event, value));
      senders.set(sender, manager);
      const once = (sender as { once?: (name: string, callback: () => void) => void }).once;
      if (typeof once === "function") once.call(sender, "destroyed", () => manager?.stopAll());
    }
    return manager;
  };
  register("desktop:conversation-resource-subscription-start", (event, raw) =>
    managerFor(event).start(raw as ConversationResourceSubscriptionRequest));
  register("desktop:conversation-resource-subscription-stop", (event, raw) =>
    managerFor(event).stop(String(raw || "")));
}
