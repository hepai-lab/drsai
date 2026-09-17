import type { DesktopThread, DesktopThreadSnapshot } from "../api/desktopApi";
import type { RuntimeConversationItem, RuntimeConversationSnapshot, RuntimeSessionEvent } from "./runtimeClient";
import { projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";

/**
 * Compatibility boundary for Runtime conversation/1. OAEP state reduction and
 * the Renderer never inspect legacy event kinds or payload shapes.
 */
export class LegacyConversationAdapter {
  private readonly items = new Map<string, RuntimeConversationItem>();

  constructor(private readonly thread: DesktopThread) {}

  applySnapshot(snapshot: RuntimeConversationSnapshot): DesktopThreadSnapshot {
    this.items.clear();
    for (const item of snapshot.items) this.items.set(item.item_id, item);
    return this.project();
  }

  applyEvent(event: RuntimeSessionEvent): DesktopThreadSnapshot {
    if (event.kind === "conversation.item.created"
      || event.kind === "conversation.item.delta"
      || event.kind === "conversation.item.upsert") {
      const payload = event.payload;
      const itemPayload = payload.payload;
      if (typeof payload.item_id === "string" && itemPayload && typeof itemPayload === "object") {
        this.items.set(payload.item_id, {
          item_id: payload.item_id,
          session_id: event.session_id,
          run_id: event.run_id,
          kind: String(payload.kind) as RuntimeConversationItem["kind"],
          role: (payload.role ?? null) as RuntimeConversationItem["role"],
          revision: Number(payload.revision),
          session_sequence: event.session_sequence,
          source_client: String(payload.source_client) as RuntimeConversationItem["source_client"],
          source_message_id: typeof payload.source_message_id === "string" ? payload.source_message_id : null,
          created_at: String(payload.created_at),
          updated_at: String(payload.updated_at),
          payload: itemPayload as Record<string, unknown>,
        });
      }
    }
    return this.project();
  }

  private project(): DesktopThreadSnapshot {
    return projectRuntimeThreadSnapshot(this.thread, this.items.values());
  }
}
