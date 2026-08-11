import { createHash } from "crypto";
import type { DesktopAgent } from "../api/desktopApi";

export interface PlatformAgentExecutionDescriptor {
  publicId: string;
  platformId: string;
  mode: string;
  name: string;
  model?: string;
  available: boolean;
  capabilities: string[];
}

export interface PlatformAgentCachePayload {
  version: 1;
  savedAt: string;
  agents: DesktopAgent[];
}

export function createPlatformCatalogSubjectKey(
  platformName: string,
  platformCacheId: string,
  subject: string,
): string {
  return createHash("sha256")
    .update(`${platformName}:${platformCacheId}:${subject}`)
    .digest("hex")
    .slice(0, 20);
}

export function getOrCreateCatalogFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const current = flights.get(key);
  if (current) return current;
  const flight = load().finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
}

export function markCachedPlatformAgents(agents: DesktopAgent[]): DesktopAgent[] {
  return agents.map((agent) => ({
    ...agent,
    status: "unreachable",
    available: false,
    catalogState: "cached",
    error: "Cached catalog entry; refresh to verify current availability.",
  }));
}

export function mergeAndSortAgents(...groups: DesktopAgent[][]): DesktopAgent[] {
  const byId = new Map<string, DesktopAgent>();
  for (const agent of groups.flat()) {
    if (!agent.id || byId.has(agent.id)) continue;
    byId.set(agent.id, agent);
  }
  return [...byId.values()].sort(compareAgents);
}

export function createPublicAgentCachePayload(
  agents: DesktopAgent[],
  savedAt: string,
): PlatformAgentCachePayload {
  return {
    version: 1,
    savedAt,
    agents: agents.map(toCacheSafeAgent),
  };
}

export function parsePublicAgentCachePayload(value: unknown): PlatformAgentCachePayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<PlatformAgentCachePayload>;
  if (payload.version !== 1 || typeof payload.savedAt !== "string" || !Array.isArray(payload.agents)) {
    return null;
  }
  const agents = payload.agents
    .map(readCacheSafeAgent)
    .filter((agent): agent is DesktopAgent => agent !== null);
  return { version: 1, savedAt: payload.savedAt, agents };
}

function compareAgents(left: DesktopAgent, right: DesktopAgent): number {
  const localOrder = Number(right.source === "local") - Number(left.source === "local");
  if (localOrder) return localOrder;
  const defaultOrder = Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault));
  if (defaultOrder) return defaultOrder;
  const featuredOrder = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
  if (featuredOrder) return featuredOrder;
  const availableOrder = Number(right.available !== false) - Number(left.available !== false);
  if (availableOrder) return availableOrder;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function toCacheSafeAgent(agent: DesktopAgent): DesktopAgent {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    localizedDescription: agent.localizedDescription ? { ...agent.localizedDescription } : undefined,
    owner: agent.owner,
    source: agent.source,
    status: agent.status,
    mode: agent.mode,
    available: agent.available,
    featured: agent.featured,
    isDefault: agent.isDefault,
    capabilities: agent.capabilities ? [...agent.capabilities] : undefined,
    lastUsedAt: agent.lastUsedAt,
    catalogGroup: agent.catalogGroup,
    model: agent.model,
    models: agent.models ? [...agent.models] : undefined,
    logo: agent.logo,
    examples: cloneExamples(agent.examples),
    error: agent.error,
  };
}

function readCacheSafeAgent(value: unknown): DesktopAgent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  if (record.id.startsWith("platform:hai.native.")) return null;
  const status = record.status === "stopped" || record.status === "unreachable"
    ? record.status
    : "running";
  const description = normalizeCachedDescription(
    record.description,
    record.localizedDescription,
  );
  return toCacheSafeAgent({
    id: record.id,
    name: record.name,
    description: description.fallback,
    localizedDescription: description.localized,
    owner: typeof record.owner === "string" ? record.owner : "OpenDrSai",
    // This parser is used only for the HAI platform cache. Never trust a
    // persisted source/group field enough to turn a platform record into a
    // local agent; OpenDrSai is reconstructed independently from this device.
    source: "remote",
    status,
    mode: stringValue(record.mode),
    available: typeof record.available === "boolean" ? record.available : status === "running",
    featured: record.featured === true,
    isDefault: record.isDefault === true,
    capabilities: stringArray(record.capabilities),
    lastUsedAt: stringValue(record.lastUsedAt),
    catalogGroup: record.catalogGroup === "mine" ? "mine" : "official",
    model: stringValue(record.model),
    models: stringArray(record.models),
    logo: stringValue(record.logo),
    examples: normalizeExamples(record.examples),
    error: stringValue(record.error),
  });
}

function cloneExamples(value: DesktopAgent["examples"]): DesktopAgent["examples"] {
  if (!Array.isArray(value)) return value;
  return value.map((item) => typeof item === "string" ? item : { ...item });
}

function normalizeExamples(value: unknown): DesktopAgent["examples"] {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const result: Exclude<DesktopAgent["examples"], string | undefined> = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item) result.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const en = stringValue(record.en);
    const zh = stringValue(record.zh);
    if (en || zh) result.push({ en, zh });
  }
  return result.length ? result : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return result.length ? result : undefined;
}

function normalizeLocalizedText(value: unknown): DesktopAgent["localizedDescription"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const en = stringValue(record.en);
  const zh = stringValue(record.zh);
  return en || zh ? { en, zh } : undefined;
}

function normalizeCachedDescription(
  value: unknown,
  localizedValue: unknown,
): { fallback: string; localized?: DesktopAgent["localizedDescription"] } {
  const persisted = normalizeLocalizedText(localizedValue);
  if (persisted) {
    return {
      fallback: stringValue(value) || persisted.en || persisted.zh || "",
      localized: persisted,
    };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const localized = normalizeLocalizedText(value);
    return { fallback: localized?.en || localized?.zh || "", localized };
  }
  const text = stringValue(value) || "";
  if (!text.startsWith("{") || !text.endsWith("}")) return { fallback: text };
  try {
    const localized = normalizeLocalizedText(JSON.parse(text));
    return localized
      ? { fallback: localized.en || localized.zh || "", localized }
      : { fallback: text };
  } catch {
    return { fallback: text };
  }
}
