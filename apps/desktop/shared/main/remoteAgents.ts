/**
 * Device-local user-connected remote agents (WebUI 「连接远程」 parity).
 *
 * These are NOT HAI platform catalog entries. They are worker endpoints the user
 * saved on this device (URL + encrypted API key). Catalog ids use the
 * `device-remote:` prefix so they never collide with platform agent ids.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DesktopAgent } from "../api/desktopApi";
import type { DesktopCredentialService } from "../api/platformServices";
import { readDurableJson, writeDurableJson } from "./durableJsonStore";
import { DRSAI_HOME } from "./paths";

const STORE_PATH = join(DRSAI_HOME, "desktop", "remote-agents.json");
const ID_PREFIX = "device-remote:";

export interface RemoteAgentSaveRequest {
  name: string;
  url: string;
  apiKey: string;
  /** Optional fields returned by a successful connection test. */
  agentInfo?: Record<string, unknown>;
  id?: string;
}

export interface RemoteAgentTestRequest {
  name: string;
  url: string;
  apiKey: string;
}

export interface RemoteAgentTestResult {
  ok: boolean;
  message: string;
  agentInfo?: Record<string, unknown>;
}

interface StoredRemoteAgent {
  id: string;
  name: string;
  url: string;
  apiKeyReference: string;
  description?: string;
  owner?: string;
  logo?: string;
  model?: string;
  savedAt: string;
  updatedAt: string;
}

interface RemoteAgentStore {
  agents: StoredRemoteAgent[];
}

let credentialService: DesktopCredentialService | null = null;

export function configureRemoteAgentCredentials(credentials: DesktopCredentialService): void {
  credentialService = credentials;
}

function emptyStore(): RemoteAgentStore {
  return { agents: [] };
}

function decodeStore(value: unknown): RemoteAgentStore {
  if (!value || typeof value !== "object") return emptyStore();
  const record = value as Record<string, unknown>;
  const agents = Array.isArray(record.agents)
    ? record.agents
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => {
          const id = typeof item.id === "string" ? item.id.trim() : "";
          const name = typeof item.name === "string" ? item.name.trim() : "";
          const url = typeof item.url === "string" ? item.url.trim() : "";
          const apiKeyReference = typeof item.apiKeyReference === "string" ? item.apiKeyReference : "";
          if (!id.startsWith(ID_PREFIX) || !name || !url || !apiKeyReference) return null;
          return {
            id,
            name,
            url,
            apiKeyReference,
            description: typeof item.description === "string" ? item.description : undefined,
            owner: typeof item.owner === "string" ? item.owner : undefined,
            logo: typeof item.logo === "string" ? item.logo : undefined,
            model: typeof item.model === "string" ? item.model : undefined,
            savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date().toISOString(),
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
          } satisfies StoredRemoteAgent;
        })
        .filter(Boolean) as StoredRemoteAgent[]
    : [];
  return { agents };
}

async function readStore(): Promise<RemoteAgentStore> {
  const stored = await readDurableJson(STORE_PATH, decodeStore);
  return stored?.value ?? emptyStore();
}

