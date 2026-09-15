import { useEffect, useRef, useState } from "react";
import { boundedProcessWindow } from "./boundedProcessWindow";

/**
 * Paginated state with auto-follow-latest behaviour.
 *
 * When `running` is true and new items arrive (total increases) while the
 * user is already viewing the newest page (within 2 pages of the end), the
 * page automatically advances to show the latest content.  Manual navigation
 * to an earlier page is always respected — the auto-advance only kicks in
 * when the user is already near the tail.
 *
 * When `running` is false the page is merely clamped to the valid range,
 * preserving whatever the user last selected.
 *
 * @param total   Current total number of items.
 * @param pageSize Items per page.
 * @param running Whether the owning turn is still in progress.
 */
export function useFollowLatestPage(total: number, pageSize: number, running: boolean) {
  const [page, setPage] = useState(0);
  const previousTotalRef = useRef(total);

  useEffect(() => {
    const previousTotal = previousTotalRef.current;
    const win = boundedProcessWindow(total, page, pageSize);
    // Follow newly appended items only while the user is already viewing
    // the newest page. Manual navigation to an older page is respected.
    if (running && total > previousTotal && page >= Math.max(0, win.pageCount - 2)) {
      setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
    } else {
      setPage(win.page);
    }
    previousTotalRef.current = total;
  }, [total, page, pageSize, running]);

  return { page, setPage, window: boundedProcessWindow(total, page, pageSize) };
}
