import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopTeamMemoryAddRequest,
  DesktopTeamMemoryDeleteRequest,
  DesktopTeamMemoryDeleteResult,
  DesktopTeamMemoryEntry,
  DesktopTeamMemoryListRequest,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { DRSAI_HOME } from "./paths";

const TEAM_MEMORY_FILE = join(DRSAI_HOME, "desktop", "team-memory.json");
const MAX_ENTRIES_PER_TEAM = 200;
const MAX_CONTENT_CHARS = 4000;

interface TeamMemoryStore {
  teams: Record<string, DesktopTeamMemoryEntry[]>;
}

export async function listTeamMemory(rawRequest: unknown = {}): Promise<DesktopTeamMemoryEntry[]> {
  const request = validateListRequest(rawRequest);
  const identity = await currentIdentity();
  if (request.teamId) assertAuthorizedTeam(identity.groups, request.teamId);
  const store = await readStore();
  const teamIds = request.teamId ? [request.teamId] : identity.groups;
  return teamIds
    .flatMap((teamId) => store.teams[teamId] ?? [])
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, request.limit ?? 20);
}

export async function addTeamMemory(rawRequest: unknown): Promise<DesktopTeamMemoryEntry> {
  const request = validateAddRequest(rawRequest);
  const identity = await currentIdentity();
  assertAuthorizedTeam(identity.groups, request.teamId);
  const store = await readStore();
  const now = new Date().toISOString();
  const entry: DesktopTeamMemoryEntry = {
    id: `team-memory-${randomUUID()}`,
    teamId: request.teamId,
    content: request.content,
    createdBy: identity.userId,
    createdAt: now,
    updatedAt: now,
  };
  store.teams[request.teamId] = [entry, ...(store.teams[request.teamId] ?? [])]
    .slice(0, MAX_ENTRIES_PER_TEAM);
  await writeStore(store);
  return entry;
}

export async function deleteTeamMemory(rawRequest: unknown): Promise<DesktopTeamMemoryDeleteResult> {
  const request = validateDeleteRequest(rawRequest);
  const identity = await currentIdentity();
  assertAuthorizedTeam(identity.groups, request.teamId);
  const store = await readStore();
  const existing = store.teams[request.teamId] ?? [];
  const next = existing.filter((entry) => entry.id !== request.entryId);
  if (next.length) store.teams[request.teamId] = next;
  else delete store.teams[request.teamId];
  if (next.length !== existing.length) await writeStore(store);
  return { teamId: request.teamId, removedCount: existing.length - next.length };
}

async function currentIdentity(): Promise<{ userId: string; groups: string[] }> {
  const auth = await requireAuthContext();
  const groups: string[] = [];
  for (const rawGroup of auth.session.user?.groups ?? []) {
    try { groups.push(sanitizeTeamId(rawGroup)); } catch { /* Ignore unrelated malformed identity claims. */ }
  }
  return {
    userId: auth.userId,
    groups: [...new Set(groups)],
  };
}

function assertAuthorizedTeam(groups: string[], teamId: string): void {
  if (!groups.includes(teamId)) throw new Error("You are not authorized to access this team's memory.");
}

async function readStore(): Promise<TeamMemoryStore> {
  try {
    const parsed = JSON.parse(await readFile(TEAM_MEMORY_FILE, "utf8")) as Partial<TeamMemoryStore>;
    if (!parsed.teams || typeof parsed.teams !== "object") return { teams: {} };
    const teams: TeamMemoryStore["teams"] = {};
    for (const [rawTeamId, rawEntries] of Object.entries(parsed.teams)) {
      let teamId: string;
      try { teamId = sanitizeTeamId(rawTeamId); } catch { continue; }
      if (!Array.isArray(rawEntries)) continue;
      const entries = rawEntries.filter(isEntry).filter((entry) => entry.teamId === teamId).slice(0, MAX_ENTRIES_PER_TEAM);
      if (entries.length) teams[teamId] = entries;
    }
    return { teams };
  } catch {
    return { teams: {} };
  }
}

async function writeStore(store: TeamMemoryStore): Promise<void> {
  await mkdir(dirname(TEAM_MEMORY_FILE), { recursive: true });
  const temporaryPath = `${TEAM_MEMORY_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, TEAM_MEMORY_FILE);
}

function validateListRequest(rawRequest: unknown): DesktopTeamMemoryListRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Team memory list request must be an object.");
  const request = rawRequest as Partial<DesktopTeamMemoryListRequest>;
  return {
    teamId: request.teamId === undefined ? undefined : sanitizeTeamId(request.teamId),
    limit: request.limit === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(Number(request.limit) || 20))),
  };
}

function validateAddRequest(rawRequest: unknown): DesktopTeamMemoryAddRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Team memory add request must be an object.");
  const request = rawRequest as Partial<DesktopTeamMemoryAddRequest>;
  return { teamId: sanitizeTeamId(request.teamId), content: sanitizeContent(request.content) };
}

function validateDeleteRequest(rawRequest: unknown): DesktopTeamMemoryDeleteRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Team memory delete request must be an object.");
  const request = rawRequest as Partial<DesktopTeamMemoryDeleteRequest>;
  if (typeof request.entryId !== "string" || !/^team-memory-[a-zA-Z0-9-]{36}$/.test(request.entryId)) throw new Error("Team memory entry id is invalid.");
  return { teamId: sanitizeTeamId(request.teamId), entryId: request.entryId };
}

function sanitizeTeamId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(value)) throw new Error("Team id is invalid.");
  return value;
}

function sanitizeContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CONTENT_CHARS) throw new Error("Team memory content is invalid.");
  return value.trim();
}

function isEntry(value: unknown): value is DesktopTeamMemoryEntry {
  const entry = value as DesktopTeamMemoryEntry;
  return Boolean(entry && /^team-memory-[a-zA-Z0-9-]{36}$/.test(entry.id) && typeof entry.teamId === "string" && typeof entry.content === "string" && typeof entry.createdBy === "string" && typeof entry.createdAt === "string" && typeof entry.updatedAt === "string");
}
