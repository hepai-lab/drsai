import { app, crashReporter } from "electron";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { DRSAI_HOME } from "./paths";
import { replaceFileSafely } from "./atomicFileReplace";

const ROOT = join(DRSAI_HOME, "desktop", "crash-feedback");
const INCIDENT_FILE = join(ROOT, "pending.json");
const ACTIONABLE_CRASH_REASONS = new Set(["crashed", "oom", "integrity-failure", "launch-failed", "abnormal-exit"]);
const MAX_INCIDENT_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface PendingCrashFeedback {
  incident_id: string;
  occurred_at: string;
  process_type: "main" | "renderer" | "utility" | "gpu";
  reason: string;
  exit_code?: number;
  crash_reporter_enabled: boolean;
}

export function initializeLocalCrashReporter(): void {
  // Crashpad collects locally. Upload remains off until the user explicitly
  // submits the recovery feedback through the normal privacy preview.
  crashReporter.start({
    productName: "OpenDrSai Desktop",
    uploadToServer: false,
    compress: true,
    rateLimit: true,
    globalExtra: { feedbackSchema: "opendrsai-feedback/1" },
  });
}

export async function recordCrashIncident(input: Omit<PendingCrashFeedback, "incident_id" | "occurred_at" | "crash_reporter_enabled">): Promise<void> {
  if (!ACTIONABLE_CRASH_REASONS.has(input.reason)) return;
  const incident: PendingCrashFeedback = {
    ...input,
    incident_id: `crash-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    occurred_at: new Date().toISOString(),
    crash_reporter_enabled: true,
  };
  await atomicJson(INCIDENT_FILE, incident);
}

export async function getPendingCrashFeedback(): Promise<PendingCrashFeedback | null> {
  try {
    const value = JSON.parse(await readFile(INCIDENT_FILE, "utf8")) as PendingCrashFeedback;
    const occurredAt = Date.parse(value?.occurred_at || "");
    const valid = value
      && typeof value.incident_id === "string"
      && typeof value.reason === "string"
      && ACTIONABLE_CRASH_REASONS.has(value.reason)
      && Number.isFinite(occurredAt)
      && occurredAt <= Date.now()
      && Date.now() - occurredAt <= MAX_INCIDENT_AGE_MS;
    if (!valid) {
      await rm(INCIDENT_FILE, { force: true });
      return null;
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") await rename(INCIDENT_FILE, `${INCIDENT_FILE}.corrupt-${Date.now()}`).catch(() => undefined);
    return null;
  }
}

export async function clearPendingCrashFeedback(incidentId: string): Promise<boolean> {
  const pending = await getPendingCrashFeedback();
  if (!pending || pending.incident_id !== incidentId) return false;
  await rm(INCIDENT_FILE, { force: true });
  return true;
}

export async function latestCrashDumpBase64(): Promise<{ data: string; byteLength: number; name: string } | null> {
  try {
    const root = app.getPath("crashDumps");
    const candidates = await collectDumpFiles(root);
    const newest = candidates.sort((a, b) => b.modified - a.modified)[0];
    if (!newest || newest.size <= 0 || newest.size > 10_000_000) return null;
    return { data: (await readFile(newest.path)).toString("base64"), byteLength: newest.size, name: newest.name };
  } catch { return null; }
}

async function collectDumpFiles(root: string): Promise<Array<{ path: string; name: string; size: number; modified: number }>> {
  const found: Array<{ path: string; name: string; size: number; modified: number }> = [];
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child, depth + 1);
      else if (entry.isFile() && /\.dmp$/i.test(entry.name)) { const info = await stat(child); found.push({ path: child, name: entry.name, size: info.size, modified: info.mtimeMs }); }
    }
  };
  await visit(root, 0); return found;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await replaceFileSafely(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally { await rm(temporary, { force: true }); }
}
