import type {
  DesktopBackgroundTask,
  DesktopThread,
  DesktopThreadSnapshot,
} from "@shared/desktopApi";

export type ThreadActivityState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "attention"; reason: "approval" | "interaction" };

const TASK_PRIORITY: Record<DesktopBackgroundTask["status"], number> = {
  waiting_approval: 4,
  running: 3,
  queued: 2,
  blocked: 1,
  completed: 0,
  failed: 0,
  cancelled: 0,
};

function isPendingStatus(status: unknown): boolean {
  return status === "pending" || status === "running";
}

function pendingInteraction(
  snapshot?: DesktopThreadSnapshot,
): "approval" | "interaction" | null {
  if (!snapshot) return null;
  for (let messageIndex = snapshot.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = snapshot.messages[messageIndex];
    const structuredParts = message.structuredTurn?.parts ?? [];
    for (let partIndex = structuredParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = structuredParts[partIndex];
      if (part.kind !== "interaction" || !isPendingStatus(part.status) || part.response) continue;
      return part.interactionType === "approval" ? "approval" : "interaction";
    }
    if (message.inputRequest) {
      return message.inputRequest.inputType === "approval" ? "approval" : "interaction";
    }
  }
  return null;
}

function snapshotIsRunning(snapshot?: DesktopThreadSnapshot): boolean {
  return Boolean(snapshot?.messages.some((message) =>
    message.streaming
    || isPendingStatus(message.structuredTurn?.status),
  ));
}

function taskNeedsApproval(task?: DesktopBackgroundTask): boolean {
  return Boolean(
    task
    && (
      task.status === "waiting_approval"
      || task.approvalId
      || (task.pendingDecisions?.length ?? 0) > 0
    ),
  );
}

export function deriveThreadActivity(input: {
  thread: DesktopThread;
  snapshot?: DesktopThreadSnapshot;
  backgroundTask?: DesktopBackgroundTask;
}): ThreadActivityState {
  const interaction = pendingInteraction(input.snapshot);
  if (taskNeedsApproval(input.backgroundTask) || interaction === "approval") {
    return { kind: "attention", reason: "approval" };
  }
  if (interaction === "interaction") {
    return { kind: "attention", reason: "interaction" };
  }
  if (
    input.thread.status === "running"
    || snapshotIsRunning(input.snapshot)
    || input.backgroundTask?.status === "running"
  ) {
    return { kind: "running" };
  }
  return { kind: "idle" };
}

function taskWins(candidate: DesktopBackgroundTask, current?: DesktopBackgroundTask): boolean {
  if (!current) return true;
  const priorityDelta = TASK_PRIORITY[candidate.status] - TASK_PRIORITY[current.status];
  if (priorityDelta !== 0) return priorityDelta > 0;
  return candidate.updatedAt > current.updatedAt;
}

export function indexBackgroundTasksByThread(
  threads: DesktopThread[],
  tasks: DesktopBackgroundTask[],
): Map<string, DesktopBackgroundTask> {
  const knownThreadIds = new Set(threads.map((thread) => thread.id));
  const threadIdsByTarget = new Map<string, string>();
  for (const thread of threads) {
    if (thread.lastRequestId) threadIdsByTarget.set(thread.lastRequestId, thread.id);
    if (thread.lastRunId) threadIdsByTarget.set(thread.lastRunId, thread.id);
  }
  const result = new Map<string, DesktopBackgroundTask>();
  for (const task of tasks) {
    const threadId = task.threadId || (task.targetId ? threadIdsByTarget.get(task.targetId) : undefined);
    if (!threadId || !knownThreadIds.has(threadId)) continue;
    if (taskWins(task, result.get(threadId))) result.set(threadId, task);
  }
  return result;
}
