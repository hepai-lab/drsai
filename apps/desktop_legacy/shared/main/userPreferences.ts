import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DesktopUserPreference, DesktopUserPreferenceCategory, DesktopUserPreferenceDeleteResult, DesktopUserPreferenceUpsertRequest, DesktopUserPreferenceValue } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";

const VALUES: Record<DesktopUserPreferenceCategory, readonly DesktopUserPreferenceValue[]> = {
  output_language: ["zh", "en"], chart_gridlines: ["hidden", "visible"], report_format: ["presentation", "report", "summary"], audience: ["manager", "expert", "general"],
};
type Store = { schemaVersion: 2; preferences: DesktopUserPreference[] };

export class UserPreferenceStore {
  #queue = Promise.resolve();
  constructor(readonly filePath: string) {}

  list(): Promise<DesktopUserPreference[]> { return this.#run(async () => (await this.#read()).preferences.slice().sort((a, b) => a.category.localeCompare(b.category))); }
  upsert(raw: unknown): Promise<DesktopUserPreference> {
    return this.#run(async () => {
      const request = validateUpsert(raw); const store = await this.#read(); const existing = store.preferences.find((item) => item.category === request.category); const now = new Date().toISOString();
      const preference: DesktopUserPreference = { category: request.category, value: request.value, createdAt: existing?.createdAt ?? now, updatedAt: now, source: "explicit_user_request" };
      await this.#write({ schemaVersion: 2, preferences: [preference, ...store.preferences.filter((item) => item.category !== request.category)] }); return preference;
    });
  }
  delete(raw: unknown): Promise<DesktopUserPreferenceDeleteResult> {
    return this.#run(async () => {
      const category = raw && typeof raw === "object" ? (raw as { category?: unknown }).category : undefined; if (!isCategory(category)) throw new Error("User preference category is not supported.");
      const store = await this.#read(); const preferences = store.preferences.filter((item) => item.category !== category); const removed = preferences.length !== store.preferences.length; if (removed) await this.#write({ schemaVersion: 2, preferences }); return { category, removed };
    });
  }
  async #read(): Promise<Store> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { schemaVersion?: unknown; preferences?: unknown };
      const byCategory = new Map<DesktopUserPreferenceCategory, DesktopUserPreference>();
      if (Array.isArray(parsed.preferences)) for (const item of parsed.preferences) if (isPreference(item) && !byCategory.has(item.category)) byCategory.set(item.category, item);
      return { schemaVersion: 2, preferences: [...byCategory.values()] };
    } catch { return { schemaVersion: 2, preferences: [] }; }
  }
  async #write(store: Store): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await replaceFileSafely(temporary, this.filePath); await chmod(this.filePath, 0o600).catch(() => undefined); }
    finally { await rm(temporary, { force: true }); }
  }
  #run<T>(operation: () => Promise<T>): Promise<T> { const run = this.#queue.catch(() => undefined).then(operation); this.#queue = run.then(() => undefined, () => undefined); return run; }
}

function validateUpsert(raw: unknown): DesktopUserPreferenceUpsertRequest { if (!raw || typeof raw !== "object") throw new Error("A user preference request is required."); const request = raw as Partial<DesktopUserPreferenceUpsertRequest>; if (!isCategory(request.category) || !VALUES[request.category].includes(request.value as DesktopUserPreferenceValue)) throw new Error("User preference value is not supported for this category."); if (request.source !== "explicit_user_request") throw new Error("Preferences are saved only after an explicit user request."); return request as DesktopUserPreferenceUpsertRequest; }
function isCategory(value: unknown): value is DesktopUserPreferenceCategory { return value === "output_language" || value === "chart_gridlines" || value === "report_format" || value === "audience"; }
function isPreference(value: unknown): value is DesktopUserPreference { const item = value as DesktopUserPreference; return Boolean(item && isCategory(item.category) && VALUES[item.category].includes(item.value) && item.source === "explicit_user_request" && typeof item.createdAt === "string" && typeof item.updatedAt === "string"); }

const dataRoot = process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai");
export const userPreferenceStore = new UserPreferenceStore(join(dataRoot, "desktop", "user-preferences.json"));
export const listUserPreferences = () => userPreferenceStore.list();
export const upsertUserPreference = (request: unknown) => userPreferenceStore.upsert(request);
export const deleteUserPreference = (request: unknown) => userPreferenceStore.delete(request);
