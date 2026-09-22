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

/**
 * Settle the tail turn of a stored snapshot once the catalog says its Session
 * is no longer running. A conversation that finished while the user was
 * reading another one never receives its terminal chat event (the renderer
 * queues events for non-active threads), so its cached snapshot keeps the
 * pending flag and the sidebar row would spin forever. The catalog status is
 * the authority here; this only clears the pending markers it contradicts.
 */
export function settleSnapshotForTerminalStatus(
  snapshot: DesktopThreadSnapshot,
  status: "idle" | "error",
): DesktopThreadSnapshot | null {
  if (!snapshotIsRunning(snapshot) && pendingInteraction(snapshot) === null) return null;
  const messages = [...snapshot.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (!messageIsPending(message) && !message.inputRequest) continue;
    const turn = message.structuredTurn;
    messages[index] = {
      ...message,
      streaming: false,
      inputRequest: undefined,
      ...(turn && isPendingStatus(turn.status)
        ? { structuredTurn: { ...turn, status: status === "error" ? "error" : "completed" } }
        : {}),
    };
  }
  return { ...snapshot, messages };
}

/**
 * Decide whether a catalog row should settle a Session's cached snapshot.
 *
 * A conversation that settled without its terminal chat event reaching the
 * renderer (queued for a non-active thread, or lost to a main-process turn
 * record that outlived the Runtime run) keeps the pending flag and the row
 * spins forever. Only an authoritative terminal broadcast (`settled`) resolves
 * this. A row that merely reports "idle" — the Runtime catalog's default, or a
 * freshly materialized ghost row — must never wipe a still-streaming snapshot,
 * or leaving a Session would drop its live progress indicator.
 *
 * The active Session is settled too: a `settled` row is emitted from the turn's
 * own terminal path, so it never races a genuinely running turn, while the
 * snapshot-store write is a no-op unless the cached snapshot is still marked
 * pending. The composer itself is not touched here; the active view clears its
 * running state through the terminal chat event or the recovery path.
 */
export function shouldSettleSnapshotForCatalogEvent(input: {
  settled: boolean | undefined;
  incomingThreadId: string;
  incomingStatus: DesktopThread["status"];
  activeThreadId: string | null;
}): "idle" | "error" | null {
  if (!input.settled) return null;
  if (input.incomingStatus === "idle" || input.incomingStatus === "error") {
    return input.incomingStatus;
  }
  return null;
}

/**
 * Settle the live transcript row for the *active* Session when an
 * authoritative settled catalog row arrives while its terminal chat event is
 * still in flight. `settleSnapshotForTerminalStatus` only writes the snapshot
 * store, and the active sidebar row is instead derived from the adapter's live
 * `chat.messages`; a turn that ended on the Runtime before the renderer
 * applied its own terminal event would otherwise keep that row spinning until
 * the event landed. A no-op while any part is still pending — a genuinely
 * running turn is never settled here.
 */
export function settleLiveMessagesForTerminalStatus(
  messages: DesktopThreadSnapshot["messages"],
  status: "idle" | "error",
): DesktopThreadSnapshot["messages"] | null {
  if (!messages.some(messageIsPending)) return null;
  const synthetic: DesktopThreadSnapshot = {
    threadId: "active",
    title: "",
    messages,
    updatedAt: 0,
    messageCount: messages.length,
  };
  return settleSnapshotForTerminalStatus(synthetic, status)?.messages ?? null;
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
