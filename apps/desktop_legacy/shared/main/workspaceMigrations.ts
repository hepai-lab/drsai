import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type { WorkspaceProject } from "../api/desktopApi";
import { migrateWorkspaceLocation } from "../api/workspaceLocation";

export const WORKSPACE_MIGRATION_VERSION = 2;

type JsonObject = Record<string, unknown>;

export interface WorkspaceMigrationResult {
  records: unknown[];
  changed: boolean;
  migratedIds: string[];
}

export function migrateLegacyWorkspaceRecords(records: unknown[]): WorkspaceMigrationResult {
  let changed = false;
  const migratedIds: string[] = [];
  const next = records.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const source = value as JsonObject;
    const migrated = migrateWorkspaceLocation(source);
    if (migrated.location === source.location && migrated.transport === source.transport) return value;
    changed = true;
    if (typeof source.id === "string") migratedIds.push(source.id);
    return {
      ...migrated,
      metadata: {
        ...(source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata as JsonObject : {}),
        migrationVersion: WORKSPACE_MIGRATION_VERSION,
        migratedFrom: source.type === "remote-ssh" ? "remote-ssh" : "local",
      },
    };
  });
  return { records: next, changed, migratedIds };
}

export async function backupLegacyWorkspaceDataOnce(backupPath: string, raw: string): Promise<boolean> {
  await mkdir(dirname(backupPath), { recursive: true });
  try {
    await writeFile(backupPath, raw, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export interface WorkspaceIdMigration {
  legacyId: string;
  workspaceId: string;
  runtimeId?: string;
  hostAlias: string;
  canonicalPath: string;
  migratedAt: string;
}

export async function recordWorkspaceIdMigration(filePath: string, migration: WorkspaceIdMigration): Promise<void> {
  let rows: WorkspaceIdMigration[] = [];
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (Array.isArray(parsed)) rows = parsed.filter(isWorkspaceIdMigration);
  } catch {
    // A missing migration journal is the normal first-run state.
  }
  const duplicate = rows.find((row) => row.legacyId === migration.legacyId);
  if (duplicate) {
    if (duplicate.workspaceId !== migration.workspaceId || duplicate.hostAlias !== migration.hostAlias || duplicate.canonicalPath !== migration.canonicalPath) {
      throw new Error(`Legacy Workspace ${migration.legacyId} is already mapped to another Runtime identity.`);
    }
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify([...rows, migration], null, 2)}\n`, "utf8");
}

export function migrateWorkspaceToAuthoritativeId(previous: WorkspaceProject | undefined, current: WorkspaceProject): WorkspaceProject {
  if (!previous || previous.id === current.id) return current;
  const legacyIds = new Set<string>([
    ...(Array.isArray(previous.metadata?.legacyWorkspaceIds) ? previous.metadata.legacyWorkspaceIds.filter((item): item is string => typeof item === "string") : []),
    previous.id,
  ]);
  return {
    ...current,
    createdAt: previous.createdAt,
    metadata: {
      ...previous.metadata,
      ...current.metadata,
      legacyWorkspaceIds: [...legacyIds].sort(),
      migrationVersion: WORKSPACE_MIGRATION_VERSION,
    },
  };
}

function isWorkspaceIdMigration(value: unknown): value is WorkspaceIdMigration {
  const row = value as WorkspaceIdMigration;
  return Boolean(row && typeof row.legacyId === "string" && typeof row.workspaceId === "string" && typeof row.hostAlias === "string" && typeof row.canonicalPath === "string");
}
