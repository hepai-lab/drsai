import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import http from "http";
import { DRSAI_HOME } from "./installer";
import { profilePaths, escapeRegex, safeWriteFile } from "./utils";

// ── Gateway HTTP helpers ─────────────────────────────────
//
// env / config-yaml / platform reads-and-writes go through the DrSai backend
// gateway so the running agent picks up changes (env -> dotenv reload via
// agent re-create; cli_config.json -> structured settings). The "profile"
// arg is preserved for IPC signature compatibility but ignored — drsai has
// no profile concept yet (user_id is the equivalent).

const DRSAI_API_PORT_FOR_CONFIG = parseInt(
  process.env.DRSAI_API_PORT || "8642",
  10,
);
const DRSAI_API_URL_FOR_CONFIG = `http://127.0.0.1:${DRSAI_API_PORT_FOR_CONFIG}`;

function gatewayRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL_FOR_CONFIG}${path}`;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 5000,
        headers: bodyStr
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(bodyStr)),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            let detail = data;
            try {
              detail = JSON.parse(data).detail || data;
            } catch {
              /* keep raw */
            }
            reject(new Error(detail));
            return;
          }
          try {
            resolve(data ? (JSON.parse(data) as T) : ({} as T));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Gateway config request timed out"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Connection Config (local / remote / ssh) ─────────────

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: SshConnectionConfig;
}

// Lazy getter — avoids circular dependency with installer.ts
// (DRSAI_HOME may not be assigned yet when this module first loads)
function desktopConfigFile(): string {
  return join(DRSAI_HOME, "drsai.json");
}

function readDesktopConfig(): Record<string, unknown> {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return {};
  }
}

function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(DRSAI_HOME)) {
    mkdirSync(DRSAI_HOME, { recursive: true });
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(data, null, 2), "utf-8");
}

export function getConnectionConfig(): ConnectionConfig {
  const data = readDesktopConfig();
  const ssh = (data.sshConfig as Partial<SshConnectionConfig>) ?? {};
  return {
    mode: (data.connectionMode as "local" | "remote" | "ssh") || "local",
    remoteUrl: (data.remoteUrl as string) || "",
    apiKey: (data.remoteApiKey as string) || "",
    ssh: {
      host: (ssh.host as string) || "",
      port: (ssh.port as number) || 22,
      username: (ssh.username as string) || "",
      keyPath: (ssh.keyPath as string) || "",
      remotePort: (ssh.remotePort as number) || 8642,
      localPort: (ssh.localPort as number) || 18642,
    },
  };
}

export function setConnectionConfig(config: ConnectionConfig): void {
  const data = readDesktopConfig();
  data.connectionMode = config.mode;
  data.remoteUrl = config.remoteUrl;
  data.remoteApiKey = config.apiKey;
  if (config.mode === "ssh") {
    data.sshConfig = config.ssh;
  }
  writeDesktopConfig(data);
}

// ── User Name (desktop identity) ──────────────────────

/**
 * Get the configured desktop user name.
 * Falls back to system username if not configured.
 */
export function getUserName(): string {
  const data = readDesktopConfig();
  if (data.userName && typeof data.userName === "string" && data.userName.trim()) {
    return data.userName as string;
  }
  // Fallback: system username (aligned with Python's os.getlogin())
  try {
    const os = require("os") as typeof import("os");
    return os.userInfo().username || "desktop";
  } catch {
    return "desktop";
  }
}

/**
 * Set a custom desktop user name. Persisted to drsai.json.
 */
export function setUserName(name: string): void {
  const data = readDesktopConfig();
  data.userName = name.trim();
  writeDesktopConfig(data);
  // Also sync to the API server if running
  _syncUserNameToApi(name.trim()).catch(() => {
    /* best-effort */
  });
}

async function _syncUserNameToApi(name: string): Promise<void> {
  try {
    const http = require("http") as typeof import("http");
    const body = JSON.stringify({ user_name: name });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        "http://127.0.0.1:8642/v1/config/user-name",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          timeout: 3000,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => resolve()); // best-effort
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    });
  } catch {
    /* best-effort */
  }
}

// ── In-memory cache with TTL ─────────────────────────────
const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getCached<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

// ── Env (.env) — backed by /v1/config/env ───────────────
//
// The renderer treats these as sync (no await on the IPC return), but the
// HTTP roundtrip forces async. The returned Promise resolves through ipcMain
// transparently. The "profile" argument is ignored — drsai has a single
// shared .env at FS_DIR/.env.

export async function readEnv(
  _profile?: string,
): Promise<Record<string, string>> {
  try {
    const resp = await gatewayRequest<{
      path: string;
      env: Record<string, string>;
    }>("GET", "/v1/config/env?masked=false");
    return resp.env || {};
  } catch (err) {
    console.warn("[config] readEnv via gateway failed:", (err as Error).message);
    return {};
  }
}

export async function setEnvValue(
  key: string,
  value: string,
  _profile?: string,
): Promise<void> {
  validateEnvEntry(key, value);
  await gatewayRequest<{ ok: boolean }>(
    "PUT",
    `/v1/config/env/${encodeURIComponent(key)}`,
    { value },
  );
}

export function validateEnvEntry(key: string, value: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(
      "Invalid environment variable name. Use letters, numbers, and underscores, and do not start with a number.",
    );
  }

  if (/[\0\r\n]/.test(value)) {
    throw new Error("Environment variable values must be single-line strings.");
  }
}

// ── Config (cli_config.json) — backed by /v1/config/cli ──
//
// Only flat keys that match cli_config.json fields are writable
// (plan_mode / workspace_enabled / dangerous_allowed / user_id /
// defult_config_name).  Dotted/legacy keys like ``agent.service_tier`` or
// ``network.proxy`` are hermes-specific and not implemented in drsai —
// reads return null, writes are silently ignored so renderer code that
// probes for them stays safe.

const _DOTTED_KEY_RE = /\./;

export async function getConfigValue(
  key: string,
  _profile?: string,
): Promise<string | null> {
  if (_DOTTED_KEY_RE.test(key)) return null;
  try {
    const resp = await gatewayRequest<{
      path: string;
      config: Record<string, unknown>;
    }>("GET", "/v1/config/cli");
    const v = resp.config?.[key];
    if (v === undefined || v === null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  } catch (err) {
    console.warn(
      "[config] getConfigValue via gateway failed:",
      (err as Error).message,
    );
    return null;
  }
}

export async function setConfigValue(
  key: string,
  value: string,
  _profile?: string,
): Promise<void> {
  if (_DOTTED_KEY_RE.test(key)) return; // hermes-only key — no-op
  // Coerce well-known booleans
  let payload: string | boolean = value;
  if (value === "true") payload = true;
  else if (value === "false") payload = false;
  try {
    await gatewayRequest<{ ok: boolean }>(
      "PUT",
      `/v1/config/cli/${encodeURIComponent(key)}`,
      { value: payload },
    );
  } catch (err) {
    // 400 means non-writable key — log and ignore so legacy renderer
    // code (e.g. trying to set hermes-only flags) doesn't crash.
    console.warn(
      `[config] setConfigValue('${key}') failed:`,
      (err as Error).message,
    );
  }
}

export function getModelConfig(profile?: string): {
  provider: string;
  model: string;
  baseUrl: string;
} {
  const cacheKey = `mc:${profile || "default"}`;
  const cached = getCached<{
    provider: string;
    model: string;
    baseUrl: string;
  }>(cacheKey);
  if (cached) return cached;

  const { configFile } = profilePaths(profile);
  const defaults = { provider: "auto", model: "", baseUrl: "" };
  if (!existsSync(configFile)) return defaults;

  const content = readFileSync(configFile, "utf-8");

  const providerMatch = content.match(/^\s*provider:\s*["']?([^"'\n#]+)["']?/m);
  const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
  const baseUrlMatch = content.match(/^\s*base_url:\s*["']?([^"'\n#]+)["']?/m);

  const result = {
    provider: providerMatch ? providerMatch[1].trim() : defaults.provider,
    model: modelMatch ? modelMatch[1].trim() : defaults.model,
    baseUrl: baseUrlMatch ? baseUrlMatch[1].trim() : defaults.baseUrl,
  };

  setCache(cacheKey, result);
  return result;
}

export function setModelConfig(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): void {
  invalidateCache(`mc:${profile || "default"}`);
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");

  const providerRegex = /^(\s*provider:\s*)["']?[^"'\n#]*["']?/m;
  if (providerRegex.test(content)) {
    content = content.replace(providerRegex, `$1"${provider}"`);
  }

  const modelRegex = /^(\s*default:\s*)["']?[^"'\n#]*["']?/m;
  if (modelRegex.test(content)) {
    content = content.replace(modelRegex, `$1"${model}"`);
  }

  const baseUrlRegex = /^(\s*base_url:\s*)["']?[^"'\n#]*["']?/m;
  if (baseUrlRegex.test(content)) {
    content = content.replace(baseUrlRegex, `$1"${baseUrl}"`);
  } else if (baseUrl && provider !== "auto") {
    // Append base_url line after the provider line in the model section
    content = content.replace(
      /^(\s*provider:\s*"[^"]*"\s*\n)/m,
      `$1  base_url: "${baseUrl}"\n`
    );
  }

  // Disable smart_model_routing
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  content = lines.join("\n");

  // Enable streaming
  const streamingRegex = /^(\s*streaming:\s*)(\S+)/m;
  if (streamingRegex.test(content)) {
    content = content.replace(streamingRegex, "$1true");
  }

  safeWriteFile(configFile, content);
}

export function getDrsaiHome(profile?: string): string {
  return profilePaths(profile).home;
}

// ── Platform toggles — backed by /v1/config/platforms ────
//
// drsai does not yet ship messaging-platform plugins; the gateway persists
// these flags in cli_config.json[platforms] so the UI state survives
// restarts and lights up the moment plugins land.

export async function getPlatformEnabled(
  _profile?: string,
): Promise<Record<string, boolean>> {
  try {
    const resp = await gatewayRequest<{
      platforms: Record<string, boolean>;
    }>("GET", "/v1/config/platforms");
    return resp.platforms || {};
  } catch (err) {
    console.warn(
      "[config] getPlatformEnabled via gateway failed:",
      (err as Error).message,
    );
    return {};
  }
}

export async function setPlatformEnabled(
  platform: string,
  enabled: boolean,
  _profile?: string,
): Promise<void> {
  try {
    await gatewayRequest<{ ok: boolean }>(
      "PUT",
      `/v1/config/platforms/${encodeURIComponent(platform)}`,
      { enabled },
    );
  } catch (err) {
    console.warn(
      `[config] setPlatformEnabled('${platform}') failed:`,
      (err as Error).message,
    );
  }
}

// ── Credential Pool (auth.json) ──────────────────────────

function authFilePath(): string {
  return join(DRSAI_HOME, "auth.json");
}

interface CredentialEntry {
  key: string;
  label: string;
}

function readAuthStore(): Record<string, unknown> {
  try {
    const p = authFilePath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(store: Record<string, unknown>): void {
  safeWriteFile(authFilePath(), JSON.stringify(store, null, 2));
}

export function getCredentialPool(): Record<string, CredentialEntry[]> {
  const store = readAuthStore();
  const pool = store.credential_pool;
  if (!pool || typeof pool !== "object") return {};
  return pool as Record<string, CredentialEntry[]>;
}

export function setCredentialPool(
  provider: string,
  entries: CredentialEntry[],
): void {
  const store = readAuthStore();
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  writeAuthStore(store);
}
