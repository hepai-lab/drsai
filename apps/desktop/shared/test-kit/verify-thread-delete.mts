import assert from "node:assert/strict";
import type { DesktopThread } from "../api/desktopApi";
import {
  deleteThreadAndRuntimeSessionWithPort,
  type ThreadDeletePort,
} from "../main/threadDelete.ts";

function createThread(overrides: Partial<DesktopThread> = {}): DesktopThread {
  return {
    id: "thread-test",
    kind: "chat",
    title: "Delete test",
    workspacePath: "C:\\workspace",
    boundAgentId: "opendrsai",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    status: "idle",
    messageCount: 2,
    runtimeSessionId: "session-test",
    ...overrides,
  };
}

function createPort(
  initial: DesktopThread | undefined,
  options: {
    resolveError?: Error;
    removeError?: Error;
  } = {},
): ThreadDeletePort & {
  current: DesktopThread | undefined;
  removedSessionIds: string[];
  localDeletes: string[];
} {
  const port = {
    current: initial,
    removedSessionIds: [] as string[],
    localDeletes: [] as string[],
    async listThreads() {
      return port.current ? [port.current] : [];
    },
    async deleteThread(threadId: string) {
      port.localDeletes.push(threadId);
      const existed = port.current?.id === threadId || port.current?.runtimeSessionId === threadId;
      if (existed) port.current = undefined;
      return existed;
    },
    async resolveRuntimeSessionIds(thread: DesktopThread) {
      if (options.resolveError) throw options.resolveError;
      return [thread.runtimeSessionId, thread.id].filter((id): id is string => Boolean(id));
    },
    async removeRuntimeSession(_thread: DesktopThread, sessionId: string) {
      if (options.removeError) throw options.removeError;
      port.removedSessionIds.push(sessionId);
    },
  };
  return port;
}

{
  const port = createPort(createThread());
  assert.equal(await deleteThreadAndRuntimeSessionWithPort(port, "thread-test"), true);
  assert.deepEqual(port.removedSessionIds, ["session-test", "thread-test"]);
  assert.deepEqual(port.localDeletes, ["thread-test"]);
  assert.equal(port.current, undefined);
}

{
  const port = createPort(createThread(), { removeError: new Error("Session not found") });
  assert.equal(await deleteThreadAndRuntimeSessionWithPort(port, "thread-test"), true);
  assert.deepEqual(port.localDeletes, ["thread-test"]);
}

{
  const port = createPort(createThread());
  const failure = new Error("Runtime refused session removal");
  port.removeRuntimeSession = async () => {
    throw failure;
  };
  await assert.rejects(
    deleteThreadAndRuntimeSessionWithPort(port, "thread-test"),
    /remote Runtime session could not be deleted/i,
  );
  assert.deepEqual(port.localDeletes, []);
  assert.equal(port.current?.id, "thread-test");
}

{
  const port = createPort(createThread({ runtimeSessionId: undefined, lastRunId: undefined }));
  assert.equal(await deleteThreadAndRuntimeSessionWithPort(port, "thread-test"), true);
  assert.deepEqual(port.removedSessionIds, ["thread-test"]);
  assert.deepEqual(port.localDeletes, ["thread-test"]);
}

console.log("Thread remote delete verification passed (4 checks).");
