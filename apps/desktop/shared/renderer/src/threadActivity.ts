import type {
  DesktopBackgroundTask,
  DesktopThread,
  DesktopThreadSnapshot,
} from "@shared/desktopApi";

export type ThreadActivityState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error" }
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

type SnapshotStructuredParts =
  NonNullable<DesktopThreadSnapshot["messages"][number]["structuredTurn"]>["parts"];

// `?? []` would allocate a fresh array for every message on every frame, and
// the sidebar re-derives activity on every frame while an answer streams.
const NO_STRUCTURED_PARTS: SnapshotStructuredParts = [];

function pendingInteraction(
  snapshot?: DesktopThreadSnapshot,
): "approval" | "interaction" | null {
  if (!snapshot) return null;
  for (let messageIndex = snapshot.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = snapshot.messages[messageIndex];
    const structuredTurn = message.structuredTurn;
    // A terminal structured turn is authoritative. A renderer can briefly
    // retain an older pending interaction part while the terminal OAEP event
    // and the catalog update cross process boundaries; that stale child must
    // not keep the sidebar in an attention state after the Run completed.
    const structuredParts = isPendingStatus(structuredTurn?.status)
      ? structuredTurn?.parts ?? NO_STRUCTURED_PARTS
      : NO_STRUCTURED_PARTS;
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

function messageIsPending(message: DesktopThreadSnapshot["messages"][number]): boolean {
  return message.structuredTurn
    ? isPendingStatus(message.structuredTurn.status)
    : Boolean(message.streaming);
}

function snapshotIsRunning(snapshot?: DesktopThreadSnapshot): boolean {
  if (!snapshot) return false;
  // A run is always at the tail of the conversation, and the sidebar derives
  // activity once per animation frame while an answer streams. Scanning from
  // the end keeps that derivation O(1) on the streaming path instead of
  // walking the whole transcript before reaching the one message that can be
  // running.
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message && messageIsPending(message)) return true;
  }
  return false;
}

function assistantMessageFailed(message: DesktopThreadSnapshot["messages"][number]): boolean {
  if (message.error || message.replyFailed) return true;
  const turn = message.structuredTurn;
  if (!turn) return false;
  // Chat sanitizes OAEP `turn.error` to `cancelled` so the bubble is not the
  // "Reply failed" chrome. The visible RuntimeError box is a leftover error
  // notice; treat that as a failed session, not a user abort.
  if (turn.status === "error" || Boolean(turn.error)) return true;
  return turn.parts.some((part) => part.kind === "notice" && part.level === "error");
}

function latestAssistantOutcome(
  snapshot?: DesktopThreadSnapshot,
): "running" | "error" | "ok" | "none" {
  if (!snapshot?.messages.length) return "none";
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message.id === "welcome" || message.role !== "assistant") continue;
    if (message.streaming || isPendingStatus(message.structuredTurn?.status)) return "running";
    if (assistantMessageFailed(message)) return "error";
    return "ok";
  }
  return "none";
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
  const assistantOutcome = latestAssistantOutcome(input.snapshot);
  if (assistantOutcome === "error") return { kind: "error" };
  if (assistantOutcome === "ok") return { kind: "idle" };
  if (input.thread.status === "error" || input.backgroundTask?.status === "failed") {
    return { kind: "error" };
  }
  return { kind: "idle" };
}

export function deriveThreadCatalogStatus(snapshot?: DesktopThreadSnapshot): DesktopThread["status"] {
  const activity = deriveThreadActivity({
    thread: {
      id: snapshot?.threadId || "catalog",
      kind: "chat",
      title: snapshot?.title || "",
      createdAt: "",
      updatedAt: "",
      status: "idle",
    },
    snapshot,
  });
  if (activity.kind === "running" || activity.kind === "attention") return "running";
  if (activity.kind === "error") return "error";
  return "idle";
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
