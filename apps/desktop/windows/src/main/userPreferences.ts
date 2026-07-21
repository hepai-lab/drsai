import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopUserPreference,
  DesktopUserPreferenceCategory,
  DesktopUserPreferenceDeleteRequest,
  DesktopUserPreferenceDeleteResult,
  DesktopUserPreferenceUpsertRequest,
  DesktopUserPreferenceValue,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const USER_PREFERENCES_FILE = join(DRSAI_HOME, "desktop", "user-preferences.json");

const ALLOWED_VALUES: Record<DesktopUserPreferenceCategory, readonly DesktopUserPreferenceValue[]> = {
  output_language: ["zh", "en"],
  chart_gridlines: ["hidden", "visible"],
  report_format: ["presentation", "report", "summary"],
  audience: ["manager", "expert", "general"],
};

interface UserPreferenceStore {
  preferences: DesktopUserPreference[];
}

export async function listUserPreferences(): Promise<DesktopUserPreference[]> {
  return (await readStore()).preferences.slice().sort((left, right) => left.category.localeCompare(right.category));
}

export async function upsertUserPreference(rawRequest: unknown): Promise<DesktopUserPreference> {
  const request = validateUpsertRequest(rawRequest);
  const store = await readStore();
  const existing = store.preferences.find((item) => item.category === request.category);
  const now = new Date().toISOString();
  const preference: DesktopUserPreference = {
    category: request.category,
    value: request.value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: "explicit_user_request",
  };
  store.preferences = [preference, ...store.preferences.filter((item) => item.category !== request.category)];
  await writeStore(store);
  return preference;
}

export async function deleteUserPreference(rawRequest: unknown): Promise<DesktopUserPreferenceDeleteResult> {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("A user preference delete request is required.");
  const category = (rawRequest as Partial<DesktopUserPreferenceDeleteRequest>).category;
  if (!isCategory(category)) throw new Error("User preference category is not supported.");
  const store = await readStore();
  const nextPreferences = store.preferences.filter((item) => item.category !== category);
  const removed = nextPreferences.length !== store.preferences.length;
  if (removed) await writeStore({ preferences: nextPreferences });
  return { category, removed };
}

async function readStore(): Promise<UserPreferenceStore> {
  try {
    const parsed = JSON.parse(await readFile(USER_PREFERENCES_FILE, "utf8")) as Partial<UserPreferenceStore>;
    if (!Array.isArray(parsed.preferences)) return { preferences: [] };
    const byCategory = new Map<DesktopUserPreferenceCategory, DesktopUserPreference>();
    for (const item of parsed.preferences) {
      if (!isPreference(item) || byCategory.has(item.category)) continue;
      byCategory.set(item.category, item);
    }
    return { preferences: [...byCategory.values()] };
  } catch {
    return { preferences: [] };
  }
}

async function writeStore(store: UserPreferenceStore): Promise<void> {
  await mkdir(dirname(USER_PREFERENCES_FILE), { recursive: true });
  const temporaryPath = `${USER_PREFERENCES_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, USER_PREFERENCES_FILE);
}

function validateUpsertRequest(rawRequest: unknown): DesktopUserPreferenceUpsertRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("A user preference request is required.");
  const request = rawRequest as Partial<DesktopUserPreferenceUpsertRequest>;
  if (!isCategory(request.category)) throw new Error("User preference category is not supported.");
  if (!ALLOWED_VALUES[request.category].includes(request.value as DesktopUserPreferenceValue)) {
    throw new Error("User preference value is not supported for this category.");
  }
  if (request.source !== "explicit_user_request") throw new Error("Preferences are saved only after an explicit user request.");
  return request as DesktopUserPreferenceUpsertRequest;
}

function isPreference(value: unknown): value is DesktopUserPreference {
  const item = value as DesktopUserPreference;
  return Boolean(
    item &&
    isCategory(item.category) &&
    ALLOWED_VALUES[item.category].includes(item.value) &&
    item.source === "explicit_user_request" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isCategory(value: unknown): value is DesktopUserPreferenceCategory {
  return value === "output_language" || value === "chart_gridlines" || value === "report_format" || value === "audience";
}
