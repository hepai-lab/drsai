import assert from "node:assert/strict";
import type { DesktopThread, UpdateThreadRequest } from "../../shared/api/desktopApi";
import {
  setThreadArchivedWithPort,
  type ThreadArchivePort,
} from "../src/main/threadArchive.ts";

function createThread(overrides: Partial<DesktopThread> = {}): DesktopThread {
  return {
    id: "thread-test",
    kind: "chat",
    title: "Archive test",
    workspacePath: "C:\\workspace",
    boundAgentId: "my-drsai",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    status: "idle",
    messageCount: 2,
    ...overrides,
  };
}

function createPort(
  initial: DesktopThread,
  options: {
    resolvedSessionId?: string;
    resolveError?: Error;
    updateRuntimeError?: Error;
  } = {},
): ThreadArchivePort & {
  current: DesktopThread;
  runtimeUpdates: Array<{ sessionId: string; archived: boolean }>;
  failures: unknown[];
} {
  const port = {
    current: initial,
    runtimeUpdates: [] as Array<{ sessionId: string; archived: boolean }>,
    failures: [] as unknown[],
    async listThreads() {
      return [port.current];
    },
    async updateThread(request: UpdateThreadRequest) {
      port.current = {
        ...port.current,
        ...request,
        archivedAt: request.archived === true
          ? "2026-07-29T01:00:00.000Z"
          : request.archived === false
            ? undefined
            : port.current.archivedAt,
        archiveSource: request.archived === false
          ? undefined
          : request.archiveSource ?? port.current.archiveSource,
      };
      return port.current;
    },
    async resolveRuntimeSessionId() {
      if (options.resolveError) throw options.resolveError;
      return options.resolvedSessionId;
    },
    async updateRuntimeSession(_thread: DesktopThread, sessionId: string, archived: boolean) {
      port.runtimeUpdates.push({ sessionId, archived });
      if (options.updateRuntimeError) throw options.updateRuntimeError;
    },
    reportRuntimeSyncFailure(_threadId: string, error: unknown) {
      port.failures.push(error);
    },
  };
  return port;
}

{
  const port = createPort(createThread());
  const archived = await setThreadArchivedWithPort(port, "thread-test", true);
  assert.equal(archived.archived, true);
  assert.equal(archived.archiveSource, "opendrsai");
  assert.deepEqual(port.runtimeUpdates, []);
}

{
  const failure = new Error("platform run is not a local Runtime run");
  const port = createPort(createThread({ lastRunId: "cloud-run" }), { resolveError: failure });
  const archived = await setThreadArchivedWithPort(port, "thread-test", true);
  assert.equal(archived.archived, true);
  assert.deepEqual(port.failures, [failure]);
}

{
  const failure = new Error("Runtime temporarily unavailable");
  const port = createPort(
    createThread({ runtimeSessionId: "session-test", boundAgentId: "my-codex" }),
    { resolvedSessionId: "session-test", updateRuntimeError: failure },
  );
  await assert.rejects(setThreadArchivedWithPort(port, "thread-test", true), /Nothing changed; retry/);
  assert.equal(port.current.archived, false);
  assert.deepEqual(port.runtimeUpdates, [{ sessionId: "session-test", archived: true }]);
  assert.deepEqual(port.failures, [failure]);
}

{
  const port = createPort(
    createThread({
      archived: true,
      archivedAt: "2026-07-29T00:30:00.000Z",
      archiveSource: "codex",
      boundAgentId: "my-codex",
      runtimeSessionId: "session-test",
    }),
    { resolvedSessionId: "session-test" },
  );
  const restored = await setThreadArchivedWithPort(port, "thread-test", false);
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.archiveSource, undefined);
  assert.deepEqual(port.runtimeUpdates, [{ sessionId: "session-test", archived: false }]);
}

{
  const port = createPort(createThread({ status: "running" }));
  await assert.rejects(
    setThreadArchivedWithPort(port, "thread-test", true),
    /running thread cannot be archived/i,
  );
  assert.equal(port.current.archived, undefined);
}

process.stdout.write("Thread archive behavior verification passed (5 checks).\n");
