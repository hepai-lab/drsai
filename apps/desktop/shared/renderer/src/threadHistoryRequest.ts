import type { DesktopThreadHistoryState, DesktopThreadSnapshotRequest } from "../../api/desktopApi";

/** Consume already-persisted OAEP pages before importing another backend page. */
export function earlierHistoryRequest(history?: DesktopThreadHistoryState): DesktopThreadSnapshotRequest | undefined {
  if (history?.oaepNextCursor) return { forceFresh: true, oaepHistoryCursor: history.oaepNextCursor };
  if (history?.nextCursor) return { forceFresh: true, historyCursor: history.nextCursor };
  return undefined;
}
