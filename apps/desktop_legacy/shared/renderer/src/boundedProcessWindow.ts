export const PROCESS_ACTIVITY_WINDOW_SIZE = 16;
export const PROCESS_PART_WINDOW_SIZE = 8;

export interface BoundedProcessWindow {
  page: number;
  pageCount: number;
  start: number;
  end: number;
}

export function boundedProcessWindow(total: number, requestedPage: number, pageSize: number): BoundedProcessWindow {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const page = Math.min(pageCount - 1, Math.max(0, Math.floor(requestedPage)));
  const start = page * safeSize;
  return { page, pageCount, start, end: Math.min(safeTotal, start + safeSize) };
}
