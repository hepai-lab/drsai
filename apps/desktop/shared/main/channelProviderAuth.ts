import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DesktopCredentialService } from "../api";

const MAX_RESPONSE_BYTES = 64 * 1024;
const OPERATION_ID = /^channel-auth:[a-f0-9-]{36}$/;

interface PendingAuth {
  operationId: string;
  workspaceKey: string;
  adapterId: "github-connector";
  deviceCodeReference: string;
  userCode: string;
  verificationUri: string;
  scopes: string[];
  intervalSeconds: number;
  expiresAt: string;
  createdAt: string;
}

interface ProviderCredential {
  workspaceKey: string;
  adapterId: "github-connector" | "slack-chat" | "docs-connector" | "calendar-connector";
  tokenReference: string;
  accountId: string;
  accountLabel: string;
  scopes: string[];
  configuredAt: string;
  expiresAt?: string;
}

interface AuthStore {
  schemaVersion: 1;
  pending: PendingAuth[];
  credentials: ProviderCredential[];
}

export interface GitHubDeviceAuthStartResult {
  operationId: string;
  userCode: string;
  verificationUri: string;
  authorizationUrl: string;
  expiresAt: string;
  intervalSeconds: number;
  scopes: string[];
}

export type GitHubDeviceAuthPollResult =
  | { status: "pending" | "slow_down"; operationId: string; intervalSeconds: number; expiresAt: string }
  | { status: "complete"; operationId: string; accountId: string; accountLabel: string; scopes: string[]; configuredAt: string }
  | { status: "expired" | "denied"; operationId: string; message: string };

export class ChannelProviderAuthService {
  #tail = Promise.resolve();

