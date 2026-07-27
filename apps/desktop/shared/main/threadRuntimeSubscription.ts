import type {
  DesktopThread,
  DesktopThreadSnapshot,
} from "../api/desktopApi";
import { connectRuntimeClientForWorkspace, type RuntimeConversationItem } from "./runtimeClient";
import { projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";
import {
  subscribeSessionConversation,
  type SessionConversationSubscription,
} from "./sessionConversationSubscription";
import { sessionSyncState } from "./sessionSyncState";

export interface ThreadSnapshotTarget {
  send(channel: "desktop:thread-snapshot", event: {
    threadId: string;
    runtimeSessionId: string;
    sessionSequence: number;
    snapshot: DesktopThreadSnapshot;
  }): void;
}

export { projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";

async function runtimeForThread(thread: DesktopThread) {
  if (!thread.runtimeSessionId || !thread.workspacePath) return null;
  return {
    resolved: await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    ),
    runtimeSessionId: thread.runtimeSessionId,
  };
}

export async function getRuntimeThreadSnapshot(
  thread: DesktopThread,
): Promise<DesktopThreadSnapshot | null> {
  const runtime = await runtimeForThread(thread);
  if (!runtime) return null;
  const snapshot = await runtime.resolved.client.getConversationSnapshot(runtime.runtimeSessionId);
  return projectRuntimeThreadSnapshot(
    thread, snapshot.items,
  );
}

export async function subscribeRuntimeThreadSnapshot(
  thread: DesktopThread,
  target: ThreadSnapshotTarget,
): Promise<SessionConversationSubscription | null> {
  const runtime = await runtimeForThread(thread);
  if (!runtime) return null;
  const capabilities = await runtime.resolved.client.getCapabilities();
  const required = [
    "conversation.snapshot",
    "session.event.resume",
    "session.event.stream",
    "session.event.cursor_expired",
  ];
  if (!required.every((name) => capabilities.capabilities.includes(name))) return null;
  const items = new Map<string, RuntimeConversationItem>();
  const publish = (sequence: number) => {
    target.send("desktop:thread-snapshot", {
      threadId: thread.id,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionSequence: sequence,
      snapshot: projectRuntimeThreadSnapshot(thread, items.values()),
    });
  };
  return subscribeSessionConversation(runtime.resolved.client, runtime.runtimeSessionId, {
    onSnapshot(snapshot) {
      items.clear();
      for (const item of snapshot.items) items.set(item.item_id, item);
      publish(snapshot.snapshot_sequence);
      return sessionSyncState.advanceCursor(runtime.runtimeSessionId, snapshot.snapshot_sequence).then(() => undefined);
    },
    async onEvent(event) {
      if (
        event.kind === "conversation.item.created"
        || event.kind === "conversation.item.delta"
        || event.kind === "conversation.item.upsert"
      ) {
        const payload = event.payload;
        const itemPayload = payload.payload;
        if (typeof payload.item_id === "string" && itemPayload && typeof itemPayload === "object") {
          items.set(payload.item_id, {
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
      publish(event.session_sequence);
      await sessionSyncState.advanceCursor(runtime.runtimeSessionId, event.session_sequence);
    },
  });
}
