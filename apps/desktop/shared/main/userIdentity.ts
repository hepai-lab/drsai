import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { DRSAI_HOME } from "./paths";

const ALIASES_FILE = join(DRSAI_HOME, "auth", "user-aliases.json");
const LOCAL_IDENTITY_FILE = join(DRSAI_HOME, "auth", "local-identity.json");

const BUILTIN_UNSTABLE_USER_IDS = [
  "anonymous",
  "desktop",
  "desktop-debug",
  "developer-local",
  "test",
  "u1",
  "opendrsai-smoke",
  "gateway-smoke",
] as const;

interface UserAliasStore {
  version: 1;
  /**
   * Maps historical / unstable user_id values onto the canonical id that should
   * own them on this machine (usually the OIDC subject).
   */
  aliases: Record<string, string>;
  updatedAt?: string;
}

interface LocalIdentityStore {
  version: 1;
  userId: string;
  createdAt: string;
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function normalizeIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

export function isUnstableUserId(userId: string): boolean {
  const trimmed = userId.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if ((BUILTIN_UNSTABLE_USER_IDS as readonly string[]).includes(lower)) return true;
  if (lower.startsWith("local-api-")) return true;
  if (lower === "servi" || lower === homedir().split(/[/\\]/).filter(Boolean).at(-1)?.toLowerCase()) {
    return true;
  }
  return false;
}

export function getOrCreateStableLocalUserId(): string {
  const existing = readJsonFile<LocalIdentityStore>(LOCAL_IDENTITY_FILE);
  const current = normalizeIdentity(existing?.userId);
  if (current) return current;
  const created: LocalIdentityStore = {
    version: 1,
    userId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(LOCAL_IDENTITY_FILE, created);
  return created.userId;
}

export function rememberUserIdAlias(alias: string, canonicalUserId: string): void {
  const from = normalizeIdentity(alias);
  const to = normalizeIdentity(canonicalUserId);
  if (!from || !to || from === to) return;
  const store = readJsonFile<UserAliasStore>(ALIASES_FILE) ?? { version: 1, aliases: {} };
  if (store.aliases[from] === to) return;
  store.aliases[from] = to;
  store.updatedAt = new Date().toISOString();
  writeJsonFile(ALIASES_FILE, store);
}

export function listKnownAliases(canonicalUserId: string): string[] {
  const canonical = normalizeIdentity(canonicalUserId);
  if (!canonical) return [];
  const store = readJsonFile<UserAliasStore>(ALIASES_FILE);
  const aliases = new Set<string>();
  for (const value of BUILTIN_UNSTABLE_USER_IDS) aliases.add(value);
  const osUser = process.env.USERNAME || process.env.USER;
  if (osUser?.trim()) aliases.add(osUser.trim());
  if (store?.aliases) {
    for (const [alias, target] of Object.entries(store.aliases)) {
      if (target === canonical || isUnstableUserId(alias)) aliases.add(alias);
    }
  }
  aliases.delete(canonical);
  return [...aliases].filter(Boolean);
}

/**
 * Collect every historical identity that should be rewritten to the canonical
 * OIDC/desktop user on this machine.
 */
export function collectMigrationAliases(input: {
  canonicalUserId: string;
  email?: string | null;
  previousCliUserId?: string | null;
}): string[] {
  const canonical = normalizeIdentity(input.canonicalUserId);
  if (!canonical) return [];
  const aliases = new Set(listKnownAliases(canonical));
  const email = normalizeIdentity(input.email ?? undefined);
  if (email && email !== canonical) {
    aliases.add(email);
    rememberUserIdAlias(email, canonical);
  }
  const previous = normalizeIdentity(input.previousCliUserId ?? undefined);
  if (previous && previous !== canonical) {
    aliases.add(previous);
    rememberUserIdAlias(previous, canonical);
  }
  const localStable = normalizeIdentity(readJsonFile<LocalIdentityStore>(LOCAL_IDENTITY_FILE)?.userId);
  if (localStable && localStable !== canonical) {
    aliases.add(localStable);
    rememberUserIdAlias(localStable, canonical);
  }
  aliases.delete(canonical);
  return [...aliases];
}
