import type { DesktopThreadSnapshot } from "../shared/desktopApi";
import { getThreadSnapshot } from "./threads";

/**
 * Single funnel for loading a thread's messages into the chat UI.
 *
 * Today: local thread-snapshots.json via getThreadSnapshot.
 * Later: swap body to gateway GET /v1/threads/{id} (see getRemoteThreadSnapshot)
 * without chasing call sites across App / chat adapter.
 */
export async function loadThreadMessages(
  threadId: unknown,
): Promise<DesktopThreadSnapshot | null> {
  return getThreadSnapshot(threadId);
}
