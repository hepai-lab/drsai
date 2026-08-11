import type { DesktopBackgroundTask } from "@shared/desktopApi";

function completedAt(task: DesktopBackgroundTask): number {
  const parsed = Date.parse(task.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Selects newly completed task results for foreground disclosure without
 * reopening historical results every time the desktop app starts.
 */
export class CompletionDeliveryTracker {
  private readonly startedAt: number;
  private readonly seenTaskIds = new Set<string>();
  private initialized = false;

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  observe(tasks: DesktopBackgroundTask[], activeThreadId?: string): DesktopBackgroundTask | null {
    const completed = tasks.filter((task) => task.status === "completed" && task.deliverySummary);
    const unseen = completed.filter((task) => !this.seenTaskIds.has(task.id));
    for (const task of completed) this.seenTaskIds.add(task.id);

    const candidates = this.initialized
      ? unseen
      : unseen.filter((task) => completedAt(task) >= this.startedAt);
    this.initialized = true;

    return candidates.sort((left, right) => {
      const leftActive = Boolean(activeThreadId && left.threadId === activeThreadId);
      const rightActive = Boolean(activeThreadId && right.threadId === activeThreadId);
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      return completedAt(right) - completedAt(left) || left.id.localeCompare(right.id);
    })[0] ?? null;
  }
}
