import { RemoteProtocolError } from "../../../shared/api/remoteSshProtocol";
import { runtimeSessionIdForLookup } from "../../../shared/api/threadSidebarCatalog";
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

/**
 * Missing run/session bindings are expected for legacy, platform, or restarted
 * local history. Archive must treat them as "nothing to sync", not as failures.
 */
export function isMissingRuntimeBindingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (
    message.includes("run not found")
    || message.includes("session not found")
    || message.includes("run was not found")
    || message.includes("session was not found")
  ) {
    return true;
  }
  if (error instanceof RemoteProtocolError) {
    if (error.status === 404) return true;
    const code = error.code.toLowerCase();
    return code === "run_not_found"
      || code === "session_not_found"
      || code === "http_404"
      || code.endsWith("_not_found");
  }
  return false;
}

const defaultThreadArchivePort: ThreadArchivePort = {
  listThreads,
  updateThread,
  async resolveRuntimeSessionId(thread) {
    const boundSessionId = runtimeSessionIdForLookup(thread);
    if (boundSessionId) return boundSessionId;
    if (!thread.lastRunId || !thread.workspacePath) return undefined;
    const runtime = await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    );
    try {
      return (await runtime.client.getAgentRun(thread.lastRunId)).session_id;
    } catch (error) {
      // Same recovery pattern as chat.ts: stale lastRunId must not block archive.
      if (isMissingRuntimeBindingError(error)) return undefined;
      throw error;
    }
  },
  async updateRuntimeSession(thread, sessionId, archived) {
    if (!thread.workspacePath) return;
    const runtime = await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    );
    try {
      await runtime.client.updateSession(sessionId, { archived });
    } catch (error) {
      if (isMissingRuntimeBindingError(error)) return;
      throw error;
    }
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
    // Missing run/session bindings are expected for legacy/platform history.
    if (isMissingRuntimeBindingError(error)) return updated;
    port.reportRuntimeSyncFailure(thread.id, error);
    if (thread.boundAgentId === "my-codex" || thread.archiveSource === "codex") {
      await port.updateThread({
        id: thread.id,
        archived: Boolean(thread.archived),
        archiveSource: thread.archived ? "codex" : undefined,
      });
      throw new Error(
        archived
          ? "Codex could not archive this session. Nothing changed; retry when Codex is available."
          : "Codex could not restore this session. Nothing changed; retry when Codex is available.",
        { cause: error },
      );
    }
  }
  return updated;
}

export function setThreadArchived(threadId: string, archived: boolean): Promise<DesktopThread> {
  return setThreadArchivedWithPort(defaultThreadArchivePort, threadId, archived);
}
