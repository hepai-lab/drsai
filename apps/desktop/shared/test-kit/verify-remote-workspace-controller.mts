import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-remote-controller-")); process.env.DRSAI_HOME = root;
try {
  const { RemoteGatewayHttpError, RemoteWorkspaceController } = await import("../main/remoteWorkspaceController.ts");
  let opens = 0, closes = 0, runtimeId = "runtime-a", instanceId = "instance-a", conflictNextWrite = false; const requests: Array<{ path: string; init?: RequestInit }> = [];
  const port = {
    async listDirectories(hostAlias: string, path: string) { assert.equal(hostAlias, "alpha"); assert.equal(path, "~/projects"); return [{ name: "demo", path: "/home/tester/projects/demo", directory: true as const, readable: true, writable: false, mode: "0o755" }]; },
    async open(request: { hostAlias: string; path: string }) {
      opens += 1; await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        workspaceId: "remote-workspace-1", canonicalPath: "/srv/project", hostAlias: request.hostAlias, localPort: 43111, baseUrl: "http://127.0.0.1:43111", token: "fixture-token",
        runtimeId, instanceId, gatewayVersion: "2.0.0", protocolVersion: 1, capabilities: { threads: 1, hepai: 1 },
        close: async () => { closes += 1; },
        request: async <T>(path: string, init?: RequestInit): Promise<T> => {
          requests.push({ path, init });
          if (path === "/v1/remote/handshake") return { runtime_id: runtimeId, instance_id: instanceId, gateway_version: "2.0.1", protocol_version: 1, capability_versions: { threads: 1, hepai: 1 } } as T;
          if (path.startsWith("/v1/sessions?")) return { data: [{ session_id: "thread-1", title: "Remote task", created_at: "2026-07-21T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z" }] } as T;
          if (path === "/v1/sessions/thread-1/conversation-snapshot") return { session_id: "thread-1", snapshot_sequence: 2, next_cursor: null, items: [{ item_id: "remote-user", session_id: "thread-1", run_id: null, kind: "message", role: "user", revision: 1, session_sequence: 1, source_client: "runtime", source_message_id: null, created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z", payload: { content: "remote question", status: "completed" } }, { item_id: "remote-assistant", session_id: "thread-1", run_id: "run-1", kind: "message", role: "assistant", revision: 1, session_sequence: 2, source_client: "runtime", source_message_id: null, created_at: "2026-07-22T00:00:01.000Z", updated_at: "2026-07-22T00:00:01.000Z", payload: { content: "remote searchable answer", status: "completed" } }] } as T;
          if (path === "/v1/threads/thread-1") return { name: "Remote task", messages: [{ role: "user", content: "remote question" }, { role: "assistant", content: "remote searchable answer" }] } as T;
          if (path === "/v1/hepai/workers") return { data: [{ id: "worker-1", name: "Worker One", enabled: true, status: "available", callables: ["run"] }] } as T;
          if (path === "/v1/hepai/workers/worker-1/state") return {} as T;
          if (path === "/v1/workspaces/remote-workspace-1/context") return { workspacePath: "/srv/project", trusted: true, instructions: [], stats: { instructionCount: 0, changedFileCount: 1 } } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/files?")) return { data: [{ name: "src", path: "src", directory: true, children: [{ name: "main.ts", path: "src/main.ts", directory: false, size: 12, git_status: "modified" }] }], total: 2, truncated: false } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/file?")) return { path: "src/main.ts", content: "export {};", mime: "text/typescript", size: 10, modified_at: 1, truncated: false } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/folder-summary?")) return { path: "/srv/project/src", name: "src", totalEntries: 1, fileCount: 1, directoryCount: 0, skippedDirectoryCount: 0, importedFileCount: 1, skippedFileCount: 0, failedFileCount: 0, unsupportedExtensions: [], truncated: false, estimatedTokens: 3, sampledFiles: [], summary: "one file" } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/git/diff?")) return { diff: "diff --git a/src/main.ts b/src/main.ts", staged: false } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/git/file-at-ref?")) return { workspacePath: "/srv/project", ref: "HEAD", path: "/srv/project/src/main.ts", content: "old", truncated: false, missing: false, message: "ok" } as T;
          if (path === "/v1/workspaces/remote-workspace-1/file" && init?.method === "PUT") {
            if (conflictNextWrite) { conflictNextWrite = false; throw new RemoteGatewayHttpError(409, { detail: { current_sha256: "b".repeat(64) } }); }
            return { sha256: "a".repeat(64), modified_at: 2, size: 10 } as T;
          }
          if (path === "/v1/workspaces/remote-workspace-1/checkpoints" && !init?.method) return { data: [{ id: "checkpoint-1", workspacePath: "/srv/project", label: "Remote baseline", createdAt: "2026-07-22T00:00:00.000Z", changedFileCount: 1, storedFileCount: 1, skippedFileCount: 0, entries: [] }] } as T;
          if (path === "/v1/workspaces/remote-workspace-1/checkpoints" && init?.method === "POST") return { id: "checkpoint-2", workspacePath: "/srv/project", label: "Created", createdAt: "2026-07-22T00:00:00.000Z", changedFileCount: 1, storedFileCount: 1, skippedFileCount: 0, entries: [] } as T;
          if (path === "/v1/workspaces/remote-workspace-1/checkpoints/preview" && init?.method === "POST") return { workspacePath: "/srv/project", checkpointId: "checkpoint-1", label: "Remote baseline", createdAt: "2026-07-22T00:00:00.000Z", totalEntries: 1, changedEntryCount: 1, skippedEntryCount: 0, truncated: false, entries: [], message: "1 changed" } as T;
          if (path === "/v1/workspaces/remote-workspace-1/checkpoints/restore" && init?.method === "POST") return { workspacePath: "/srv/project", checkpointId: "checkpoint-1", restored: true, restoredFileCount: 1, removedFileCount: 0, skippedFileCount: 0, message: "restored" } as T;
          if (path === "/v1/workspaces/remote-workspace-1/checkpoints/accept" && init?.method === "POST") return { id: "checkpoint-1", workspacePath: "/srv/project", label: "Remote baseline", createdAt: "2026-07-22T00:00:00.000Z", changedFileCount: 1, storedFileCount: 1, skippedFileCount: 0, entries: [], reviewStatus: "accepted" } as T;
          if (path === "/v1/workspaces/remote-workspace-1/worktrees" && init?.method === "POST") return { worktree_id: "worktree-1", workspace_id: "remote-workspace-2", source_workspace_path: "/srv/project", repo_root: "/srv/project", worktree_path: "/srv/.worktrees/task", branch: "codex/task", base_ref: "HEAD", source_has_changes: false } as T;
          if (path.startsWith("/v1/workspaces/remote-workspace-1/git/") && init?.method === "POST") return {} as T;
          throw new Error(`unexpected request ${path}`);
        },
      };
    },
  };
  const controller = new RemoteWorkspaceController(port); const statuses: Array<{ instanceId?: string; connected: boolean }> = []; controller.setPublisher((status) => statuses.push({ instanceId: status.instanceId, connected: status.connected }));
  const [first, duplicate] = await Promise.all([controller.connect({ hostAlias: "alpha", path: "/srv/project", trusted: true }), controller.connect({ hostAlias: "alpha", path: "/srv/project", trusted: true })]);
  assert.equal(first.id, "remote-workspace-1"); assert.equal(duplicate.id, first.id); assert.equal(opens, 1);
  const status = await controller.status(first.id); assert.equal(status.connected, true); assert.equal(status.instanceId, "instance-a");
  const diagnostics = controller.diagnostics(); assert.equal(diagnostics.hosts.length, 1); assert.equal(diagnostics.hosts[0].hostAlias, "alpha"); assert.equal(diagnostics.hosts[0].workspaceCount, 1); assert(diagnostics.hosts[0].ageMs >= 0); assert.equal(diagnostics.hosts[0].events.at(-1)?.phase, "ready");
  assert.deepEqual(controller.getAccess("/srv/project"), { baseUrl: "http://127.0.0.1:43111", token: "fixture-token", workspaceId: first.id });
  assert.equal(await controller.resolveTarget("/srv/project", first.id), "remote_online"); controller.bindThread("bound-thread", first.id);
  const directories = await controller.listDirectories("alpha", "~/projects"); assert.equal(directories[0].name, "demo");
  await assert.rejects(() => controller.listDirectories("../bad", "~"), /alias is invalid/i); await assert.rejects(() => controller.listDirectories("alpha", "bad\npath"), /path is invalid/i);
  const threads = await controller.listThreads(first.id); assert.equal(threads[0].id, "thread-1"); assert.equal(threads[0].workspacePath, "/srv/project"); assert.equal(threads[0].runtimeSessionId, "thread-1");
  const remoteSnapshot = await controller.getThreadSnapshot("thread-1"); assert.equal(remoteSnapshot?.messageCount, 2); assert.equal(remoteSnapshot?.messages[1]?.role, "assistant");
  const remoteSearch = await controller.searchThreadMessages({ query: "searchable", threadIds: ["thread-1"], limit: 5 }); assert.equal(remoteSearch.length, 1); assert.match(remoteSearch[0].snippet, /searchable answer/);
  assert.deepEqual(await controller.searchThreadMessages({ query: "missing", threadIds: ["thread-1"] }), []);
  const workers = await controller.listWorkers(first.id); assert.equal(workers[0].status, "available");
  assert.equal(await controller.setWorkerState(first.id, "worker-1", false), true);
  const update = requests.find((request) => request.path.endsWith("worker-1/state")); assert.equal(update?.init?.method, "PUT"); assert.equal(update?.init?.body, JSON.stringify({ enabled: false }));
  await assert.rejects(() => controller.setWorkerState(first.id, "../bad", true), /worker id is invalid/i);

  assert.equal((await controller.contextOverview("/srv/project", first.id)).trusted, true);
  const tree = await controller.listFiles({ workspacePath: "/srv/project", workspaceId: first.id }); assert.equal(tree.nodes[0].children?.[0].relativePath, "src/main.ts");
  const preview = await controller.previewFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts" }); assert.equal(preview.content, "export {};");
  assert.equal((await controller.folderSummary({ path: "/srv/project/src" })).summary, "one file");
  const diff = await controller.gitDiff({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts" }); assert.equal(diff.diffHash?.length, 64);
  assert.equal((await controller.gitFileAtRef({ workspacePath: "/srv/project", workspaceId: first.id, ref: "HEAD", path: "/srv/project/src/main.ts" })).content, "old");
  const saved = await controller.writeFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts", content: "export {};", expectedHash: "0".repeat(64) }); assert.equal(saved.status, "saved");
  conflictNextWrite = true; const conflicted = await controller.writeFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts", content: "changed", expectedHash: "0".repeat(64) }); assert.equal(conflicted.status, "conflict"); assert.equal(conflicted.currentHash, "b".repeat(64));
  const expectedDiffHash = "c".repeat(64); assert.equal((await controller.mutateGit("stage-file", { workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts", expectedDiffHash }) as { staged: boolean }).staged, true);
  assert.equal((await controller.mutateGit("revert-hunk", { workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts", expectedDiffHash, patch: "@@" }) as { applied: boolean }).applied, true);
  assert.equal(await controller.commitGit({ workspacePath: "/srv/project", message: "Remote commit", body: "Reviewed" }, "approval:remote-1"), true);
  const commitRequest = requests.find((request) => request.path.endsWith("/git/commit")); assert.equal(commitRequest?.init?.method, "POST"); assert.deepEqual(JSON.parse(String(commitRequest?.init?.body)), { message: "Remote commit", body: "Reviewed", idempotency_key: "approval:remote-1" });
  assert.equal((await controller.listCheckpoints("/srv/project", first.id))[0].id, "checkpoint-1");
  assert.equal((await controller.createCheckpoint({ workspacePath: "/srv/project", workspaceId: first.id, label: "Created" })).id, "checkpoint-2");
  assert.equal((await controller.previewCheckpoint({ workspacePath: "/srv/project", workspaceId: first.id, checkpointId: "checkpoint-1" })).changedEntryCount, 1);
  assert.equal((await controller.restoreCheckpoint({ workspacePath: "/srv/project", workspaceId: first.id, checkpointId: "checkpoint-1" })).restored, true);
  assert.equal((await controller.acceptCheckpoint({ workspacePath: "/srv/project", workspaceId: first.id, checkpointId: "checkpoint-1" })).reviewStatus, "accepted");
  const remoteWorktree = await controller.prepareForkWorktree("/srv/project", "test task", first.id); assert.equal(remoteWorktree.location, "remote"); assert.equal(remoteWorktree.workspaceId, "remote-workspace-2"); assert.equal(controller.resolvePathTarget("/srv/.worktrees/task/src"), "remote_online");
  await assert.rejects(() => controller.previewFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/../secret" }), /stay inside/i);
  assert.equal(controller.resolvePathTarget("/srv/project/src"), "remote_online");

  runtimeId = "runtime-b"; instanceId = "instance-b"; const restarted = await controller.status(first.id); assert.equal(restarted.runtimeId, "runtime-b"); assert.equal(restarted.instanceId, "instance-b"); assert(statuses.some((item) => item.instanceId === "instance-b"));
  assert.equal(await controller.disconnect(first.id), true); assert.equal(closes, 1); assert.equal(await controller.disconnect(first.id), false);
  assert.equal(controller.getAccess("/srv/project", first.id), null); assert.equal(await controller.resolveTarget("/srv/project", first.id), "remote_offline");
  assert.equal(controller.getAccess("/srv/.worktrees/task", "remote-workspace-2"), null); assert.equal(controller.resolvePathTarget("/srv/.worktrees/task/src"), "local_or_unknown");
  await assert.rejects(() => controller.listThreads(first.id), /not connected/i); await assert.rejects(() => controller.listWorkers(first.id), /not connected/i);
  await assert.rejects(() => controller.previewFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts" }), /not connected/i);
  await assert.rejects(() => controller.connect({ hostAlias: "../bad", path: "/srv/project" }), /alias is invalid/i);
  const second = await controller.connect({ hostAlias: "beta", path: "/srv/other" }); assert.equal(second.id, "remote-workspace-1"); await controller.shutdown(); assert.equal(closes, 2);

  const originalWebSocket = globalThis.WebSocket;
  class FixtureWebSocket {
    static instances: FixtureWebSocket[] = [];
    readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>(); sent: string[] = []; closed = false;
    constructor(readonly url: string) { FixtureWebSocket.instances.push(this); }
    addEventListener(name: string, listener: (event: { data?: string }) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
    send(value: string) { this.sent.push(value); }
    close() { this.closed = true; this.emit("close", {}); }
    emit(name: string, event: { data?: string }) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  }
  globalThis.WebSocket = FixtureWebSocket as unknown as typeof WebSocket;
  try {
    const watcherController = new RemoteWorkspaceController(port); const changes: Array<{ workspacePath: string; changes: Array<{ path: string }> }> = [];
    watcherController.setFilePublisher((event) => changes.push(event));
    const watched = await watcherController.connect({ hostAlias: "watcher", path: "/srv/project" }); const socket = FixtureWebSocket.instances.at(-1)!;
    assert.match(socket.url, /\/v1\/workspaces\/remote-workspace-1\/watch$/); socket.emit("open", {}); assert.match(socket.sent[0], /"type":"auth"/); assert.doesNotMatch(socket.sent[0], /undefined/);
    socket.emit("message", { data: JSON.stringify({ type: "changes", sequence: 1, changes: [{ sequence: 1, path: "src/main.ts", type: "modified" }] }) });
    socket.emit("message", { data: JSON.stringify({ type: "changes", sequence: 1, changes: [{ sequence: 1, path: "src/main.ts", type: "modified" }] }) });
    assert.equal(changes.length, 1); assert.equal(changes[0].workspacePath, "/srv/project"); assert.equal(changes[0].changes[0].path, "src/main.ts");
    await watcherController.disconnect(watched.id); assert.equal(socket.closed, true);
  } finally { globalThis.WebSocket = originalWebSocket; }

  const persistedSeed = new RemoteWorkspaceController(port); await persistedSeed.connect({ hostAlias: "restore", path: "/srv/project", name: "Restore me" }); await persistedSeed.shutdown();
  const restoredController = new RemoteWorkspaceController(port); const restored = await restoredController.restorePersisted(); assert.equal(restored.restored, 1); assert.equal(restored.failed, 0); await restoredController.shutdown();
  let releaseSlowOpen!: () => void; const slowGate = new Promise<void>((resolve) => { releaseSlowOpen = resolve; }); let slowClosed = 0;
  const slowController = new RemoteWorkspaceController({ async open(request) { await slowGate; const opened = await port.open(request); return { ...opened, close: async () => { slowClosed += 1; await opened.close(); } }; } });
  const slowConnect = slowController.connect({ hostAlias: "slow", path: "/srv/project" }); await new Promise((resolve) => setTimeout(resolve, 0)); const slowShutdown = slowController.shutdown(); releaseSlowOpen();
  await assert.rejects(slowConnect, /shut down while connecting/i); await slowShutdown; assert.equal(slowClosed, 1); await assert.rejects(() => slowController.connect({ hostAlias: "slow", path: "/srv/project" }), /shutting down/i);
  console.log("Remote Workspace lifecycle, remote Thread search, file events, startup restoration, file/Git/checkpoint/worktree routing and disconnect invalidation passed.");
} finally { await rm(root, { recursive: true, force: true }); }
