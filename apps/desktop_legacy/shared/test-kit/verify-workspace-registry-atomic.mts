import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-workspace-registry-"));
process.env.DRSAI_HOME = root;
process.env.DRSAI_REPO = "";

try {
  const desktop = join(root, "desktop");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(desktop, { recursive: true }));
  const now = new Date().toISOString();
  const workspace = {
    id: "workspace-atomic-001",
    name: "Atomic remote workspace",
    path: "/srv/opendrsai/atomic-workspace",
    location: "remote",
    type: "remote",
    transport: "ssh",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    trusted: true,
    remote: {
      hostAlias: "atomic-fixture",
      canonicalPath: "/srv/opendrsai/atomic-workspace",
      connectionState: "disconnected",
      autoReconnect: false,
    },
  };
  const registry = join(desktop, "workspaces.json");
  await writeFile(registry, `${JSON.stringify([workspace], null, 2)}\n`, "utf8");
  const { listWorkspaces } = await import("../main/workspaces.ts");
  const results = await Promise.all(Array.from({ length: 100 }, () => listWorkspaces()));
  assert.ok(results.every((items) => items.some((item) => item.id === workspace.id)), "a concurrent reader observed a truncated or empty Workspace registry");
  const persisted = JSON.parse(await readFile(registry, "utf8"));
  assert.ok(Array.isArray(persisted) && persisted.some((item) => item.id === workspace.id), "concurrent refresh lost the registered Workspace");
  console.log("Workspace registry atomic concurrent read/write verification passed (100 readers).");
} finally {
  await rm(root, { recursive: true, force: true });
}
