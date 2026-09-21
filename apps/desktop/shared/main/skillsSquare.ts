/**
 * Skills Square bridge for Desktop Electron main process.
 *
 * Catalog authority: WebUI / platform at `{skillsApiBase}/api/skills*` (same DB as WebUI).
 * Runtime install: local desktop gateway `/v1/skills` + `writeZipBufferAndInstall`.
 *
 * Auth: HepAI OIDC only (Bearer + X-OpenDrSai-Auth-Mode + X-OpenDrSai-Principal email).
 * No HepAI API key for Skills Square. Skills host must resolve OIDC to account email
 * (see WebUI identity.py); Desktop filters「我的」by current session email.
 *
 * Base URL: OPENDRSAI_SKILLS_API_BASE_URL override, else environment default
 * (test: drsaiv2 / production: opendrsai). Not the HepAI portal — portal has no
 * /api/skills*.
 */

import { basename, join } from "node:path";
import {
  getAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
} from "./auth";
import { isDesktopDevelopment } from "./desktopRuntimeMode";
import { readDurableJson, writeDurableJson } from "./durableJsonStore";
import { DRSAI_HOME } from "./paths";
import { getActivePlatformConfig } from "./platformConfig";
import { writeZipBufferAndInstall, sanitizeInstallName } from "./skillArchive";
import { installSkill, listInstalledSkills, reloadSkills } from "./gatewayManagedResources";

/** WebUI Skills Square hosts (not HepAI ai / ai-dev portal). */
export const SKILLS_SQUARE_TEST_API_ROOT = "https://drsaiv2.ihep.ac.cn";
export const SKILLS_SQUARE_PRODUCTION_API_ROOT = "https://opendrsai.ihep.ac.cn";

// ── Exported types (copy into desktopApi when wiring IPC) ───────────────────

export type SkillsSquareStatusState = "ready" | "requires_login" | "forbidden" | "error";

export interface SkillsSquareStatus {
  state: SkillsSquareStatusState;
  message: string;
  authMode?: "oidc" | "none";
  lastCheckedAt: string;
  /** WebUI origin that hosts /share/skill/* (same as Skills API root). */
  portalUrl?: string;
}

export interface DesktopSquareSkill {
  slug: string;
  name: string;
  description: string;
  icon?: string;
  version?: string;
  owner?: string;
  ownerId?: string;
  author?: string;
  visibility?: string;
  source?: string;
  uskillsType?: string | null;
  tags?: string[];
  downloads?: number;
  collects?: number;
  collectorIds?: string[];
  isCollected?: boolean;
  canEdit?: boolean;
  profile?: string;
  changelog?: string;
  createdAt?: string;
  updatedAt?: string;
  installed: boolean;
  academicGroupId?: string;
}

export interface DesktopSquareSkillDetail extends DesktopSquareSkill {
  body: string;
  restricted?: boolean;
}

