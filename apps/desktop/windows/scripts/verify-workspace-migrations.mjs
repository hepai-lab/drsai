import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const temp = await mkdtemp(join(tmpdir(), "opendrsai-workspace-migration-"));
try {
  const bundle = join(temp, "workspaceMigrations.mjs");
  await build({ entryPoints: [join(root, "src", "main", "workspaceMigrations.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const migrations = await import(pathToFileURL(bundle).href);
  const legacy = [{
    id: "remote-old-host-home-vscode",
    name: "legacy",
    path: "/home/vscode",
    type: "remote-ssh",
    remote: { hostAlias: "host-a", canonicalPath: "/home/vscode" },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    lastOpenedAt: "2025-01-01T00:00:00.000Z",
    trusted: false,
  }];
  const migrated = migrations.migrateLegacyWorkspaceRecords(legacy);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.records[0].location, "remote");
  assert.equal(migrated.records[0].transport, "ssh");
  assert.equal(migrations.migrateLegacyWorkspaceRecords(migrated.records).changed, false);

  const backup = join(temp, "workspaces.legacy-v1.backup.json");
  const original = JSON.stringify(legacy, null, 2);
  assert.equal(await migrations.backupLegacyWorkspaceDataOnce(backup, original), true);
  assert.equal(await migrations.backupLegacyWorkspaceDataOnce(backup, "must-not-overwrite"), false);
  assert.equal(await readFile(backup, "utf8"), original);

  const previous = legacy[0];
  const authoritative = {
    ...migrated.records[0],
    id: "workspace-runtime-authoritative",
    location: "remote",
    transport: "ssh",
    remote: { ...legacy[0].remote, workspaceId: "workspace-runtime-authoritative" },
  };
  const reconciled = migrations.migrateWorkspaceToAuthoritativeId(previous, authoritative);
  assert.deepEqual(reconciled.metadata.legacyWorkspaceIds, [previous.id]);
  assert.equal(reconciled.createdAt, previous.createdAt);

  const journal = join(temp, "workspace-id-migrations.json");
  const row = { legacyId: previous.id, workspaceId: authoritative.id, hostAlias: "host-a", canonicalPath: "/home/vscode", migratedAt: "2026-01-01T00:00:00Z" };
  await migrations.recordWorkspaceIdMigration(journal, row);
  await migrations.recordWorkspaceIdMigration(journal, { ...row, migratedAt: "2026-02-01T00:00:00Z" });
  assert.equal(JSON.parse(await readFile(journal, "utf8")).length, 1);
  await assert.rejects(() => migrations.recordWorkspaceIdMigration(journal, { ...row, workspaceId: "workspace-other" }), /already mapped/);
  console.log("Workspace legacy backup and authoritative ID migration verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