async function writeStore(store: RemoteAgentStore): Promise<void> {
  await writeDurableJson(STORE_PATH, store);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function displayName(name: string): string {
  return name.trim() || "Remote Agent";
}

function toCatalogAgent(record: StoredRemoteAgent): DesktopAgent {
  return {
    id: record.id,
    name: record.name,
    description:
      record.description
      || "A remote agent connected from this device.",
    localizedDescription: {
      zh: record.description || "本机已连接的远程智能体。",
      en: record.description || "A remote agent connected from this device.",
    },
    owner: record.owner || "Remote",
    source: "remote",
    status: "running",
    mode: "remote",
    available: true,
    capabilities: ["chat", "streaming"],
    catalogGroup: "mine",
    url: record.url,
    model: record.model || record.name,
    logo: record.logo,
  };
}

export function isDeviceRemoteAgentId(agentId: string): boolean {
  return agentId.startsWith(ID_PREFIX);
}

export async function listDeviceRemoteAgents(): Promise<DesktopAgent[]> {
  const store = await readStore();
  return store.agents.map(toCatalogAgent);
}

export async function testDeviceRemoteAgent(
  request: RemoteAgentTestRequest,
): Promise<RemoteAgentTestResult> {
  const name = displayName(request.name);
  const url = normalizeUrl(request.url);
  const apiKey = request.apiKey.trim();
  if (!name || !url || !apiKey) {
    return { ok: false, message: "Name, URL, and API key are required." };
  }

  try {
    const agentInfo = await probeRemoteWorker({ baseUrl: url, modelName: name, apiKey });
    return {
      ok: true,
      message: "Remote agent connection verified.",
      agentInfo,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Remote agent connection failed.",
    };
  }
}

export async function saveDeviceRemoteAgent(
  request: RemoteAgentSaveRequest,
): Promise<DesktopAgent> {
  if (!credentialService?.available()) {
    throw new Error("The system credential store is unavailable or locked.");
  }
  const name = displayName(request.name);
  const url = normalizeUrl(request.url);
  const apiKey = request.apiKey.trim();
  if (!name || !url || !apiKey) {
    throw new Error("Name, URL, and API key are required.");
  }

  const store = await readStore();
  const nameKey = name.toLowerCase();
  const existingId = typeof request.id === "string" && request.id.startsWith(ID_PREFIX)
    ? request.id
    : undefined;
  const collision = store.agents.find(
    (agent) =>
      agent.id !== existingId
      && agent.name.toLowerCase() === nameKey,
  );
  if (collision) {
    throw new Error("该名称与已有智能体重名，请更换名称后再保存。");
  }

  const apiKeyReference = credentialService.protect(apiKey);
  if (!apiKeyReference) {
    throw new Error("Failed to protect the remote agent API key.");
  }

  const info = request.agentInfo ?? {};
  const now = new Date().toISOString();
  const id = existingId ?? `${ID_PREFIX}${randomUUID()}`;
  const previous = store.agents.find((agent) => agent.id === id);
  if (previous) {
    credentialService.remove?.(previous.apiKeyReference);
  }

  const next: StoredRemoteAgent = {
    id,
    name,
    url,
    apiKeyReference,
    description:
      typeof info.description === "string"
        ? info.description
        : typeof info.announcements === "string"
          ? info.announcements
          : previous?.description,
    owner:
      typeof info.owner === "string"
        ? info.owner
        : typeof info.author === "string"
          ? info.author
          : previous?.owner || "Remote",
    logo: typeof info.logo === "string" ? info.logo : previous?.logo,
    model: typeof info.id === "string" ? info.id : name,
    savedAt: previous?.savedAt ?? now,
    updatedAt: now,
  };

  store.agents = [...store.agents.filter((agent) => agent.id !== id), next];
  await writeStore(store);
  return toCatalogAgent(next);
}

export async function removeDeviceRemoteAgent(agentId: string): Promise<boolean> {
  if (!isDeviceRemoteAgentId(agentId)) return false;
  const store = await readStore();
  const existing = store.agents.find((agent) => agent.id === agentId);
  if (!existing) return false;
  credentialService?.remove?.(existing.apiKeyReference);
  store.agents = store.agents.filter((agent) => agent.id !== agentId);
  await writeStore(store);
  return true;
}

export async function getDeviceRemoteAgentApiKey(agentId: string): Promise<string | null> {
  if (!isDeviceRemoteAgentId(agentId) || !credentialService) return null;
  const store = await readStore();
  const existing = store.agents.find((agent) => agent.id === agentId);
  if (!existing) return null;
  return credentialService.unprotect(existing.apiKeyReference) ?? null;
}

async function probeRemoteWorker(input: {
  baseUrl: string;
  modelName: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const base = input.baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    // HepAI / OpenAI-compatible workers typically expose model listing.
    const candidates = [
      `${base}/models`,
      `${base}/v1/models`,
      `${base}/agents`,
    ];
    let lastError = "Unable to reach the remote agent endpoint.";
    for (const endpoint of candidates) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          lastError = `Remote endpoint returned HTTP ${response.status}.`;
          continue;
        }
        const payload = await response.json().catch(() => null) as
          | { data?: Array<{ id?: string; owned_by?: string; owner?: string }> }
          | null;
        const models = Array.isArray(payload?.data) ? payload.data : [];
        const matched = models.find(
          (model) => typeof model.id === "string" && model.id.toLowerCase() === input.modelName.toLowerCase(),
        );
        if (matched || models.length > 0 || response.ok) {
          return {
            id: matched?.id || input.modelName,
            name: input.modelName,
            owner: matched?.owned_by || matched?.owner || "Remote",
            description: matched
              ? `Remote worker ${matched.id}`
              : `Remote endpoint reachable at ${base}`,
            announcements: matched ? undefined : `Verified via ${endpoint}`,
          };
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Remote agent test timed out. Please retry or verify network/worker status.");
        }
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new Error(lastError);
  } finally {
    clearTimeout(timer);
  }
}
