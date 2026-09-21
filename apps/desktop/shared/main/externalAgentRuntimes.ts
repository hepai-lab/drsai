import { readFileSync, readdirSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import type { DesktopAgent } from "../api/desktopApi";
import { DRSAI_HOME } from "./paths";

const REGISTRY_SCHEMA_VERSION = 1;
const EXPECTED_CONTROL_VERSION = "1";
const EXPECTED_OAEP_VERSION = "1.0";
const EXPECTED_OAEP_PROFILE = "oaep.session-stream/1";
const EXPECTED_OAEP_SCHEMA_SHA256 = "e207c75c2f37e121dc613aec040c24fd5bd2c6f4f005826c8996a6bb848770b7";
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_REGISTRATIONS = 16;
const PROBE_TIMEOUT_MS = 2_500;

export interface ExternalAgentRuntimeDescriptor {
  runtimeId: string;
  agentId: string;
  agentName: string;
  description: string;
  owner: string;
  baseUrl: string;
  bearerToken: string;
  capabilities: string[];
  generation: number;
  nativeVersion: string;
  mappingVersion: string;
}

export interface RegistrationManifest {
  schema_version: number;
  runtime_id: string;
  endpoint: { base_url: string; bearer_token_file: string };
  agent: { id: string; name: string; description: string; owner: string };
  protocols: {
    control: { version: string };
    oaep: { version: string; profiles: string[]; schema_sha256: string };
  };
}

let activeDescriptors = new Map<string, ExternalAgentRuntimeDescriptor>();

export async function listExternalAgentRuntimeAgents(options: {
  preferCache?: boolean;
  registryRoot?: string;
  fetcher?: typeof fetch;
} = {}): Promise<DesktopAgent[]> {
  if (options.preferCache) return [...activeDescriptors.values()].map(toDesktopAgent);
  const descriptors = new Map<string, ExternalAgentRuntimeDescriptor>();
  for (const registration of readRegistrationManifests(options.registryRoot)) {
    const descriptor = await probeExternalAgentRuntimeRegistration(
      registration,
      options.fetcher ?? fetch,
    ).catch(() => null);
    if (descriptor) descriptors.set(descriptor.agentId, descriptor);
  }
  activeDescriptors = descriptors;
  return [...descriptors.values()].map(toDesktopAgent);
}

export function getExternalAgentRuntimeDescriptor(agentId: string): ExternalAgentRuntimeDescriptor | null {
  const descriptor = activeDescriptors.get(agentId);
  return descriptor ? structuredClone(descriptor) : null;
}

export function isExternalAgentRuntime(agentId: string): boolean {
  return activeDescriptors.has(agentId);
}

export function parseExternalAgentRuntimeManifest(
  raw: unknown,
  options: { registryRoot?: string } = {},
): RegistrationManifest {
  const registryRoot = options.registryRoot ?? join(DRSAI_HOME, "runtime-registry");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Runtime registration must be an object.");
  const value = raw as Partial<RegistrationManifest>;
  if (value.schema_version !== REGISTRY_SCHEMA_VERSION) throw new Error("Runtime registration schema is unsupported.");
  if (!validId(value.runtime_id)) throw new Error("Runtime id is invalid.");
  if (!value.endpoint || typeof value.endpoint !== "object") throw new Error("Runtime endpoint is missing.");
  const baseUrl = validateEndpoint(value.endpoint.base_url);
  const tokenFile = validateTokenFile(value.endpoint.bearer_token_file, registryRoot);
  if (!value.agent || typeof value.agent !== "object" || !validId(value.agent.id)) throw new Error("Runtime Agent identity is invalid.");
  if (!value.agent.id.startsWith("runtime:")) throw new Error("External Runtime Agent id must use the runtime namespace.");
  for (const field of [value.agent.name, value.agent.description, value.agent.owner]) {
    if (typeof field !== "string" || !field.trim() || field.length > 500) throw new Error("Runtime Agent metadata is invalid.");
  }
  if (value.protocols?.control?.version !== EXPECTED_CONTROL_VERSION
    || value.protocols?.oaep?.version !== EXPECTED_OAEP_VERSION
    || value.protocols.oaep.schema_sha256 !== EXPECTED_OAEP_SCHEMA_SHA256
    || !Array.isArray(value.protocols.oaep.profiles)
    || !value.protocols.oaep.profiles.includes(EXPECTED_OAEP_PROFILE)) {
    throw new Error("Runtime protocol identity is incompatible.");
  }
  return {
    schema_version: REGISTRY_SCHEMA_VERSION,
    runtime_id: value.runtime_id,
    endpoint: { base_url: baseUrl, bearer_token_file: tokenFile },
    agent: {
      id: value.agent.id,
      name: value.agent.name.trim(),
      description: value.agent.description.trim(),
      owner: value.agent.owner.trim(),
    },
    protocols: {
      control: { version: EXPECTED_CONTROL_VERSION },
      oaep: {
        version: EXPECTED_OAEP_VERSION,
        profiles: [...value.protocols.oaep.profiles],
        schema_sha256: EXPECTED_OAEP_SCHEMA_SHA256,
      },
    },
  };
}

function readRegistrationManifests(registryRoot?: string): RegistrationManifest[] {
  const root = registryRoot ?? join(DRSAI_HOME, "runtime-registry");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .slice(0, MAX_REGISTRATIONS)
      .flatMap((entry) => {
        try {
          const path = join(root, entry.name);
          if (statSync(path).size > MAX_MANIFEST_BYTES) return [];
          return [parseExternalAgentRuntimeManifest(JSON.parse(readFileSync(path, "utf8")), { registryRoot: root })];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export async function probeExternalAgentRuntimeRegistration(
  registration: RegistrationManifest,
  fetcher: typeof fetch = fetch,
): Promise<ExternalAgentRuntimeDescriptor | null> {
  const token = readFileSync(registration.endpoint.bearer_token_file, "utf8").trim();
  if (token.length < 32 || /\s/.test(token)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetcher(`${registration.endpoint.base_url}/v1/runtime/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ protocols: registration.protocols }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const value = await response.json() as Record<string, unknown>;
    const protocols = value.protocols as RegistrationManifest["protocols"] | undefined;
    const native = value.native_runtime as Record<string, unknown> | undefined;
    if (value.runtime_id !== registration.runtime_id
      || value.availability !== "production"
      || protocols?.control?.version !== EXPECTED_CONTROL_VERSION
      || protocols?.oaep?.version !== EXPECTED_OAEP_VERSION
      || protocols.oaep.schema_sha256 !== EXPECTED_OAEP_SCHEMA_SHA256
      || !protocols.oaep.profiles?.includes(EXPECTED_OAEP_PROFILE)
      || !Number.isInteger(value.generation) || Number(value.generation) < 1
      || !Array.isArray(value.capabilities)
      || !value.capabilities.includes("run.start")
      || !value.capabilities.includes("session.events.stream")
      || typeof value.mapping_version !== "string"
      || typeof native?.version !== "string") return null;
    return {
      runtimeId: registration.runtime_id,
      agentId: registration.agent.id,
      agentName: registration.agent.name,
      description: registration.agent.description,
      owner: registration.agent.owner,
      baseUrl: registration.endpoint.base_url,
      bearerToken: token,
      capabilities: (value.capabilities as unknown[]).filter((item): item is string => typeof item === "string"),
      generation: Number(value.generation),
      nativeVersion: native.version,
      mappingVersion: value.mapping_version,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toDesktopAgent(descriptor: ExternalAgentRuntimeDescriptor): DesktopAgent {
  return {
    id: descriptor.agentId,
    name: descriptor.agentName,
    description: descriptor.description,
    owner: descriptor.owner,
    source: "local",
    status: "running",
    mode: "oaep-runtime",
    available: true,
    capabilities: ["chat", "streaming", "workspace", "tools"],
    catalogGroup: "local",
    catalogVisibility: "when_available",
    url: descriptor.baseUrl,
  };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function validateEndpoint(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Runtime endpoint is invalid.");
  const value = new URL(raw);
  if (value.username || value.password || value.search || value.hash || value.pathname !== "/") {
    throw new Error("Runtime endpoint must be an origin without credentials.");
  }
  const loopback = value.hostname === "127.0.0.1" || value.hostname === "[::1]" || value.hostname === "::1";
  if (value.protocol !== "https:" && !(value.protocol === "http:" && loopback)) {
    throw new Error("Runtime endpoint must use HTTPS or loopback HTTP.");
  }
  return value.origin;
}

function validateTokenFile(raw: unknown, registryRoot: string): string {
  if (typeof raw !== "string" || !isAbsolute(raw)) throw new Error("Runtime token file must be absolute.");
  const root = resolve(registryRoot);
  const path = resolve(raw);
  const child = relative(root, path);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("Runtime token file is outside the registry root.");
  return path;
}
