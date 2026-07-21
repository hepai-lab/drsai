import { connectRuntimeClientForWorkspace } from "./runtimeClient";
import { listThreads, updateThread } from "./threads";
import type { DesktopThread } from "../shared/desktopApi";

/** Keeps Runtime and Desktop archive state atomic from the user's perspective. */
export async function setThreadArchived(threadId: string, archived: boolean): Promise<DesktopThread> {
  const thread = (await listThreads()).find((item) => item.id === threadId);
  if (!thread) throw new Error("Thread no longer exists.");
  if (thread.status === "running") throw new Error("A running thread cannot be archived.");
  let runtimeSessionId = thread.runtimeSessionId;
  if (!runtimeSessionId && thread.lastRunId && thread.workspacePath) {
    const runtime = await connectRuntimeClientForWorkspace(thread.workspacePath, thread.execution?.workspaceId);
    runtimeSessionId = (await runtime.client.getAgentRun(thread.lastRunId)).session_id;
  }
  if (runtimeSessionId && thread.workspacePath) {
    const runtime = await connectRuntimeClientForWorkspace(thread.workspacePath, thread.execution?.workspaceId);
    await runtime.client.updateSession(runtimeSessionId, { archived });
  }
  return updateThread({
    id: thread.id,
    archived,
    runtimeSessionId,
    archiveSource: thread.boundAgentId === "my-codex" ? "codex" : "opendrsai",
  });
}
