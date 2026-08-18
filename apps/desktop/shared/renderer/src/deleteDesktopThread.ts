import { desktopApi, hasDesktopApi } from "./desktopApi";

/** Persistently remove a conversation locally and on Runtime. Throws with a concrete message on failure. */
export async function deleteDesktopThread(threadId: string): Promise<void> {
  if (!threadId.trim()) {
    throw new Error("Conversation id is empty.");
  }
  if (!hasDesktopApi()) {
    throw new Error("OpenDrSai desktop bridge is unavailable.");
  }
  const api = window.openDrSai;
  if (!api || typeof api.deleteThread !== "function") {
    throw new Error("desktopApi.deleteThread is unavailable in this session.");
  }
  const removed = await api.deleteThread(threadId);
  if (removed) return;
  const listed = typeof api.listThreads === "function" ? await api.listThreads() : [];
  if (listed.some((thread) => thread.id === threadId)) {
    throw new Error(`Delete did not remove thread ${threadId} from the local catalog.`);
  }
}
