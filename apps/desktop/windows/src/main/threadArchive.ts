import { connectRuntimeClientForWorkspace } from "./runtimeClient";
import { listThreads, updateThread } from "./threads";
import type { DesktopThread, UpdateThreadRequest } from "../shared/desktopApi";

export interface ThreadArchivePort {
  listThreads(): Promise<DesktopThread[]>;
  updateThread(request: UpdateThreadRequest): Promise<DesktopThread>;
  resolveRuntimeSessionId(thread: DesktopThread): Promise<string | undefined>;
  updateRuntimeSession(thread: DesktopThread, sessionId: string, archived: boolean): Promise<void>;
  reportRuntimeSyncFailure(threadId: string, error: unknown): void;
}

const defaultThreadArchivePort: ThreadArchivePort = {
  listThreads,
  updateThread,
  async resolveRuntimeSessionId(thread) {
    if (thread.runtimeSessionId) return thread.runtimeSessionId;
    if (!thread.lastRunId || !thread.workspacePath) return undefined;
    const runtime = await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    );
    return (await runtime.client.getAgentRun(thread.lastRunId)).session_id;
  },
  async updateRuntimeSession(thread, sessionId, archived) {
    if (!thread.workspacePath) return;
    const runtime = await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    );
    await runtime.client.updateSession(sessionId, { archived });
  },
  reportRuntimeSyncFailure(threadId, error) {
    console.warn(`[thread-archive] Runtime sync failed for ${threadId}; desktop state was preserved.`, error);
  },
};

/**
 * Desktop archive state is authoritative for the sidebar. Runtime propagation is
 * best-effort because platform threads and legacy threads may not have a local
 * Runtime Session.
 */
export async function setThreadArchivedWithPort(
  port: ThreadArchivePort,
  threadId: string,
  archived: boolean,
): Promise<DesktopThread> {
  const thread = (await port.listThreads()).find((item) => item.id === threadId);
  if (!thread) throw new Error("Thread no longer exists.");
  if (thread.status === "running") throw new Error("A running thread cannot be archived.");

  let updated = await port.updateThread({
    id: thread.id,
    archived,
    archiveSource: thread.boundAgentId === "my-codex" ? "codex" : "opendrsai",
  });

  try {
    const runtimeSessionId = await port.resolveRuntimeSessionId(thread);
    if (!runtimeSessionId) return updated;
    if (runtimeSessionId !== updated.runtimeSessionId) {
      updated = await port.updateThread({ id: thread.id, runtimeSessionId });
    }
    await port.updateRuntimeSession(updated, runtimeSessionId, archived);
  } catch (error) {
    port.reportRuntimeSyncFailure(thread.id, error);
  }
  return updated;
}

export function setThreadArchived(threadId: string, archived: boolean): Promise<DesktopThread> {
  return setThreadArchivedWithPort(defaultThreadArchivePort, threadId, archived);
}
