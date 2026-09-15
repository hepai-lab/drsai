/**
 * Device-local Agent Square preferences (default + recent usage).
 *
 * Mirrors WebUI's default/recent semantics without the WebUI SQLite tables:
 * preferences stay under DRSAI_HOME and never leave the main process unencrypted
 * path. Platform agents can be selected as default on this device even when the
 * HAI catalog does not accept a server-side default mutation.
 */

import { join } from "node:path";
import { DRSAI_HOME } from "./paths";
import { readDurableJson, writeDurableJson } from "./durableJsonStore";

const PREFS_PATH = join(DRSAI_HOME, "desktop", "agent-preferences.json");
const MAX_RECENT = 12;

export interface DesktopAgentPreferences {
  defaultAgentId: string | null;
  recentAgentIds: string[];
  updatedAt: string;
}

function emptyPrefs(): DesktopAgentPreferences {
  return {
    defaultAgentId: null,
    recentAgentIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function decodePrefs(value: unknown): DesktopAgentPreferences {
  if (!value || typeof value !== "object") return emptyPrefs();
  const record = value as Record<string, unknown>;
  const defaultAgentId =
    typeof record.defaultAgentId === "string" && record.defaultAgentId.trim()
      ? record.defaultAgentId.trim()
      : null;
  const recentAgentIds = Array.isArray(record.recentAgentIds)
    ? record.recentAgentIds
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        .map((id) => id.trim())
        .slice(0, MAX_RECENT)
    : [];
  return {
    defaultAgentId,
    recentAgentIds,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

export async function getAgentPreferences(): Promise<DesktopAgentPreferences> {
  const stored = await readDurableJson(PREFS_PATH, decodePrefs);
  return stored?.value ?? emptyPrefs();
}

export async function setDefaultAgentPreference(agentId: string): Promise<DesktopAgentPreferences> {
  const trimmed = agentId.trim();
  if (!trimmed) throw new Error("agentId is required");
  const current = await getAgentPreferences();
  const next: DesktopAgentPreferences = {
    ...current,
    defaultAgentId: trimmed,
    updatedAt: new Date().toISOString(),
  };
  await writeDurableJson(PREFS_PATH, next);
  return next;
}

export async function clearDefaultAgentPreference(): Promise<DesktopAgentPreferences> {
  const current = await getAgentPreferences();
  const next: DesktopAgentPreferences = {
    ...current,
    defaultAgentId: null,
    updatedAt: new Date().toISOString(),
  };
  await writeDurableJson(PREFS_PATH, next);
  return next;
}

export async function recordRecentAgentPreference(agentId: string): Promise<DesktopAgentPreferences> {
  const trimmed = agentId.trim();
  if (!trimmed) throw new Error("agentId is required");
  const current = await getAgentPreferences();
  const recentAgentIds = [trimmed, ...current.recentAgentIds.filter((id) => id !== trimmed)].slice(
    0,
    MAX_RECENT,
  );
  const next: DesktopAgentPreferences = {
    ...current,
    recentAgentIds,
    updatedAt: new Date().toISOString(),
  };
  await writeDurableJson(PREFS_PATH, next);
  return next;
}
