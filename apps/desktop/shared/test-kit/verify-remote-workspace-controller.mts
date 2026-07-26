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
          if (path.startsWith("/v1/threads?")) return { data: [{ thread_id: "thread-1", name: "Remote task", updated_at: "2026-07-22T00:00:00.000Z", message_count: 3 }] } as T;
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
  const threads = await controller.listThreads(first.id); assert.equal(threads[0].id, "thread-1"); assert.equal(threads[0].workspacePath, "/srv/project");
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
  await assert.rejects(() => controller.previewFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/../secret" }), /stay inside/i);
  assert.equal(controller.resolvePathTarget("/srv/project/src"), "remote_online");

  runtimeId = "runtime-b"; instanceId = "instance-b"; const restarted = await controller.status(first.id); assert.equal(restarted.runtimeId, "runtime-b"); assert.equal(restarted.instanceId, "instance-b"); assert(statuses.some((item) => item.instanceId === "instance-b"));
  assert.equal(await controller.disconnect(first.id), true); assert.equal(closes, 1); assert.equal(await controller.disconnect(first.id), false);
  assert.equal(controller.getAccess("/srv/project", first.id), null); assert.equal(await controller.resolveTarget("/srv/project", first.id), "remote_offline");
  await assert.rejects(() => controller.listThreads(first.id), /not connected/i); await assert.rejects(() => controller.listWorkers(first.id), /not connected/i);
  await assert.rejects(() => controller.previewFile({ workspacePath: "/srv/project", workspaceId: first.id, path: "/srv/project/src/main.ts" }), /not connected/i);
  await assert.rejects(() => controller.connect({ hostAlias: "../bad", path: "/srv/project" }), /alias is invalid/i);
  const second = await controller.connect({ hostAlias: "beta", path: "/srv/other" }); assert.equal(second.id, "remote-workspace-1"); await controller.shutdown(); assert.equal(closes, 2);
  console.log("Remote Workspace lifecycle, file/Git routing, conflict protection and disconnect invalidation passed.");
} finally { await rm(root, { recursive: true, force: true }); }
