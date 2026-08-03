import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DRSAI_HOME } from "./paths";

const IDENTITY_FILE = join(DRSAI_HOME, "identity.json");
const MAX_USER_ID_CHARS = 200;
const UNSTABLE_USER_IDS = new Set(["anonymous", "desktop", "u1", "developer-local"]);

export interface DesktopIdentity {
  canonicalUserId: string;
  aliases: string[];
  updatedAt: string;
}

/** Prefer a single durable user id for DB / gateway writes (OIDC subject when available). */
export function resolveCanonicalUserId(candidate?: string | null): string | null {
  const normalized = normalizeUserId(candidate);
  const identity = readIdentity();
  if (!identity?.canonicalUserId) return normalized;
  if (!normalized) return identity.canonicalUserId;
  if (
    normalized === identity.canonicalUserId ||
    identity.aliases.includes(normalized)
  ) {
    return identity.canonicalUserId;
  }
  return normalized;
}

/**
 * Bind the signed-in principal into ~/.drsai/identity.json.
 * Upgrades unstable/email ids to OIDC UUID; keeps prior unstable ids as migration aliases.
 */
export function bindCanonicalUserId(candidate?: string | null): DesktopIdentity | null {
  const normalized = normalizeUserId(candidate);
  if (!normalized || isUnstableUserId(normalized)) return readIdentity();

  const existing = readIdentity();
  if (!existing) {
    return writeIdentity({
      canonicalUserId: normalized,
      aliases: ["anonymous"],
      updatedAt: new Date().toISOString(),
    });
  }

  if (existing.canonicalUserId === normalized) {
    const aliases = uniqueStrings([...existing.aliases, "anonymous"]).filter(
      (item) => item !== normalized,
    );
    if (aliases.length === existing.aliases.length) return existing;
    return writeIdentity({ ...existing, aliases, updatedAt: new Date().toISOString() });
  }

  if (isPreferredUserId(normalized) && !isPreferredUserId(existing.canonicalUserId)) {
    return writeIdentity({
      canonicalUserId: normalized,
      aliases: uniqueStrings([
        ...existing.aliases,
        existing.canonicalUserId,
        "anonymous",
      ]).filter((item) => item !== normalized),
      updatedAt: new Date().toISOString(),
    });
  }

  if (!isPreferredUserId(normalized) && isPreferredUserId(existing.canonicalUserId)) {
    return writeIdentity({
      ...existing,
      aliases: uniqueStrings([...existing.aliases, normalized, "anonymous"]).filter(
        (item) => item !== existing.canonicalUserId,
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  // Distinct stable principals (account switch): do not rewrite the previous user's rows.
  return writeIdentity({
    canonicalUserId: normalized,
    aliases: uniqueStrings([
      "anonymous",
      ...existing.aliases.filter((item) => isUnstableUserId(item)),
    ]).filter((item) => item !== normalized),
    updatedAt: new Date().toISOString(),
  });
}

export function listIdentityMigrationSources(canonicalUserId?: string | null): string[] {
  const identity = readIdentity();
  const canonical = normalizeUserId(canonicalUserId) || identity?.canonicalUserId;
  const aliases = identity?.aliases ?? [];
  return uniqueStrings(["anonymous", ...aliases]).filter((item) => item && item !== canonical);
}

export function readIdentity(): DesktopIdentity | null {
  try {
    if (!existsSync(IDENTITY_FILE)) return null;
    const parsed = JSON.parse(readFileSync(IDENTITY_FILE, "utf8")) as Partial<DesktopIdentity>;
    const canonicalUserId = normalizeUserId(parsed.canonicalUserId);
    if (!canonicalUserId) return null;
    return {
      canonicalUserId,
      aliases: Array.isArray(parsed.aliases)
        ? uniqueStrings(parsed.aliases.map((item) => normalizeUserId(item)).filter(Boolean) as string[])
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function normalizeUserId(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_USER_ID_CHARS || /[\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

export function isUnstableUserId(userId: string): boolean {
  const normalized = userId.trim().toLowerCase();
  if (!normalized) return true;
  if (UNSTABLE_USER_IDS.has(normalized)) return true;
  if (normalized.startsWith("local-api-")) return false; // stable for a given API key fingerprint
  return false;
}

function isPreferredUserId(userId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId.trim(),
  );
}

function writeIdentity(identity: DesktopIdentity): DesktopIdentity {
  mkdirSync(dirname(IDENTITY_FILE), { recursive: true });
  const temporaryFile = `${IDENTITY_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryFile, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryFile, IDENTITY_FILE);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
  return identity;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
