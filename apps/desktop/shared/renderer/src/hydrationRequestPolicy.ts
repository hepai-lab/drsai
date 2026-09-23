import type { DesktopThreadSnapshotRequest } from "../../api/desktopApi";

/** Reuse only an in-flight read that can satisfy the entire requested contract. */
export function hydrationRequestCovers(active: DesktopThreadSnapshotRequest, requested: DesktopThreadSnapshotRequest): boolean {
  return active.historyCursor === requested.historyCursor
    && active.oaepHistoryCursor === requested.oaepHistoryCursor
    && (!requested.forceFresh || active.forceFresh === true)
    && (requested.minimumSequence === undefined || (active.minimumSequence !== undefined && active.minimumSequence >= requested.minimumSequence))
    && (requested.expectedGeneration === undefined || (active.expectedGeneration !== undefined && active.expectedGeneration >= requested.expectedGeneration));
}