  constructor(
    private readonly storePath: string,
    private readonly credentials: DesktopCredentialService,
    private readonly fetcher: typeof fetch,
    private readonly githubClientId: string | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  startGitHub(workspaceKey: string, scopes: string[]): Promise<GitHubDeviceAuthStartResult> {
    return this.#run(async () => {
      this.#assertReady();
      const normalizedScopes = normalizeScopes(scopes);
      const response = await this.#request("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.githubClientId!, scope: normalizedScopes.join(" ") }),
      });
      const deviceCode = requiredString(response.device_code, "GitHub device response is missing device_code.", 2048);
      const userCode = requiredString(response.user_code, "GitHub device response is missing user_code.", 64);
      const verificationUri = safeGitHubUrl(response.verification_uri, "https://github.com/login/device");
      const expiresIn = boundedInteger(response.expires_in, 60, 1800, "GitHub device expiry is invalid.");
      const intervalSeconds = boundedInteger(response.interval ?? 5, 1, 60, "GitHub device polling interval is invalid.");
      const deviceCodeReference = this.credentials.protect(deviceCode);
      if (!deviceCodeReference) throw new Error("The system credential store is unavailable or locked.");
      const createdAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(this.now() + expiresIn * 1000).toISOString();
      const operationId = `channel-auth:${randomUUID()}`;
      const store = await this.#read();
      for (const prior of store.pending.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "github-connector")) this.credentials.remove?.(prior.deviceCodeReference);
      store.pending = [{ operationId, workspaceKey, adapterId: "github-connector", deviceCodeReference, userCode, verificationUri, scopes: normalizedScopes, intervalSeconds, expiresAt, createdAt }, ...store.pending.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "github-connector")];
      try { await this.#write(store); } catch (error) { this.credentials.remove?.(deviceCodeReference); throw error; }
      return { operationId, userCode, verificationUri, authorizationUrl: verificationUri, expiresAt, intervalSeconds, scopes: normalizedScopes };
    });
  }

  pollGitHub(workspaceKey: string, operationId: string): Promise<GitHubDeviceAuthPollResult> {
    return this.#run(async () => {
      this.#assertReady();
      if (!OPERATION_ID.test(operationId)) throw new Error("Channel authorization operation id is invalid.");
      const store = await this.#read();
      const pending = store.pending.find((item) => item.operationId === operationId && item.workspaceKey === workspaceKey);
      if (!pending) throw new Error("Channel authorization operation was not found for this workspace.");
      if (Date.parse(pending.expiresAt) <= this.now()) {
        this.credentials.remove?.(pending.deviceCodeReference);
        store.pending = store.pending.filter((item) => item.operationId !== operationId);
        await this.#write(store);
        return { status: "expired", operationId, message: "GitHub device authorization expired." };
      }
      const deviceCode = this.credentials.unprotect(pending.deviceCodeReference);
      if (!deviceCode) throw new Error("The pending GitHub device credential is unavailable or locked.");
      const response = await this.#request("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.githubClientId!, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      });
      if (response.error === "authorization_pending" || response.error === "slow_down") {
        const slow = response.error === "slow_down";
        if (slow) pending.intervalSeconds = Math.min(60, pending.intervalSeconds + 5);
        await this.#write(store);
        return { status: slow ? "slow_down" : "pending", operationId, intervalSeconds: pending.intervalSeconds, expiresAt: pending.expiresAt };
      }
      if (response.error === "access_denied" || response.error === "expired_token") {
        this.credentials.remove?.(pending.deviceCodeReference);
        store.pending = store.pending.filter((item) => item.operationId !== operationId);
        await this.#write(store);
        return { status: response.error === "access_denied" ? "denied" : "expired", operationId, message: response.error === "access_denied" ? "GitHub device authorization was denied." : "GitHub device authorization expired." };
      }
      const accessToken = requiredString(response.access_token, "GitHub token response is missing access_token.", 4096);
      const tokenReference = this.credentials.protect(accessToken);
      if (!tokenReference) throw new Error("The system credential store is unavailable or locked.");
      try {
        const user = await this.#request("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": "2022-11-28" } });
        const accountId = String(boundedInteger(user.id, 1, Number.MAX_SAFE_INTEGER, "GitHub user id is invalid."));
        const accountLabel = requiredString(user.login, "GitHub user login is missing.", 100);
        const configuredAt = new Date(this.now()).toISOString();
        for (const prior of store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "github-connector")) this.credentials.remove?.(prior.tokenReference);
        store.credentials = [{ workspaceKey, adapterId: "github-connector", tokenReference, accountId, accountLabel, scopes: pending.scopes, configuredAt }, ...store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "github-connector")];
        store.pending = store.pending.filter((item) => item.operationId !== operationId);
        await this.#write(store);
        this.credentials.remove?.(pending.deviceCodeReference);
        return { status: "complete", operationId, accountId, accountLabel, scopes: pending.scopes, configuredAt };
      } catch (error) { this.credentials.remove?.(tokenReference); throw error; }
    });
  }

  revokeGitHub(workspaceKey: string): Promise<boolean> {
    return this.#run(async () => {
      const store = await this.#read();
      const pending = store.pending.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "github-connector");
      const configured = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "github-connector");
      for (const item of pending) this.credentials.remove?.(item.deviceCodeReference);
      for (const item of configured) this.credentials.remove?.(item.tokenReference);
      store.pending = store.pending.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "github-connector");
      store.credentials = store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "github-connector");
      await this.#write(store);
      return pending.length + configured.length > 0;
    });
  }

  async githubCredential(workspaceKey: string): Promise<{ token: string; accountId: string; accountLabel: string; scopes: string[]; configuredAt: string } | null> {
    const store = await this.#read();
    const record = store.credentials.find((item) => item.workspaceKey === workspaceKey && item.adapterId === "github-connector");
    if (!record) return null;
    const token = this.credentials.unprotect(record.tokenReference);
    if (!token) throw new Error("The GitHub credential is unavailable or locked.");
    return { token, accountId: record.accountId, accountLabel: record.accountLabel, scopes: record.scopes, configuredAt: record.configuredAt };
  }

  async githubApi(workspaceKey: string, path: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}): Promise<Record<string, unknown> | unknown[]> {
    if (!/^\/repos\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/(?:issues(?:\/comments|\/\d+\/comments)?|pulls)(?:\?[A-Za-z0-9_.~%&=+-]+)?$/.test(path)) throw new Error("GitHub provider API path is invalid.");
    const credential = await this.githubCredential(workspaceKey);
    if (!credential) throw new Error("GitHub connector authorization is required.");
    return this.#request(`https://api.github.com${path}`, {
      method: init.method ?? "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${credential.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    }, true);
  }

  configureSlack(workspaceKey: string, token: string): Promise<{ accountId: string; accountLabel: string; scopes: string[]; configuredAt: string }> {
    return this.#run(async () => {
      if (!this.credentials.available()) throw new Error("The system credential store is unavailable or locked.");
      const normalizedToken = requiredSecret(token, "Slack bot token is invalid.");
      const profile = await this.#slackRequest(normalizedToken, "auth.test");
      const accountId = requiredString(profile.user_id ?? profile.bot_id, "Slack auth response is missing user identity.", 100);
      const team = requiredString(profile.team, "Slack auth response is missing team name.", 200);
      const user = typeof profile.user === "string" && profile.user.trim() ? profile.user.trim() : accountId;
      const accountLabel = `${team} / ${user}`.slice(0, 240);
      const tokenReference = this.credentials.protect(normalizedToken);
      if (!tokenReference) throw new Error("The system credential store is unavailable or locked.");
      const configuredAt = new Date(this.now()).toISOString();
      const store = await this.#read();
      const priorReferences = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "slack-chat").map((item) => item.tokenReference);
      try {
        store.credentials = [{ workspaceKey, adapterId: "slack-chat", tokenReference, accountId, accountLabel, scopes: ["channels:history", "groups:history", "chat:write"], configuredAt }, ...store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "slack-chat")];
        await this.#write(store);
      } catch (error) { this.credentials.remove?.(tokenReference); throw error; }
      for (const priorReference of priorReferences) this.credentials.remove?.(priorReference);
      return { accountId, accountLabel, scopes: ["channels:history", "groups:history", "chat:write"], configuredAt };
    });
  }

  revokeSlack(workspaceKey: string): Promise<boolean> {
    return this.#run(async () => {
      const store = await this.#read();
      const configured = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "slack-chat");
      for (const item of configured) this.credentials.remove?.(item.tokenReference);
      store.credentials = store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "slack-chat");
      await this.#write(store);
      return configured.length > 0;
    });
  }

  async slackApi(workspaceKey: string, method: "conversations.history" | "chat.postMessage", body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const store = await this.#read();
    const record = store.credentials.find((item) => item.workspaceKey === workspaceKey && item.adapterId === "slack-chat");
    if (!record) throw new Error("Slack connector authorization is required.");
    const token = this.credentials.unprotect(record.tokenReference);
    if (!token) throw new Error("The Slack credential is unavailable or locked.");
    return this.#slackRequest(token, method, body);
  }

  configureGoogleDocs(workspaceKey: string, token: string): Promise<{ accountId: string; accountLabel: string; scopes: string[]; configuredAt: string; expiresAt: string }> {
    return this.#run(async () => {
      if (!this.credentials.available()) throw new Error("The system credential store is unavailable or locked.");
      const normalizedToken = requiredGoogleToken(token);
      const profile = await this.#request("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: normalizedToken }) }, false, "Google");
      const scopes = typeof profile.scope === "string" ? profile.scope.split(/\s+/).filter(Boolean) : [];
      if (!scopes.includes("https://www.googleapis.com/auth/documents")) throw new Error("Google Docs read/write scope is required.");
      const expiresIn = boundedInteger(profile.expires_in, 60, 86_400, "Google access token expiry is invalid.");
      const accountId = requiredString(profile.sub ?? profile.email ?? profile.aud, "Google token identity is missing.", 300);
      const accountLabel = requiredString(profile.email ?? profile.aud, "Google token account label is missing.", 300);
      const tokenReference = this.credentials.protect(normalizedToken);
      if (!tokenReference) throw new Error("The system credential store is unavailable or locked.");
      const configuredAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(this.now() + expiresIn * 1000).toISOString();
      const store = await this.#read();
      const priorReferences = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "docs-connector").map((item) => item.tokenReference);
      try {
        store.credentials = [{ workspaceKey, adapterId: "docs-connector", tokenReference, accountId, accountLabel, scopes, configuredAt, expiresAt }, ...store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "docs-connector")];
        await this.#write(store);
      } catch (error) { this.credentials.remove?.(tokenReference); throw error; }
      for (const priorReference of priorReferences) this.credentials.remove?.(priorReference);
      return { accountId, accountLabel, scopes, configuredAt, expiresAt };
    });
  }

  revokeGoogleDocs(workspaceKey: string): Promise<boolean> {
    return this.#run(async () => {
      const store = await this.#read();
      const configured = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "docs-connector");
      for (const item of configured) this.credentials.remove?.(item.tokenReference);
      store.credentials = store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "docs-connector");
      await this.#write(store);
      return configured.length > 0;
    });
  }

  async googleDocsApi(workspaceKey: string, documentId: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(documentId)) throw new Error("Google document ID is invalid.");
    const store = await this.#read();
    const record = store.credentials.find((item) => item.workspaceKey === workspaceKey && item.adapterId === "docs-connector");
    if (!record) throw new Error("Docs connector authorization is required.");
    if (record.expiresAt && Date.parse(record.expiresAt) <= this.now()) throw new Error("Google Docs authorization expired; configure a fresh access token.");
    const token = this.credentials.unprotect(record.tokenReference);
    if (!token) throw new Error("The Google Docs credential is unavailable or locked.");
    const suffix = init.method === "POST" ? ":batchUpdate" : "";
    return this.#request(`https://docs.googleapis.com/v1/documents/${documentId}${suffix}`, { method: init.method ?? "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) }, false, "Google Docs");
  }

  configureGoogleCalendar(workspaceKey: string, token: string): Promise<{ accountId: string; accountLabel: string; scopes: string[]; configuredAt: string; expiresAt: string }> {
    return this.#run(async () => {
      if (!this.credentials.available()) throw new Error("The system credential store is unavailable or locked.");
      const normalizedToken = requiredGoogleToken(token);
      const profile = await this.#request("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: normalizedToken }) }, false, "Google");
      const scopes = typeof profile.scope === "string" ? profile.scope.split(/\s+/).filter(Boolean) : [];
      if (!scopes.some((scope) => scope === "https://www.googleapis.com/auth/calendar.readonly" || scope === "https://www.googleapis.com/auth/calendar")) throw new Error("Google Calendar read scope is required.");
      const expiresIn = boundedInteger(profile.expires_in, 60, 86_400, "Google access token expiry is invalid.");
      const accountId = requiredString(profile.sub ?? profile.email ?? profile.aud, "Google token identity is missing.", 300);
      const accountLabel = requiredString(profile.email ?? profile.aud, "Google token account label is missing.", 300);
      const tokenReference = this.credentials.protect(normalizedToken);
      if (!tokenReference) throw new Error("The system credential store is unavailable or locked.");
      const configuredAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(this.now() + expiresIn * 1000).toISOString();
      const store = await this.#read();
      const priorReferences = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "calendar-connector").map((item) => item.tokenReference);
      try {
        store.credentials = [{ workspaceKey, adapterId: "calendar-connector", tokenReference, accountId, accountLabel, scopes, configuredAt, expiresAt }, ...store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "calendar-connector")];
        await this.#write(store);
      } catch (error) { this.credentials.remove?.(tokenReference); throw error; }
      for (const priorReference of priorReferences) this.credentials.remove?.(priorReference);
      return { accountId, accountLabel, scopes, configuredAt, expiresAt };
    });
  }

  revokeGoogleCalendar(workspaceKey: string): Promise<boolean> {
    return this.#run(async () => {
      const store = await this.#read();
      const configured = store.credentials.filter((item) => item.workspaceKey === workspaceKey && item.adapterId === "calendar-connector");
      for (const item of configured) this.credentials.remove?.(item.tokenReference);
      store.credentials = store.credentials.filter((item) => item.workspaceKey !== workspaceKey || item.adapterId !== "calendar-connector");
      await this.#write(store);
      return configured.length > 0;
    });
  }

  async googleCalendarApi(workspaceKey: string, calendarId: string, query: { timeMin: string; timeMax: string; maxResults: number }): Promise<Record<string, unknown>> {
    if (!validCalendarId(calendarId)) throw new Error("Google Calendar ID is invalid.");
    const store = await this.#read();
    const record = store.credentials.find((item) => item.workspaceKey === workspaceKey && item.adapterId === "calendar-connector");
    if (!record) throw new Error("Calendar connector authorization is required.");
    if (record.expiresAt && Date.parse(record.expiresAt) <= this.now()) throw new Error("Google Calendar authorization expired; configure a fresh access token.");
    const token = this.credentials.unprotect(record.tokenReference);
    if (!token) throw new Error("The Google Calendar credential is unavailable or locked.");
    const search = new URLSearchParams({ timeMin: query.timeMin, timeMax: query.timeMax, maxResults: String(query.maxResults), singleEvents: "true", orderBy: "startTime" });
    return this.#request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${search}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } }, false, "Google Calendar");
  }

  async #slackRequest(token: string, method: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.#request(`https://slack.com/api/${method}`, { method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body ?? {}) }, false, "Slack");
    if (response.ok !== true) {
      const code = typeof response.error === "string" && /^[a-z0-9_]{1,80}$/.test(response.error) ? response.error : "provider_error";
      throw new Error(`Slack request failed: ${code}.`);
    }
    return response;
  }

  #assertReady(): void {
    if (!this.githubClientId || !/^[A-Za-z0-9_-]{8,200}$/.test(this.githubClientId)) throw new Error("GitHub Device OAuth is not configured for this desktop build.");
    if (!this.credentials.available()) throw new Error("The system credential store is unavailable or locked.");
  }

  async #request(url: string, init: RequestInit, allowArray?: false, provider?: string): Promise<Record<string, unknown>>;
  async #request(url: string, init: RequestInit, allowArray: true, provider?: string): Promise<Record<string, unknown> | unknown[]>;
  async #request(url: string, init: RequestInit, allowArray = false, provider = "GitHub"): Promise<Record<string, unknown> | unknown[]> {
    const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error(`${provider} response exceeded the allowed size.`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`${provider} response exceeded the allowed size.`);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error(`${provider} returned an invalid JSON response.`); }
    if (!response.ok || !parsed || typeof parsed !== "object" || (!allowArray && Array.isArray(parsed))) throw new Error(`${provider} request failed with HTTP ${response.status}.`);
    return parsed as Record<string, unknown> | unknown[];
  }

  async #read(): Promise<AuthStore> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, "utf8")) as Partial<AuthStore>;
      return { schemaVersion: 1, pending: Array.isArray(parsed.pending) ? parsed.pending.filter(validPending) : [], credentials: Array.isArray(parsed.credentials) ? parsed.credentials.filter(validCredential) : [] };
    } catch { return { schemaVersion: 1, pending: [], credentials: [] }; }
  }

  async #write(store: AuthStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, this.storePath); }
    finally { await rm(temporary, { force: true }); }
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function normalizeScopes(scopes: string[]): string[] {
  const result = scopes.map((item) => item.trim()).filter((item, index, all) => /^(?:read:user|repo|public_repo|read:org)$/.test(item) && all.indexOf(item) === index).slice(0, 8);
  return result.length ? result : ["read:user", "repo"];
}
function requiredString(value: unknown, message: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new Error(message); return value.trim(); }
function boundedInteger(value: unknown, min: number, max: number, message: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(message); return number; }
function safeGitHubUrl(value: unknown, fallback: string): string { const raw = typeof value === "string" ? value : fallback; const url = new URL(raw); if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) throw new Error("GitHub verification URL is invalid."); return url.toString(); }
function validPending(value: PendingAuth): boolean { return Boolean(value && OPERATION_ID.test(value.operationId) && value.adapterId === "github-connector" && typeof value.workspaceKey === "string" && typeof value.deviceCodeReference === "string" && Array.isArray(value.scopes)); }
function validCredential(value: ProviderCredential): boolean { return Boolean(value && (value.adapterId === "github-connector" || value.adapterId === "slack-chat" || value.adapterId === "docs-connector" || value.adapterId === "calendar-connector") && typeof value.workspaceKey === "string" && typeof value.tokenReference === "string" && typeof value.accountId === "string" && typeof value.accountLabel === "string" && Array.isArray(value.scopes) && (value.expiresAt === undefined || typeof value.expiresAt === "string")); }
function requiredSecret(value: unknown, message: string): string { if (typeof value !== "string") throw new Error(message); const token = value.trim(); if (!/^xox[baprs]-[A-Za-z0-9-]{10,4000}$/.test(token)) throw new Error(message); return token; }
function requiredGoogleToken(value: unknown): string { if (typeof value !== "string") throw new Error("Google OAuth access token is invalid."); const token = value.trim(); if (!/^ya29\.[A-Za-z0-9._-]{20,4000}$/.test(token)) throw new Error("Google OAuth access token is invalid."); return token; }
function validCalendarId(value: string): boolean { return value === "primary" || (/^[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,200}$/.test(value) && !/[\r\n\0]/.test(value)); }