export interface DesktopSquareSkillsPage {
  items: DesktopSquareSkill[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  installedCount: number;
  notInstalledCount: number;
  status: SkillsSquareStatus;
}

export interface DesktopSquareSkillsListRequest {
  /** public square vs my skills */
  scope?: "public" | "user";
  page?: number;
  pageSize?: number;
  q?: string;
  tags?: string;
  sort?: "name" | "time" | "downloads" | "collects";
  installFilter?: "all" | "installed" | "not_installed";
  uskillsType?: "created" | "imported";
  visibility?: string;
  /** local gateway user id (OIDC sub) */
  userId?: string;
  /** for filtering my skills / share APIs */
  userEmail?: string;
}

export interface DesktopSquareSkillStats {
  totalSkills: number;
  publicSkills: number;
  totalDownloads: number;
  totalCollects: number;
}

export interface DesktopSquareSkillTag {
  id: number;
  uuid?: string;
  name: string;
  sortOrder?: number;
}

export interface DesktopSquareInstallRequest {
  slug: string;
  name?: string;
  userId?: string;
  threadId?: string;
}

export interface DesktopSquareUploadRequest {
  /** base64 zip bytes OR empty for collect */
  zipBase64?: string;
  fileName?: string;
  slug?: string;
  displayName?: string;
  icon?: string;
  description?: string;
  version?: string;
  changelog?: string;
  /** comma-separated */
  tags?: string;
  visibility?: "public" | "private" | "team";
  /** "imported" for collect */
  source?: string;
  owner?: string;
  ownerId?: string;
  profileBase64?: string;
  profileFileName?: string;
}

export interface DesktopSquareUpdateRequest {
  slug: string;
  zipBase64?: string;
  fileName?: string;
  displayName?: string;
  name?: string;
  icon?: string;
  description?: string;
  version?: string;
  changelog?: string;
  tags?: string;
  visibility?: string;
  profileBase64?: string;
  profileFileName?: string;
}

export interface DesktopSquareShareInfo {
  shareId: string;
  skillSlug?: string;
  hasPassword: boolean;
  expiresAt?: string;
  createdAt?: string;
  expired?: boolean;
  accessCount?: number;
  /** Absolute landing URL on the active Skills Square host (test=drsaiv2, prod=opendrsai). */
  shareUrl?: string;
}

/** Tag names that map to Higraf academic-group skill hub (case-insensitive). */
const ACADEMIC_GROUP_TAGS = new Set(["lhaaso"]);

const LIST_TIMEOUT_MS = 15_000;
const SKILL_MD_TIMEOUT_MS = 30_000;
const DOWNLOAD_UPLOAD_TIMEOUT_MS = 120_000;

// ── Auth / base URL ─────────────────────────────────────────────────────────

interface SkillsAuth {
  token: string | null;
  authMode: "oidc" | "none";
  /** Account email for X-OpenDrSai-Principal (Skills owner_id is email). */
  principal?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function statusOf(
  state: SkillsSquareStatusState,
  message: string,
  authMode: SkillsAuth["authMode"] = "none",
): SkillsSquareStatus {
  return {
    state,
    message,
    authMode,
    lastCheckedAt: nowIso(),
    portalUrl: resolveSkillsSquareApiRoot(),
  };
}

/** HepAI OIDC only — Skills Square never uses HepAI API key. */
async function resolveSkillsAuth(): Promise<SkillsAuth> {
  const principal = await resolveSkillsOperatorEmail();

  try {
    const auth = await requireAuthContext();
    if (auth.accessToken?.trim()) {
      return {
        token: auth.accessToken.trim(),
        authMode: "oidc",
        principal,
      };
    }
  } catch {
    // Not signed in via OIDC.
  }

  return { token: null, authMode: "none", principal };
}

/**
 * Publish / collect / update / delete: same OIDC session, but require account email
 * so the Skills host (via Principal / email claims) can stamp owner_id correctly.
 */
async function resolveSkillsWriteAuth(): Promise<SkillsAuth> {
  const oidc = await resolveSkillsAuth();
  if (!oidc.token) return oidc;
  if (!oidc.principal || !looksLikeEmail(oidc.principal)) {
    throw new Error(
      "Sign in with an account email before publishing or collecting skills.",
    );
  }
  return oidc;
}

function authHeaders(
  token: string | null,
  authMode: SkillsAuth["authMode"] = "none",
  json = true,
  principal?: string,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (authMode === "oidc" && token) {
    headers["X-OpenDrSai-Auth-Mode"] = "oidc";
    if (principal?.trim()) {
      headers["X-OpenDrSai-Principal"] = principal.trim();
    }
  }
  return headers;
}

/** True when Desktop launch / active platform is development (test WebUI). */
export function isSkillsSquareTestEnvironment(): boolean {
  const launchMode = process.env.OPENDRSAI_DESKTOP_LAUNCH_MODE?.trim().toLowerCase();
  if (launchMode === "development" || launchMode === "dev") return true;
  if (launchMode === "production" || launchMode === "prod") return false;
  const active = (
    process.env.OPENDRSAI_ACTIVE_PLATFORM?.trim() ||
    getActivePlatformConfig().name ||
    ""
  ).toLowerCase();
  if (active === "development" || active === "dev") return true;
  if (active === "production" || active === "prod") return false;
  return isDesktopDevelopment();
}

/** Skills catalog root: env override, else test (drsaiv2) / production (opendrsai). */
export function resolveSkillsSquareApiRoot(): string {
  const override = process.env.OPENDRSAI_SKILLS_API_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  // HepAI portal (ai / ai-dev) has no /api/skills* — only WebUI hosts do.
  return isSkillsSquareTestEnvironment()
    ? SKILLS_SQUARE_TEST_API_ROOT
    : SKILLS_SQUARE_PRODUCTION_API_ROOT;
}

/** Public share landing page — same host as the Skills Square API that created the row. */
export function buildSkillsSquareShareLandingUrl(shareId: string): string {
  const id = shareId.trim();
  if (!id) return "";
  return `${resolveSkillsSquareApiRoot()}/share/skill/${encodeURIComponent(id)}`;
}

function mapShareInfo(
  raw: Record<string, unknown>,
  slug: string,
): DesktopSquareShareInfo {
  const shareId = asString(raw.share_id) || asString(raw.shareId) || "";
  return {
    shareId,
    skillSlug: slug,
    hasPassword: Boolean(raw.has_password ?? raw.hasPassword),
    expiresAt: asString(raw.expires_at) || asString(raw.expiresAt),
    createdAt: asString(raw.created_at) || asString(raw.createdAt),
    expired: typeof raw.expired === "boolean" ? raw.expired : undefined,
    accessCount: asNumber(raw.access_count) ?? asNumber(raw.accessCount),
    shareUrl: shareId ? buildSkillsSquareShareLandingUrl(shareId) : undefined,
  };
}

async function resolveSkillsUserId(explicit?: string): Promise<string | undefined> {
  // The gateway's `effective_user_id` keys the skills directory by the verified
  // OIDC subject. Aliases (e.g. the operator email) trigger subject_mismatch
  // 403, so mirror gatewayManagedResources.skillsUserId: subject first.
  const session = await getAuthSession().catch(() => null);
  const subject = session?.user?.id?.trim() || "";
  if (subject) return subject;
  const value = explicit?.trim();
  if (value) return value;
  return session?.user?.email?.trim() || undefined;
}

async function resolveOperatorEmail(explicit?: string): Promise<string | undefined> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  try {
    const session = await getAuthSession();
    return session.user?.email?.trim() || session.user?.id?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Gateway helpers ─────────────────────────────────────────────────────────

async function listInstalledSkillNames(userId?: string): Promise<Set<string>> {
  // Must share the install path's user scope: gatewayManagedResources resolves
  // the verified OIDC subject first. The previous direct
  // `GET /v1/skills?user_id=<operator email>` asked for the email alias, hit
  // subject_mismatch 403 and the catch swallowed it into an empty set — which
  // is why every square skill showed up as "not installed".
  try {
    const installed = await listInstalledSkills(userId);
    const names = new Set<string>();
    for (const skill of installed ?? []) {
      // /v1/skills reports the SKILL.md frontmatter name, while the directory
      // on disk is keyed by the sanitized install name. Keep both so square
      // entries match regardless of which writer produced the row.
      const frontmatterName = skill?.name?.trim();
      if (frontmatterName) names.add(frontmatterName.toLowerCase());
      const dirName = skill?.path ? basename(skill.path).trim() : "";
      if (dirName) names.add(dirName.toLowerCase());
    }
    return names;
  } catch {
    return new Set<string>();
  }
}

// ── Platform (WebUI) helpers ────────────────────────────────────────────────

class SkillsSquareHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, path: string, bodyText: string) {
    super(`WebUI ${path} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "SkillsSquareHttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

function statusFromHttpError(
  err: unknown,
  authMode: SkillsAuth["authMode"],
): SkillsSquareStatus {
  if (err instanceof SkillsSquareHttpError) {
    if (err.status === 401) {
      return statusOf(
        "requires_login",
        "HepAI OIDC session required for Skills Square.",
        authMode,
      );
    }
    if (err.status === 403) {
      return statusOf("forbidden", "This account cannot access Skills Square.", authMode);
    }
    return statusOf("error", err.message, authMode);
  }
  const message = err instanceof Error ? err.message : String(err);
  return statusOf("error", message, authMode);
}

async function platformFetchText(
  pathWithQuery: string,
  options: {
    method?: string;
    token?: string | null;
    auth?: SkillsAuth;
    body?: BodyInit | null;
    headers?: Record<string, string>;
    timeoutMs?: number;
    /** When true, do not force Content-Type: application/json (multipart). */
    multipart?: boolean;
    /** Skip OIDC refresh retry (internal). */
    _retried?: boolean;
  } = {},
): Promise<{ response: Response; text: string }> {
  const root = resolveSkillsSquareApiRoot();
  if (!root) {
    throw new Error("Skills Square API base URL is not configured.");
  }
  const url = new URL(pathWithQuery.startsWith("http") ? pathWithQuery : `${root}${pathWithQuery}`);

  let auth = options.auth;
  let token = options.token ?? auth?.token ?? null;
  let authMode = auth?.authMode ?? (token ? "oidc" : "none");
  let principal = auth?.principal;

  const buildHeaders = (bearer: string | null, mode: SkillsAuth["authMode"]): Record<string, string> => {
    const headers = {
      ...authHeaders(bearer, mode, !options.multipart, principal),
      ...(options.headers ?? {}),
    };
    if (options.multipart) {
      delete headers["Content-Type"];
    }
    return headers;
  };

  let response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: buildHeaders(token, authMode),
    body: options.body ?? undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? LIST_TIMEOUT_MS),
  });

  // OIDC: refresh once on 401, then retry.
  if (response.status === 401 && authMode === "oidc" && !options._retried) {
    try {
      const refreshed = await Promise.race([
        refreshAuthContextAfterUnauthorized(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 8_000);
        }),
      ]);
      if (refreshed?.accessToken?.trim()) {
        token = refreshed.accessToken.trim();
        auth = { token, authMode: "oidc", principal };
        authMode = "oidc";
        response = await fetch(url.toString(), {
          method: options.method ?? "GET",
          headers: buildHeaders(token, authMode),
          body: options.body ?? undefined,
          signal: AbortSignal.timeout(options.timeoutMs ?? LIST_TIMEOUT_MS),
        });
      }
    } catch {
      // Keep original 401 response.
    }
  }

  const text = await response.text();
  if (!response.ok) {
    throw new SkillsSquareHttpError(response.status, url.pathname, text);
  }
  return { response, text };
}

async function platformFetchJson<T>(
  pathWithQuery: string,
  options: Parameters<typeof platformFetchText>[1] = {},
): Promise<T> {
  const { text } = await platformFetchText(pathWithQuery, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`WebUI response not JSON: ${text.slice(0, 200)}`);
  }
}

async function platformFetchBuffer(
  pathWithQuery: string,
  options: {
    token?: string | null;
    auth?: SkillsAuth;
    timeoutMs?: number;
  } = {},
): Promise<Buffer> {
  const root = resolveSkillsSquareApiRoot();
  if (!root) {
    throw new Error("Skills Square API base URL is not configured.");
  }
  const url = new URL(`${root}${pathWithQuery}`);

  let token = options.token ?? options.auth?.token ?? null;
  let authMode = options.auth?.authMode ?? (token ? "oidc" : "none");
  const principal = options.auth?.principal;

  const buildHeaders = (bearer: string | null, mode: SkillsAuth["authMode"]): Record<string, string> => {
    const headers: Record<string, string> = {
      Accept: "application/zip, application/octet-stream, */*",
    };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (mode === "oidc" && bearer) {
      headers["X-OpenDrSai-Auth-Mode"] = "oidc";
      if (principal?.trim()) {
        headers["X-OpenDrSai-Principal"] = principal.trim();
      }
    }
    return headers;
  };

  let response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(token, authMode),
    signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_UPLOAD_TIMEOUT_MS),
  });

  if (response.status === 401 && authMode === "oidc") {
    try {
      const refreshed = await Promise.race([
        refreshAuthContextAfterUnauthorized(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 8_000);
        }),
      ]);
      if (refreshed?.accessToken?.trim()) {
        token = refreshed.accessToken.trim();
        authMode = "oidc";
        response = await fetch(url.toString(), {
          method: "GET",
          headers: buildHeaders(token, authMode),
          signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_UPLOAD_TIMEOUT_MS),
        });
      }
    } catch {
      // Keep original 401.
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SkillsSquareHttpError(response.status, url.pathname, text);
  }
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}

function requireApiPayload<T extends { status?: boolean; message?: string; detail?: unknown; data?: unknown }>(
  data: T,
  fallback: string,
): T {
  if (data && data.status === false) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : typeof data.message === "string"
          ? data.message
          : fallback;
    throw new Error(detail);
  }
  return data;
}

function decodeBase64ToBuffer(value: string): Buffer {
  const cleaned = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(cleaned, "base64");
}

function bufferToBlob(buf: Buffer, mime = "application/octet-stream"): Blob {
  // Copy into a standalone ArrayBuffer so BlobPart typing stays happy under
  // Node's Buffer / SharedArrayBuffer union.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Blob([copy], { type: mime });
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

// @ts-expect-error: kept for future use
function _normalizeIdentity(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function looksLikeEmail(value: string | undefined): boolean {
  const v = (value || "").trim();
  return Boolean(v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

/**
 * Skills Square user_id / collector identity must be the HepAI email
 * (same as WebUI). Never fall back to an OIDC subject UUID for *stamping*
 * owner fields — but listing may also match subject (see SkillsActorIds).
 */
async function resolveSkillsOperatorEmail(
  explicitEmail?: string,
  explicitUserId?: string,
): Promise<string | undefined> {
  if (looksLikeEmail(explicitEmail)) return explicitEmail!.trim();
  if (looksLikeEmail(explicitUserId)) return explicitUserId!.trim();
  try {
    const session = await getAuthSession();
    if (looksLikeEmail(session.user?.email)) return session.user!.email!.trim();
    if (looksLikeEmail(session.user?.id)) return session.user!.id!.trim();
  } catch {
    /* ignore */
  }
  const fallback = await resolveOperatorEmail(explicitEmail);
  return looksLikeEmail(fallback) ? fallback : undefined;
}

/**
 * Skills Square actor identities for the current Desktop session.
 * Hosts often stamp collector_ids/owner_id as OIDC subject UUID while WebUI
 * uses account email — match either, never hard-code an account.
 */
type SkillsActorIds = {
  email?: string;
  /** OIDC subject (non-email user.id) */
  subject?: string;
};

async function resolveSkillsActorIds(
  explicitEmail?: string,
  explicitUserId?: string,
): Promise<SkillsActorIds> {
  const email = await resolveSkillsOperatorEmail(explicitEmail, explicitUserId);
  let subject: string | undefined;
  try {
    const session = await getAuthSession();
    const id = session.user?.id?.trim();
    if (id && !looksLikeEmail(id)) subject = id;
  } catch {
    /* ignore */
  }
  if (explicitUserId?.trim() && !looksLikeEmail(explicitUserId)) {
    subject = explicitUserId.trim();
  }
  return { email, subject };
}

function actorNeedles(actors: SkillsActorIds): string[] {
  const out: string[] = [];
  if (actors.email?.trim()) out.push(actors.email.trim().toLowerCase());
  if (actors.subject?.trim()) out.push(actors.subject.trim().toLowerCase());
  return out;
}

function rowMatchesActors(
  row: Record<string, unknown>,
  actors: SkillsActorIds,
): { owned: boolean; collected: boolean } {
  const needles = actorNeedles(actors);
  if (needles.length === 0) return { owned: false, collected: false };
  const ownerId = (asString(row.owner_id) || asString(row.ownerId) || "").trim().toLowerCase();
  const owner = (asString(row.owner) || asString(row.author) || "").trim().toLowerCase();
  const owned = needles.some((n) => ownerId === n || owner === n);
  const collectors =
    asStringArray(row.collector_ids) ?? asStringArray(row.collectorIds) ?? [];
  const collected = collectors.some((id) => needles.includes(id.trim().toLowerCase()));
  return { owned, collected };
}

/** Local overlay for hosts that accept uncollect but leave OIDC sub in collector_ids. */
const UNCOLLECT_OVERLAY_PATH = join(DRSAI_HOME, "desktop", "skills-square-uncollect.json");
let localUncollectSlugs = new Set<string>();

function decodeUncollectOverlay(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const slugs = (value as { slugs?: unknown }).slugs;
  if (!Array.isArray(slugs)) return [];
  return slugs
    .filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
    .map((s) => s.trim());
}

async function refreshUncollectOverlay(): Promise<Set<string>> {
  const stored = await readDurableJson(UNCOLLECT_OVERLAY_PATH, decodeUncollectOverlay);
  localUncollectSlugs = new Set(stored?.value ?? []);
  return localUncollectSlugs;
}

async function rememberUncollectOverlay(slug: string): Promise<void> {
  const trimmed = slug.trim();
  if (!trimmed) return;
  await refreshUncollectOverlay();
  if (localUncollectSlugs.has(trimmed)) return;
  localUncollectSlugs.add(trimmed);
  await writeDurableJson(UNCOLLECT_OVERLAY_PATH, {
    slugs: [...localUncollectSlugs].sort(),
    updatedAt: new Date().toISOString(),
  });
}

async function forgetUncollectOverlay(slug: string): Promise<void> {
  const trimmed = slug.trim();
  if (!trimmed) return;
  await refreshUncollectOverlay();
  if (!localUncollectSlugs.has(trimmed)) return;
  localUncollectSlugs.delete(trimmed);
  await writeDurableJson(UNCOLLECT_OVERLAY_PATH, {
    slugs: [...localUncollectSlugs].sort(),
    updatedAt: new Date().toISOString(),
  });
}

function resolveIsCollected(
  raw: Record<string, unknown>,
  slug: string,
  options?: {
    operatorEmail?: string;
    operatorSubject?: string;
    collectedSlugs?: Set<string>;
  },
): boolean {
  // Desktop-local uncollect overlay (stale OIDC sub on older Skills hosts).
  if (slug && localUncollectSlugs.has(slug)) return false;
  // Match collector_ids against session email and/or OIDC subject. Do not trust
  // bare is_collected alone when we have actor ids (it follows host Bearer identity).
  const actors: SkillsActorIds = {
    email: options?.operatorEmail,
    subject: options?.operatorSubject,
  };
  const needles = actorNeedles(actors);
  if (needles.length > 0) {
    if (slug && options?.collectedSlugs?.has(slug)) return true;
    const collectors =
      asStringArray(raw.collector_ids) ?? asStringArray(raw.collectorIds) ?? [];
    return collectors.some((id) => needles.includes(id.trim().toLowerCase()));
  }
  if (raw.is_collected === true || raw.isCollected === true) return true;
  const uskillsType = asString(raw.uskills_type) || asString(raw.uskillsType);
  if (uskillsType === "imported") return true;
  if (slug && options?.collectedSlugs?.has(slug)) return true;
  return false;
}

// A square skill is "installed" when the local skills directory contains the
// tree that installSkillsSquare wrote. That directory is keyed by the sanitized
// square name (skillArchive.sanitizeInstallName) while /v1/skills reports the
// SKILL.md frontmatter name — compare every variant so renamed or localized
// square names still match (case-insensitively).
function isSquareSkillInstalled(name: string, slug: string, installedNames: Set<string>): boolean {
  const candidates: string[] = [];
  for (const value of [name, slug]) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    candidates.push(trimmed);
    try {
      candidates.push(sanitizeInstallName(trimmed));
    } catch {
      // Keep the raw form only.
    }
  }
  return candidates.some((candidate) => installedNames.has(candidate.toLowerCase()));
}

function mapWebuiSkill(
  raw: Record<string, unknown>,
  installedNames: Set<string>,
  options?: {
    operatorEmail?: string;
    operatorSubject?: string;
    collectedSlugs?: Set<string>;
  },
): DesktopSquareSkill {
  const slug = asString(raw.slug) || asString(raw.skillId) || asString(raw.id) || "";
  const name = asString(raw.name) || asString(raw.skillName) || slug;
  let collectorIds = asStringArray(raw.collector_ids) ?? asStringArray(raw.collectorIds);
  const overlayed = Boolean(slug && localUncollectSlugs.has(slug));
  if (overlayed && collectorIds?.length) {
    const needles = new Set(
      actorNeedles({
        email: options?.operatorEmail,
        subject: options?.operatorSubject,
      }),
    );
    collectorIds = collectorIds.filter((id) => !needles.has(id.trim().toLowerCase()));
  }
  const collects =
    asNumber(raw.collects) ??
    asNumber(raw.collect_count) ??
    (collectorIds ? collectorIds.length : undefined);
  const tags = asStringArray(raw.tags);
  const isCollected = overlayed ? false : resolveIsCollected(raw, slug, options);
  return {
    slug,
    name,
    description: asString(raw.description) || "",
    icon: asString(raw.icon) || asString(raw.emoji),
    version: asString(raw.version) || asString(raw.currentVersion),
    owner: asString(raw.owner) || asString(raw.authorName),
    ownerId: asString(raw.owner_id) || asString(raw.ownerId),
    author: asString(raw.author) || asString(raw.authorName),
    visibility: asString(raw.visibility),
    source: asString(raw.source),
    uskillsType: overlayed
      ? null
      : ((asString(raw.uskills_type) || asString(raw.uskillsType) || null) as string | null),
    tags,
    downloads: asNumber(raw.downloads) ?? asNumber(raw.download_count) ?? asNumber(raw.callCount),
    collects: overlayed
      ? Math.max(0, (collects ?? collectorIds?.length ?? 1) - 1)
      : collects,
    collectorIds,
    isCollected,
    canEdit: typeof raw.can_edit === "boolean"
      ? raw.can_edit
      : typeof raw.canEdit === "boolean"
        ? raw.canEdit
        : undefined,
    profile: asString(raw.profile),
    changelog: asString(raw.changelog),
    createdAt: asString(raw.created_at) || asString(raw.createdAt),
    updatedAt: asString(raw.updated_at) || asString(raw.updatedAt),
    installed: isSquareSkillInstalled(name, slug, installedNames),
    academicGroupId: asString(raw.academicGroupId) || asString(raw.academic_group_id),
  };
}

function mapHigrafSkill(
  raw: Record<string, unknown>,
  installedNames: Set<string>,
  options?: {
    operatorEmail?: string;
    operatorSubject?: string;
    collectedSlugs?: Set<string>;
  },
): DesktopSquareSkill {
  const mapped = mapWebuiSkill(
    {
      ...raw,
      slug: raw.skillId || raw.id || raw.slug,
      name: raw.name || raw.skillName,
      icon: raw.emoji || raw.icon || "package",
      version: raw.version || raw.currentVersion || "1.0.0",
      owner: raw.authorName || raw.owner,
      updated_at: raw.updatedAt || raw.updated_at,
      downloads: raw.callCount ?? raw.downloads ?? 0,
      tags: raw.tags || [],
      source: "higraf",
      academicGroupId: raw.academicGroupId || "",
    },
    installedNames,
    options,
  );
  mapped.source = "higraf";
  return mapped;
}

/** Fetch type=user catalog, then keep rows for the current session actors. */
async function fetchUserSkillRows(
  operatorEmail: string,
  auth: SkillsAuth,
): Promise<Record<string, unknown>[]> {
  const actors = await resolveSkillsActorIds(operatorEmail, auth.principal);
  if (!actors.subject && auth.principal && !looksLikeEmail(auth.principal)) {
    actors.subject = auth.principal;
  }

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await fetchTypeUserRows(auth);
  } catch {
    rows = [];
  }

  if (actorNeedles(actors).length > 0) {
    rows = rows.filter((row) => {
      const match = rowMatchesActors(row, actors);
      return match.owned || match.collected;
    });
  }

  // Merge public/private/team rows for email + OIDC subject (WebUI email collects
  // and Desktop OIDC-subject collects).
  return mergeEmailScopedCatalogSkills(rows, actors, auth);
}

async function fetchTypeUserRows(auth: SkillsAuth): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    type: "user",
    page: "1",
    page_size: "200",
  });
  if (auth.principal && looksLikeEmail(auth.principal)) {
    params.set("user_id", auth.principal.trim());
  }
  const data = await platformFetchJson<{
    status?: boolean;
    data?: Record<string, unknown>[];
  }>(`/api/skills?${params}`, { auth, timeoutMs: LIST_TIMEOUT_MS });
  if (data.status === false) return [];
  return Array.isArray(data.data) ? data.data : [];
}

function skillRowSlug(row: Record<string, unknown>): string {
  return asString(row.slug) || asString(row.skillId) || asString(row.id) || "";
}

function mergeSkillRowIntoMap(
  bySlug: Map<string, Record<string, unknown>>,
  row: Record<string, unknown>,
  actors: SkillsActorIds,
): void {
  const slug = skillRowSlug(row);
  if (!slug) return;
  const { owned, collected } = rowMatchesActors(row, actors);
  if (!owned && !collected) return;
  const existing = bySlug.get(slug);
  if (!existing) {
    bySlug.set(slug, {
      ...row,
      is_collected: collected || row.is_collected === true,
    });
    return;
  }
  bySlug.set(slug, {
    ...existing,
    is_collected:
      existing.is_collected === true ||
      collected ||
      row.is_collected === true,
    collector_ids:
      asStringArray(existing.collector_ids) ??
      asStringArray(existing.collectorIds) ??
      asStringArray(row.collector_ids) ??
      asStringArray(row.collectorIds) ??
      existing.collector_ids,
  });
}

/**
 * Pull public + private + team catalogs and keep rows owned/collected by the
 * current session email and/or OIDC subject.
 */
async function mergeEmailScopedCatalogSkills(
  authScoped: Record<string, unknown>[],
  actors: SkillsActorIds,
  auth: SkillsAuth,
): Promise<Record<string, unknown>[]> {
  if (actorNeedles(actors).length === 0) return authScoped;

  const bySlug = new Map<string, Record<string, unknown>>();
  for (const row of authScoped) {
    const slug = skillRowSlug(row);
    if (slug) bySlug.set(slug, row);
  }

  // Skip type=public×200 — type=user already covers collected public skills;
  // only enrich private/team rows that may stamp a different actor id.
  const queries: URLSearchParams[] = [
    new URLSearchParams({ visibility: "private", page: "1", page_size: "200", sort: "time" }),
    new URLSearchParams({ visibility: "team", page: "1", page_size: "200", sort: "time" }),
  ];

  const results = await Promise.all(
    queries.map(async (params) => {
      try {
        const data = await platformFetchJson<{
          status?: boolean;
          data?: Record<string, unknown>[];
        }>(`/api/skills?${params}`, { auth, timeoutMs: LIST_TIMEOUT_MS });
        if (data.status === false) return [] as Record<string, unknown>[];
        return Array.isArray(data.data) ? data.data : [];
      } catch {
        return [] as Record<string, unknown>[];
      }
    }),
  );
  for (const rows of results) {
    for (const row of rows) {
      mergeSkillRowIntoMap(bySlug, row, actors);
    }
  }

  return [...bySlug.values()];
}

/**
 * WebUI parity: collected = is_collected / collector_ids / uskills_type=imported.
 * Collecting a public skill updates collector_ids on that row (not a separate import).
 */
async function listCollectedSlugs(operatorEmail?: string): Promise<Set<string>> {
  const actors = await resolveSkillsActorIds(operatorEmail);
  if (actorNeedles(actors).length === 0) return new Set();

  const authPrimary = await resolveSkillsAuth();
  if (!authPrimary.token) return new Set();

  await refreshUncollectOverlay();

  const collectFromRows = (rows: Record<string, unknown>[]): Set<string> => {
    const slugs = new Set<string>();
    for (const row of rows) {
      const slug = asString(row.slug) || asString(row.skillId) || asString(row.id) || "";
      if (!slug) continue;
      if (localUncollectSlugs.has(slug)) continue;
      if (
        resolveIsCollected(row, slug, {
          operatorEmail: actors.email,
          operatorSubject: actors.subject,
        })
      ) {
        slugs.add(slug);
      }
    }
    return slugs;
  };

  try {
    const rows = await fetchUserSkillRows(actors.email || "", authPrimary);
    return collectFromRows(rows);
  } catch {
    return new Set();
  }
}

function emptyPage(
  page: number,
  pageSize: number,
  status: SkillsSquareStatus,
): DesktopSquareSkillsPage {
  return {
    items: [],
    page,
    pageSize,
    total: 0,
    hasNext: false,
    installedCount: 0,
    notInstalledCount: 0,
    status,
  };
}

function applyInstallFilter(
  items: DesktopSquareSkill[],
  installFilter?: DesktopSquareSkillsListRequest["installFilter"],
): DesktopSquareSkill[] {
  if (installFilter === "installed") return items.filter((i) => i.installed);
  if (installFilter === "not_installed") return items.filter((i) => !i.installed);
  return items;
}

function applyLocalSort(
  items: DesktopSquareSkill[],
  sort?: DesktopSquareSkillsListRequest["sort"],
): DesktopSquareSkill[] {
  const copy = [...items];
  if (sort === "downloads") {
    copy.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  } else if (sort === "collects") {
    copy.sort((a, b) => (b.collects ?? 0) - (a.collects ?? 0));
  } else if (sort === "time") {
    copy.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  } else if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
  return copy;
}

function paginateLocal<T>(items: T[], page: number, pageSize: number): {
  pageItems: T[];
  total: number;
  hasNext: boolean;
} {
  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = start < total ? items.slice(start, start + pageSize) : [];
  const totalPages = total === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  return { pageItems, total, hasNext: page < totalPages };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getSkillsSquareStatus(): Promise<SkillsSquareStatus> {
  const auth = await resolveSkillsAuth();
  if (!auth.token) {
    return statusOf(
      "requires_login",
      "Sign in with HepAI OIDC to use Skills Square.",
      "none",
    );
  }
  try {
    const data = await platformFetchJson<{ status?: boolean; message?: string }>(
      `/api/skills?type=public&page=1&page_size=1`,
      { auth, timeoutMs: LIST_TIMEOUT_MS },
    );
    if (data && data.status === false) {
      return statusOf("error", data.message || "Skills Square returned an error.", auth.authMode);
    }
    return statusOf("ready", "Skills Square is available. (OIDC)", auth.authMode);
  } catch (err) {
    return statusFromHttpError(err, auth.authMode);
  }
}

export async function listSkillsSquare(
  request: DesktopSquareSkillsListRequest = {},
): Promise<DesktopSquareSkillsPage> {
  const scope = request.scope === "user" ? "user" : "public";
  const page = Math.max(1, request.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, request.pageSize ?? (scope === "user" ? 200 : 20)));
  const auth = await resolveSkillsAuth();

  if (!auth.token) {
    return emptyPage(
      page,
      pageSize,
      statusOf(
        "requires_login",
        "Sign in with HepAI OIDC to browse Skills Square.",
        "none",
      ),
    );
  }

  const [installedNames, actors] = await Promise.all([
    listInstalledSkillNames(request.userId),
    resolveSkillsActorIds(request.userEmail, request.userId),
  ]);
  const operatorEmail = actors.email;
  const operatorSubject = actors.subject;
  // Public rows already include collector_ids — do not await listCollectedSlugs
  // (that used to pull 4× page_size=200 catalogs before every page).
  await refreshUncollectOverlay();
  const collectedSlugs = new Set<string>();
  const mapOpts = { operatorEmail, operatorSubject, collectedSlugs };
  const ready = statusOf("ready", "Skills Square is available.", auth.authMode);

  if (scope === "user" && !operatorEmail && !operatorSubject) {
    return emptyPage(
      page,
      pageSize,
      statusOf(
        "requires_login",
        "Sign in with an account email to load your skills and collections.",
        auth.authMode,
      ),
    );
  }

  try {
    // Academic group tag → Higraf skill hub proxy
    const tag = request.tags?.trim() || "";
    if (scope === "public" && tag && ACADEMIC_GROUP_TAGS.has(tag.toLowerCase())) {
      const params = new URLSearchParams({
        visibility: "group",
        academicGroupId: tag.toLowerCase(),
      });
      const data = await platformFetchJson<{
        status?: boolean;
        message?: string;
        data?: Record<string, unknown>[];
      }>(`/api/deer-flow/skill-hub/list?${params}`, { auth, timeoutMs: LIST_TIMEOUT_MS });
      requireApiPayload(data, "Failed to list academic group skills");
      let items = (data.data ?? []).map((row) => mapHigrafSkill(row, installedNames, mapOpts));
      if (request.q?.trim()) {
        const q = request.q.trim().toLowerCase();
        items = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.slug.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            (i.author || "").toLowerCase().includes(q),
        );
      }
      items = applyLocalSort(items, request.sort ?? "time");
      const { pageItems, total, hasNext } = paginateLocal(items, page, pageSize);
      const filtered = applyInstallFilter(pageItems, request.installFilter);
      const installedCount = pageItems.filter((i) => i.installed).length;
      return {
        items: filtered,
        page,
        pageSize,
        total,
        hasNext,
        installedCount,
        notInstalledCount: pageItems.length - installedCount,
        status: ready,
      };
    }

    const params = new URLSearchParams();
    if (scope === "public") {
      params.set("type", "public");
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (request.q?.trim()) params.set("q", request.q.trim());
      if (tag) params.set("tags", tag);
      if (request.sort === "name" || request.sort === "time") {
        params.set("sort", request.sort);
      } else if (request.sort === "downloads" || request.sort === "collects") {
        // Backend currently supports name|time; fetch by time then sort locally.
        params.set("sort", "time");
      }
      if (request.visibility?.trim()) params.set("visibility", request.visibility.trim());
    }

    let rawRows: Record<string, unknown>[] = [];
    let pagination: {
      page?: number;
      page_size?: number;
      total?: number;
      has_next?: boolean;
    } | undefined;

    if (scope === "user") {
      // Match WebUI: no uskills_type on the wire; filter client-side.
      rawRows = await fetchUserSkillRows(operatorEmail!, auth);
      // Empty is a valid state (e.g. user deleted their last skill).
    } else {
      const data = await platformFetchJson<{
        status?: boolean;
        message?: string;
        data?: Record<string, unknown>[];
        pagination?: {
          page?: number;
          page_size?: number;
          total?: number;
          has_next?: boolean;
        };
      }>(`/api/skills?${params}`, { auth, timeoutMs: LIST_TIMEOUT_MS });
      requireApiPayload(data, "Failed to list skills");
      rawRows = data.data ?? [];
      pagination = data.pagination;
    }

    let items = rawRows.map((row) => {
      const mapped = mapWebuiSkill(row, installedNames, mapOpts);
      if (scope === "user" && mapped.isCollected) {
        mapped.isCollected = true;
      }
      return mapped;
    });

    if (scope === "user") {
      // collected = collector_ids contains session email or OIDC subject
      // created = owner matches email/subject and not collected
      const needles = actorNeedles(actors).map((n) => n.toLowerCase());
      const isCollectedItem = (i: DesktopSquareSkill) => {
        if (localUncollectSlugs.has(i.slug)) return false;
        if (needles.length === 0) {
          return i.isCollected === true || i.uskillsType === "imported";
        }
        if (i.isCollected === false) return false;
        return (i.collectorIds || []).some((id) =>
          needles.includes(id.trim().toLowerCase()),
        );
      };
      const isCreatedItem = (i: DesktopSquareSkill) => {
        if (i.uskillsType === "imported" || isCollectedItem(i)) return false;
        if (needles.length === 0) return i.uskillsType === "created";
        const ownerId = (i.ownerId || "").trim().toLowerCase();
        const owner = (i.owner || "").trim().toLowerCase();
        return needles.some((n) => ownerId === n || owner === n);
      };
      if (request.uskillsType === "imported") {
        items = items.filter(isCollectedItem);
      } else if (request.uskillsType === "created") {
        items = items.filter(isCreatedItem);
      }
      items = applyLocalSort(items, request.sort ?? "time");
      if (request.q?.trim()) {
        const q = request.q.trim().toLowerCase();
        items = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.slug.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q),
        );
      }
      const { pageItems, total, hasNext } = paginateLocal(items, page, pageSize);
      const filtered = applyInstallFilter(pageItems, request.installFilter);
      const installedCount = pageItems.filter((i) => i.installed).length;
      return {
        items: filtered,
        page,
        pageSize,
        total,
        hasNext,
        installedCount,
        notInstalledCount: pageItems.length - installedCount,
        status: ready,
      };
    }

    if (request.sort === "downloads" || request.sort === "collects") {
      items = applyLocalSort(items, request.sort);
    }

    const filtered = applyInstallFilter(items, request.installFilter);
    const installedCount = items.filter((i) => i.installed).length;
    return {
      items: filtered,
      page: pagination?.page ?? page,
      pageSize: pagination?.page_size ?? pageSize,
      total: pagination?.total ?? filtered.length,
      hasNext: pagination?.has_next ?? false,
      installedCount,
      notInstalledCount: items.length - installedCount,
      status: ready,
    };
  } catch (err) {
    return emptyPage(page, pageSize, statusFromHttpError(err, auth.authMode));
  }
}

export async function getSkillsSquareDetail(request: {
  slug: string;
  userEmail?: string;
}): Promise<DesktopSquareSkillDetail> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) {
    throw new Error("Sign in with HepAI OIDC to load skill details.");
  }
  const installedNames = await listInstalledSkillNames();
  const actors = await resolveSkillsActorIds(request.userEmail);
  await refreshUncollectOverlay();
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    detail?: unknown;
    data?: Record<string, unknown>;
  }>(`/api/skills/${encodeURIComponent(slug)}?type=public`, {
    auth,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to load skill detail");
  const raw = data.data || {};
  const base = mapWebuiSkill(raw, installedNames, {
    operatorEmail: actors.email,
    operatorSubject: actors.subject,
  });
  return {
    ...base,
    body: asString(raw.body) || "",
    changelog: asString(raw.changelog) || base.changelog,
    restricted: typeof raw.restricted === "boolean" ? raw.restricted : undefined,
  };
}

export async function getSkillsSquareSkillMd(request: {
  slug: string;
}): Promise<{ content: string }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) {
    throw new Error("Sign in with HepAI OIDC to read SKILL.md.");
  }
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    detail?: unknown;
    data?: { content?: string };
  }>(`/api/skills/${encodeURIComponent(slug)}/skill-md`, {
    auth,
    timeoutMs: SKILL_MD_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to read SKILL.md");
  const content = data.data?.content;
  if (typeof content !== "string") {
    throw new Error("SKILL.md response did not include content.");
  }
  return { content };
}

export async function getSkillsSquareStats(): Promise<DesktopSquareSkillStats> {
  const auth = await resolveSkillsAuth();
  // Stats ideally works without auth; still send bearer when available.
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  }>(`/api/skills/stats`, {
    auth: auth.token ? auth : undefined,
    token: auth.token,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to load skill stats");
  const raw = data.data || {};
  return {
    totalSkills: asNumber(raw.total_skills) ?? asNumber(raw.totalSkills) ?? 0,
    publicSkills: asNumber(raw.public_skills) ?? asNumber(raw.publicSkills) ?? 0,
    totalDownloads: asNumber(raw.total_downloads) ?? asNumber(raw.totalDownloads) ?? 0,
    totalCollects: asNumber(raw.total_collects) ?? asNumber(raw.totalCollects) ?? 0,
  };
}

export async function listSkillsSquareTags(request?: {
  operatorUserId?: string;
}): Promise<DesktopSquareSkillTag[]> {
  const operator =
    request?.operatorUserId?.trim() ||
    (await resolveOperatorEmail()) ||
    "";
  if (!operator) {
    throw new Error("operator_user_id is required to list skill tags.");
  }
  const auth = await resolveSkillsAuth();
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>[];
  }>(`/api/skill-tags/?operator_user_id=${encodeURIComponent(operator)}`, {
    auth: auth.token ? auth : undefined,
    token: auth.token,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to list skill tags");
  return (data.data ?? []).map((row) => ({
    id: asNumber(row.id) ?? 0,
    uuid: asString(row.uuid),
    name: asString(row.name) || "",
    sortOrder: asNumber(row.sort_order) ?? asNumber(row.sortOrder),
  }));
}

export async function createSkillsSquareTag(request: {
  name: string;
  sortOrder?: number;
  operatorUserId?: string;
}): Promise<DesktopSquareSkillTag> {
  const name = request.name?.trim();
  if (!name) throw new Error("Tag name is required.");
  const operator =
    request.operatorUserId?.trim() ||
    (await resolveOperatorEmail()) ||
    "";
  if (!operator) throw new Error("operator_user_id is required to create a tag.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to create skill tags.");
  const qs = new URLSearchParams({
    operator_user_id: operator,
    name,
    sort_order: String(request.sortOrder ?? 0),
  });
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  }>(`/api/skill-tags/?${qs}`, {
    method: "POST",
    auth,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to create tag");
  const row = data.data || {};
  return {
    id: asNumber(row.id) ?? 0,
    uuid: asString(row.uuid),
    name: asString(row.name) || name,
    sortOrder: asNumber(row.sort_order) ?? asNumber(row.sortOrder) ?? request.sortOrder,
  };
}

export async function updateSkillsSquareTag(request: {
  tagId: number;
  name?: string;
  sortOrder?: number;
  operatorUserId?: string;
}): Promise<DesktopSquareSkillTag> {
  if (!Number.isFinite(request.tagId)) throw new Error("tagId is required.");
  const operator =
    request.operatorUserId?.trim() ||
    (await resolveOperatorEmail()) ||
    "";
  if (!operator) throw new Error("operator_user_id is required to update a tag.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to update skill tags.");
  const qs = new URLSearchParams({ operator_user_id: operator });
  if (request.name !== undefined) qs.set("name", request.name);
  if (request.sortOrder !== undefined) qs.set("sort_order", String(request.sortOrder));
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  }>(`/api/skill-tags/${request.tagId}?${qs}`, {
    method: "PUT",
    auth,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Failed to update tag");
  const row = data.data || {};
  return {
    id: asNumber(row.id) ?? request.tagId,
    uuid: asString(row.uuid),
    name: asString(row.name) || request.name || "",
    sortOrder: asNumber(row.sort_order) ?? asNumber(row.sortOrder) ?? request.sortOrder,
  };
}

export async function deleteSkillsSquareTag(request: {
  tagId: number;
  operatorUserId?: string;
}): Promise<{ id: number }> {
  if (!Number.isFinite(request.tagId)) throw new Error("tagId is required.");
  const operator =
    request.operatorUserId?.trim() ||
    (await resolveOperatorEmail()) ||
    "";
  if (!operator) throw new Error("operator_user_id is required to delete a tag.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to delete skill tags.");
  const data = await platformFetchJson<{ status?: boolean; message?: string }>(
    `/api/skill-tags/${request.tagId}?operator_user_id=${encodeURIComponent(operator)}`,
    { method: "DELETE", auth, timeoutMs: LIST_TIMEOUT_MS },
  );
  requireApiPayload(data, "Failed to delete tag");
  return { id: request.tagId };
}

export async function installSkillsSquare(
  request: DesktopSquareInstallRequest,
): Promise<{ status: string; name: string; path: string; files: number }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) {
    throw new Error("HepAI OIDC sign-in required to install public skills.");
  }

  // Prefer the square display name; the slug is ASCII by construction, so fall
  // back to it when the name cannot be sanitized into a valid directory name.
  const installName = ((): string => {
    const trimmed = request.name?.trim();
    if (trimmed) {
      try {
        return sanitizeInstallName(trimmed);
      } catch {
        // Fall through to the slug.
      }
    }
    return sanitizeInstallName(slug);
  })();
  const uid = await resolveSkillsUserId(request.userId);

  let mdInstalled: { status: string; name: string; path: string; files: number } | null = null;
  let mdErrMsg = "";
  let zipErrMsg = "";

  // Prefer SKILL.md → local gateway first (fast path into the scan directory).
  try {
    const md = await getSkillsSquareSkillMd({ slug });
    if (!md.content?.trim()) {
      throw new Error(`Skill '${slug}' has no SKILL.md content.`);
    }
    const result = await installSkill({
      name: installName,
      content: md.content,
      source: "public_square",
      userId: uid,
    });
    try {
      await reloadSkills(request.threadId, uid);
    } catch {
      // Disk install succeeded; next chat turn can pick it up.
    }
    mdInstalled = {
      status: result.status ?? "ok",
      name: result.name ?? installName,
      path: result.path ?? "",
      files: 1,
    };
  } catch (mdErr) {
    mdErrMsg = mdErr instanceof Error ? mdErr.message : String(mdErr);
  }

  // Full ZIP package (scripts / assets). Short enrichment window when SKILL.md
  // already landed; longer only as last resort when SKILL.md failed.
  const zipTimeoutMs = mdInstalled ? 45_000 : DOWNLOAD_UPLOAD_TIMEOUT_MS;
  try {
    const zipBuffer = await platformFetchBuffer(
      `/api/skills/${encodeURIComponent(slug)}/download`,
      { auth, timeoutMs: zipTimeoutMs },
    );
    return await writeZipBufferAndInstall(zipBuffer, installName, {
      userId: uid,
      threadId: request.threadId,
    });
  } catch (zipErr) {
    zipErrMsg = zipErr instanceof Error ? zipErr.message : String(zipErr);
  }

  if (mdInstalled) return mdInstalled;

  throw new Error(
    `Install failed (skill-md: ${mdErrMsg || "n/a"}; zip: ${zipErrMsg || "n/a"})`,
  );
}

/** Download public skill ZIP (WebUI parity) — returns bytes for renderer save. */
export async function downloadSkillsSquare(request: {
  slug: string;
}): Promise<{ fileName: string; base64: string }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  if (!auth.token) {
    throw new Error("Authentication required to download skills.");
  }
  const zipBuffer = await platformFetchBuffer(
    `/api/skills/${encodeURIComponent(slug)}/download`,
    { auth, timeoutMs: DOWNLOAD_UPLOAD_TIMEOUT_MS },
  );
  return {
    fileName: `${sanitizeInstallName(slug)}.zip`,
    base64: zipBuffer.toString("base64"),
  };
}

function appendUploadFields(
  form: FormData,
  fields: Record<string, string | undefined | null>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (!trimmed && key !== "changelog") continue;
    form.append(key, key === "changelog" ? String(value) : trimmed);
  }
}

export async function uploadSkillsSquare(
  request: DesktopSquareUploadRequest,
): Promise<Record<string, unknown>> {
  const auth = await resolveSkillsWriteAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to upload skills.");
  const emailOwner =
    (auth.principal && looksLikeEmail(auth.principal) ? auth.principal.trim() : undefined) ||
    (looksLikeEmail(request.ownerId) ? request.ownerId!.trim() : undefined) ||
    (looksLikeEmail(request.owner) ? request.owner!.trim() : undefined);
  if (!emailOwner) {
    throw new Error("Account email is required to publish or collect skills.");
  }

  const form = new FormData();
  if (request.zipBase64 && request.zipBase64.trim()) {
    const buf = decodeBase64ToBuffer(request.zipBase64);
    const fileName = request.fileName?.trim() || `${request.slug?.trim() || "skill"}.zip`;
    form.append("file", bufferToBlob(buf, "application/zip"), fileName);
  } else {
    // Collect / metadata-only: WebUI sends an empty `.ref` placeholder when
    // source=imported (host stamps collector_ids; no GFS zip written).
    const fileName =
      request.fileName?.trim() ||
      (request.source === "imported"
        ? `${request.slug?.trim() || "skill"}.ref`
        : `${request.slug?.trim() || "skill"}.zip`);
    form.append("file", new Blob([]), fileName);
  }

  if (request.profileBase64?.trim()) {
    const profileBuf = decodeBase64ToBuffer(request.profileBase64);
    const profileName = request.profileFileName?.trim() || "profile.png";
    form.append("profile", bufferToBlob(profileBuf), profileName);
  }

  appendUploadFields(form, {
    slug: request.slug,
    display_name: request.displayName,
    icon: request.icon,
    description: request.description,
    version: request.version,
    changelog: request.changelog,
    tags: request.tags,
    visibility: request.visibility,
    source: request.source,
    // Always stamp email — host owner_id follows Bearer user, but form fields
    // still matter for import/collect metadata and older hosts.
    owner: emailOwner,
    owner_id: emailOwner,
  });

  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    detail?: unknown;
    data?: Record<string, unknown>;
  }>(`/api/skills/upload`, {
    method: "POST",
    auth,
    body: form,
    multipart: true,
    timeoutMs: DOWNLOAD_UPLOAD_TIMEOUT_MS,
  });
  requireApiPayload(data, "Upload failed");
  return (data.data as Record<string, unknown>) || {};
}

export async function updateSkillsSquare(
  request: DesktopSquareUpdateRequest,
): Promise<Record<string, unknown>> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsWriteAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to update skills.");

  const form = new FormData();
  if (request.zipBase64?.trim()) {
    const buf = decodeBase64ToBuffer(request.zipBase64);
    const fileName = request.fileName?.trim() || `${slug}.zip`;
    form.append("file", bufferToBlob(buf, "application/zip"), fileName);
  }
  if (request.profileBase64?.trim()) {
    const profileBuf = decodeBase64ToBuffer(request.profileBase64);
    const profileName = request.profileFileName?.trim() || "profile.png";
    form.append("profile", bufferToBlob(profileBuf), profileName);
  }

  const display = request.displayName ?? request.name;
  appendUploadFields(form, {
    display_name: display,
    name: request.name ?? request.displayName,
    icon: request.icon,
    description: request.description,
    version: request.version,
    changelog: request.changelog,
    tags: request.tags,
    visibility: request.visibility,
  });

  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    detail?: unknown;
    data?: Record<string, unknown>;
  }>(`/api/skills/${encodeURIComponent(slug)}`, {
    method: "PUT",
    auth,
    body: form,
    multipart: true,
    timeoutMs: DOWNLOAD_UPLOAD_TIMEOUT_MS,
  });
  requireApiPayload(data, "Update failed");
  return (data.data as Record<string, unknown>) || {};
}

/** Read collector_ids for one skill (fresh GET — avoid merged catalog false positives). */
async function fetchSkillCollectorIds(
  slug: string,
  auth: SkillsAuth,
): Promise<string[]> {
  const data = await platformFetchJson<{
    status?: boolean;
    data?: Record<string, unknown>;
  }>(`/api/skills/${encodeURIComponent(slug)}`, {
    auth,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  const raw = data.data || {};
  return asStringArray(raw.collector_ids) ?? asStringArray(raw.collectorIds) ?? [];
}

function collectorsMatchActors(
  collectors: string[],
  actors: SkillsActorIds,
): boolean {
  const needles = new Set(actorNeedles(actors));
  if (needles.size === 0) return false;
  return collectors.some((id) => needles.has(id.trim().toLowerCase()));
}

export async function deleteSkillsSquare(request: {
  slug: string;
  intent?: "delete" | "uncollect";
  /** Operator email — WebUI deleteUserSkill requires type=user&user_id. */
  userId?: string;
  userEmail?: string;
}): Promise<{ slug: string }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const operatorEmail = await resolveSkillsOperatorEmail(
    request.userEmail,
    request.userId,
  );
  if (!operatorEmail) {
    throw new Error("user_id (email) is required to delete skills.");
  }
  const auth = await resolveSkillsWriteAuth();
  if (!auth.token) {
    throw new Error("HepAI OIDC sign-in required to delete skills.");
  }

  const actors = await resolveSkillsActorIds(operatorEmail, request.userId);
  const actorHeader = actorNeedles(actors).join(",");

  const attempt = async (authCtx: SkillsAuth, userIdForQuery: string) => {
    // Match WebUI skillsAPI.deleteUserSkill: DELETE ?type=user&user_id={email}
    const qs = new URLSearchParams({
      type: "user",
      user_id: userIdForQuery,
    });
    if (request.intent) qs.set("intent", request.intent);
    const data = await platformFetchJson<{
      status?: boolean;
      message?: string;
      detail?: unknown;
      data?: { slug?: string };
    }>(`/api/skills/${encodeURIComponent(slug)}?${qs}`, {
      method: "DELETE",
      auth: authCtx,
      timeoutMs: LIST_TIMEOUT_MS,
      headers: actorHeader
        ? { "X-OpenDrSai-Actor-Ids": actorHeader }
        : undefined,
    });
    requireApiPayload(data, "Delete failed");
    return { slug: data.data?.slug || slug };
  };

  if (request.intent !== "uncollect") {
    return attempt(auth, operatorEmail);
  }

  // Uncollect: older hosts only strip one collector id (Bearer email XOR OIDC
  // subject). Prefetch collector_ids, retry auth/query variants that match them,
  // then verify via GET (not the merged catalog list).
  let collectorsBefore: string[] = [];
  try {
    collectorsBefore = await fetchSkillCollectorIds(slug, auth);
  } catch {
    /* continue with actor candidates */
  }
  const collectorNeedles = new Set(
    collectorsBefore.map((id) => id.trim().toLowerCase()).filter(Boolean),
  );

  const queryIds: string[] = [];
  const pushQuery = (value?: string, prefer = false) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (queryIds.some((id) => id.toLowerCase() === trimmed.toLowerCase())) return;
    if (prefer) queryIds.unshift(trimmed);
    else queryIds.push(trimmed);
  };
  // Prefer ids actually present on the skill (often OIDC subject UUID).
  for (const candidate of [actors.subject, request.userId, actors.email, operatorEmail]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    pushQuery(trimmed, collectorNeedles.has(trimmed.toLowerCase()));
  }
  if (queryIds.length === 0) queryIds.push(operatorEmail);

  const authAttempts: SkillsAuth[] = [];
  const pushAuth = (next: SkillsAuth) => {
    const key = `${next.authMode}|${next.principal ?? ""}`;
    if (authAttempts.some((a) => `${a.authMode}|${a.principal ?? ""}` === key)) return;
    authAttempts.push(next);
  };
  // UUID collectors: try without email Principal first so subject-stamping hosts strip it.
  const collectorsLookLikeSubject = collectorsBefore.some(
    (id) => id.trim() && !id.includes("@"),
  );
  if (collectorsLookLikeSubject) {
    pushAuth({ token: auth.token, authMode: auth.authMode });
    if (actors.subject?.trim()) {
      pushAuth({
        token: auth.token,
        authMode: auth.authMode,
        principal: actors.subject.trim(),
      });
    }
  }
  pushAuth(auth);
  pushAuth({ token: auth.token, authMode: auth.authMode });
  if (actors.subject?.trim()) {
    pushAuth({
      token: auth.token,
      authMode: auth.authMode,
      principal: actors.subject.trim(),
    });
  }

  let lastError: unknown;
  let sawSuccess = false;
  for (const authCtx of authAttempts) {
    for (const userIdForQuery of queryIds) {
      try {
        await attempt(authCtx, userIdForQuery);
        sawSuccess = true;
      } catch (err) {
        lastError = err;
        continue;
      }
      try {
        const collectors = await fetchSkillCollectorIds(slug, auth);
        if (!collectorsMatchActors(collectors, actors)) {
          await forgetUncollectOverlay(slug);
          return { slug };
        }
      } catch {
        const collected = await listCollectedSlugs(actors.email);
        if (!collected.has(slug)) {
          await forgetUncollectOverlay(slug);
          return { slug };
        }
      }
    }
  }

  if (sawSuccess) {
    // Older hosts return success while leaving OIDC sub in collector_ids.
    // Record a device-local overlay so Desktop UI stays consistent until the
    // Skills host is updated to strip email + subject aliases.
    await rememberUncollectOverlay(slug);
    return { slug };
  }
  throw lastError instanceof Error ? lastError : new Error("Delete failed");
}

export async function toggleSkillsSquareVisibility(request: {
  slug: string;
  visibility: "public" | "private" | "team";
}): Promise<{ slug: string; visibility: string }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const visibility = request.visibility;
  if (!visibility) throw new Error("visibility is required.");
  const auth = await resolveSkillsWriteAuth();
  if (!auth.token) throw new Error("HepAI OIDC sign-in required to change visibility.");
  const qs = new URLSearchParams({ visibility });
  const data = await platformFetchJson<{
    status?: boolean;
    message?: string;
    detail?: unknown;
    data?: { slug?: string; visibility?: string };
  }>(`/api/skills/${encodeURIComponent(slug)}/visibility?${qs}`, {
    method: "PUT",
    auth,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  requireApiPayload(data, "Toggle visibility failed");
  return {
    slug: data.data?.slug || slug,
    visibility: data.data?.visibility || visibility,
  };
}

export async function collectSkillsSquare(request: {
  slug: string;
  displayName?: string;
  icon?: string;
  description?: string;
  version?: string;
  tags?: string;
  owner?: string;
  ownerId?: string;
  changelog?: string;
  /** @deprecated prefer flat fields */
  meta?: {
    displayName?: string;
    icon?: string;
    description?: string;
    version?: string;
    tags?: string;
    owner?: string;
    ownerId?: string;
    changelog?: string;
  };
}): Promise<Record<string, unknown>> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const meta = request.meta ?? {};
  const payload = {
    slug,
    displayName: request.displayName || meta.displayName || slug,
    icon: request.icon ?? meta.icon,
    description: request.description ?? meta.description,
    version: request.version ?? meta.version,
    tags: request.tags ?? meta.tags,
    owner: request.owner ?? meta.owner,
    ownerId: request.ownerId ?? meta.ownerId,
    changelog: request.changelog ?? meta.changelog,
    source: "imported" as const,
  };
  // WebUI importPublicSkill: empty `.ref` + source=imported (no GFS zip).
  try {
    const result = await uploadSkillsSquare({ ...payload, fileName: `${slug}.ref` });
    await forgetUncollectOverlay(slug);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Some hosts still validate the upload filename as `.zip`.
    if (/zip|\.ref|upload/i.test(msg)) {
      const result = await uploadSkillsSquare({ ...payload, fileName: `${slug}.zip` });
      await forgetUncollectOverlay(slug);
      return result;
    }
    throw err;
  }
}

function shareActorCandidates(
  request: { userId?: string; userEmail?: string },
  actors: SkillsActorIds,
  fallbackEmail?: string,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (candidates.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    candidates.push(trimmed);
  };
  // Prefer SkillMeta.owner_id (often OIDC subject) — legacy share rows stamp it exactly.
  pushCandidate(request.userId);
  pushCandidate(request.userEmail);
  pushCandidate(actors.email);
  pushCandidate(actors.subject);
  pushCandidate(fallbackEmail);
  return candidates;
}

export async function createSkillsSquareShare(request: {
  slug: string;
  /** operator email (WebUI share APIs use user_id query) */
  userId?: string;
  password?: string;
  expiresInHours?: number;
  userEmail?: string;
}): Promise<DesktopSquareShareInfo> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  const actors = await resolveSkillsActorIds(request.userEmail, request.userId);
  const candidates = shareActorCandidates(
    request,
    actors,
    await resolveOperatorEmail(),
  );
  if (candidates.length === 0) {
    throw new Error("user_id (email) is required to create a share.");
  }

  const form = new FormData();
  if (request.password?.trim()) form.append("password", request.password.trim());
  form.append("expires_in_hours", String(request.expiresInHours ?? 24));

  let lastError: unknown;
  for (const userId of candidates) {
    try {
      const data = await platformFetchJson<{
        status?: boolean;
        message?: string;
        detail?: unknown;
        data?: Record<string, unknown>;
      }>(`/api/skills/${encodeURIComponent(slug)}/share?user_id=${encodeURIComponent(userId)}`, {
        method: "POST",
        auth: auth.token ? auth : undefined,
        token: auth.token,
        body: form,
        multipart: true,
        timeoutMs: LIST_TIMEOUT_MS,
      });
      requireApiPayload(data, "Failed to create share");
      const raw = data.data || {};
      return mapShareInfo(raw, slug);
    } catch (err) {
      lastError = err;
      // Legacy WebUI matched owner_id exactly — try alternate actor ids on 404.
      if (err instanceof SkillsSquareHttpError && err.status === 404) continue;
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to create share");
}

export async function listSkillsSquareShares(request: {
  slug: string;
  userId?: string;
  userEmail?: string;
}): Promise<DesktopSquareShareInfo[]> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");
  const auth = await resolveSkillsAuth();
  const actors = await resolveSkillsActorIds(request.userEmail, request.userId);
  const candidates = shareActorCandidates(
    request,
    actors,
    await resolveOperatorEmail(),
  );
  if (candidates.length === 0) {
    throw new Error("user_id (email) is required to list shares.");
  }

  const byId = new Map<string, DesktopSquareShareInfo>();
  let lastError: unknown;
  let sawSuccess = false;
  for (const userId of candidates) {
    try {
      const data = await platformFetchJson<{
        status?: boolean;
        message?: string;
        detail?: unknown;
        data?: Record<string, unknown>[];
      }>(`/api/skills/${encodeURIComponent(slug)}/shares?user_id=${encodeURIComponent(userId)}`, {
        auth: auth.token ? auth : undefined,
        token: auth.token,
        timeoutMs: LIST_TIMEOUT_MS,
      });
      requireApiPayload(data, "Failed to list shares");
      sawSuccess = true;
      for (const raw of data.data ?? []) {
        const item = mapShareInfo(raw, slug);
        if (item.shareId) byId.set(item.shareId, item);
      }
    } catch (err) {
      lastError = err;
      // Legacy host filters SkillShare.owner_user_id exactly (email vs subject).
      if (err instanceof SkillsSquareHttpError && (err.status === 404 || err.status === 403)) {
        continue;
      }
      throw err;
    }
  }
  if (!sawSuccess && lastError) {
    throw lastError instanceof Error ? lastError : new Error("Failed to list shares");
  }
  return [...byId.values()].sort((a, b) => {
    const at = a.createdAt || a.expiresAt || "";
    const bt = b.createdAt || b.expiresAt || "";
    return bt.localeCompare(at);
  });
}

export async function revokeSkillsSquareShare(request: {
  slug: string;
  shareId: string;
  userId?: string;
  userEmail?: string;
}): Promise<void> {
  const slug = request.slug?.trim();
  const shareId = request.shareId?.trim();
  if (!slug || !shareId) throw new Error("slug and shareId are required.");
  const auth = await resolveSkillsAuth();
  const actors = await resolveSkillsActorIds(request.userEmail, request.userId);
  const candidates = shareActorCandidates(
    request,
    actors,
    await resolveOperatorEmail(),
  );
  if (candidates.length === 0) {
    throw new Error("user_id (email) is required to revoke a share.");
  }

  let lastError: unknown;
  for (const userId of candidates) {
    try {
      const data = await platformFetchJson<{ status?: boolean; message?: string }>(
        `/api/skills/${encodeURIComponent(slug)}/share/${encodeURIComponent(shareId)}?user_id=${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          auth: auth.token ? auth : undefined,
          token: auth.token,
          timeoutMs: LIST_TIMEOUT_MS,
        },
      );
      requireApiPayload(data, "Failed to revoke share");
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof SkillsSquareHttpError && (err.status === 404 || err.status === 403)) {
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to revoke share");
}
