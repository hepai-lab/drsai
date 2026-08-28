import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = await mkdtemp(join(tmpdir(), "opendrsai-workspace-domain-"));
try {
  const bundle = join(temp, "workspaceDomain.mjs");
  await build({ entryPoints: [join(app, "../shared/api/workspaceDomain.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { toRuntimeWorkspaceDomain, toWorkspaceExecutionTarget } = await import(pathToFileURL(bundle).href);
  const common = { name: "project", path: "/project", type: "local", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", lastOpenedAt: "2026-01-02T00:00:00Z", trusted: true };
  const local = toRuntimeWorkspaceDomain({ ...common, id: "workspace-local", location: "local" });
  const remote = toRuntimeWorkspaceDomain({ ...common, id: "legacy-id", type: "remote-ssh", location: "remote", transport: "ssh", remote: { hostAlias: "host-a", canonicalPath: "/project", workspaceId: "workspace-remote", runtimeId: "runtime-a", instanceId: "instance-a", connectionState: "connected" } });
  assert.deepEqual(Object.keys(local), Object.keys(remote));
  const withoutConnection = (value) => { const { connection, ...domain } = value; return domain; };
  assert.deepEqual(Object.keys(withoutConnection(local)), Object.keys(withoutConnection(remote)));
  assert.equal(remote.workspaceId, "workspace-remote");
  assert.equal(local.workspaceId, "workspace-local");
  assert.deepEqual(local.connection, { location: "local", transport: "in-process" });
  assert.equal(remote.connection.runtimeId, "runtime-a");
  const openDrSaiTarget = toWorkspaceExecutionTarget({ ...common, id: "workspace-local", location: "local" }, { backendId: "opendrsai", backendVersion: "1" });
  const codexTarget = toWorkspaceExecutionTarget({ ...common, id: "workspace-local", location: "local" }, { backendId: "codex", backendVersion: "0.142.5" });
  assert.deepEqual(openDrSaiTarget.workspace, codexTarget.workspace);
  assert.deepEqual(Object.keys(openDrSaiTarget), Object.keys(codexTarget));
  assert.notEqual(openDrSaiTarget.agentBackend.backendId, codexTarget.agentBackend.backendId);
  console.log("Local and Remote Workspace unified domain-schema verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
