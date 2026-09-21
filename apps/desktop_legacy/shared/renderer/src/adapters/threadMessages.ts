import type { DesktopThreadSnapshot } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";

/**
 * Renderer-side funnel for opening a conversation's messages.
 * IPC still hits getThreadSnapshot today; main's loadThreadMessages is the
 * swap point when gateway history lands.
 */
export async function loadThreadMessages(
  threadId: string,
): Promise<DesktopThreadSnapshot | null> {
  return desktopApi.getThreadSnapshot(threadId);
}
