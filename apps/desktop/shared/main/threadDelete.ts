import { RemoteProtocolError } from "../api/remoteSshProtocol";
import type { DesktopThread } from "../api/desktopApi";
import { runtimeSessionIdForLookup } from "../api/threadSidebarCatalog";
import { connectRuntimeClientForWorkspace, isLocalRuntimeUnavailableError } from "./runtimeClient";
import { deleteThread, listThreads } from "./threads";

export interface ThreadDeletePort {
  listThreads(): Promise<DesktopThread[]>;
  deleteThread(threadId: string): Promise<boolean>;
  resolveRuntimeSessionIds(thread: DesktopThread): Promise<string[]>;
  removeRuntimeSession(thread: DesktopThread, sessionId: string): Promise<void>;
}

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

function uniqueSessionIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function requiresRemoteRemoval(thread: DesktopThread): boolean {
  return Boolean(runtimeSessionIdForLookup(thread) || thread.id.startsWith("session-") || thread.lastRunId);
}

export function catalogSessionIdsForDelete(thread: DesktopThread): string[] {
  return uniqueSessionIds([
    runtimeSessionIdForLookup(thread),
    thread.id.startsWith("session-") ? thread.id : undefined,
  ]);
}

const defaultThreadDeletePort: ThreadDeletePort = {
  listThreads,
  deleteThread,
  async resolveRuntimeSessionIds(thread) {
    const ids = catalogSessionIdsForDelete(thread);
    if (runtimeSessionIdForLookup(thread) || !thread.lastRunId || !thread.workspacePath) return ids;
    try {
      const runtime = await connectRuntimeClientForWorkspace(
        thread.workspacePath,
        thread.execution?.workspaceId,
      );
      const sessionId = (await runtime.client.getAgentRun(thread.lastRunId)).session_id;
      return uniqueSessionIds([...ids, sessionId]);
    } catch (error) {
      if (isMissingRuntimeBindingError(error)) return ids;
      throw error;
    }
  },
  async removeRuntimeSession(thread, sessionId) {
    if (!thread.workspacePath) return;
    const runtime = await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    );
    try {
      await runtime.client.updateSession(sessionId, { lifecycle: "removed" });
    } catch (error) {
      if (isMissingRuntimeBindingError(error)) return;
      throw error;
    }
  },
};

function remoteDeleteFailedError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `The remote Runtime session could not be deleted, so the local conversation was left unchanged. ${detail}`,
    { cause: error },
  );
}

export async function deleteThreadAndRuntimeSessionWithPort(
  port: ThreadDeletePort,
  threadId: string,
): Promise<boolean> {
  const catalog = await port.listThreads();
  const thread = catalog.find((item) => item.id === threadId)
    ?? catalog.find((item) => item.runtimeSessionId === threadId);
  if (!thread) return port.deleteThread(threadId);

  let sessionIds: string[];
  try {
    sessionIds = await port.resolveRuntimeSessionIds(thread);
  } catch (error) {
    if (isMissingRuntimeBindingError(error)) {
      sessionIds = catalogSessionIdsForDelete(thread);
    } else if (isLocalRuntimeUnavailableError(error) && !requiresRemoteRemoval(thread)) {
      return port.deleteThread(threadId);
    } else {
      throw remoteDeleteFailedError(error);
    }
  }

  for (const sessionId of sessionIds) {
    try {
      await port.removeRuntimeSession(thread, sessionId);
    } catch (error) {
      if (isMissingRuntimeBindingError(error)) continue;
      if (isLocalRuntimeUnavailableError(error) && !requiresRemoteRemoval(thread)) continue;
      throw remoteDeleteFailedError(error);
    }
  }

  return port.deleteThread(threadId);
}

export function deleteThreadAndRuntimeSession(threadId: string): Promise<boolean> {
  return deleteThreadAndRuntimeSessionWithPort(defaultThreadDeletePort, threadId);
}
