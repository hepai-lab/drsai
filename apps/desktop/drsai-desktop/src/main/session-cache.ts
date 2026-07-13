import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DRSAI_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

const CACHE_DIR = join(DRSAI_HOME, "desktop");
const CACHE_FILE = join(CACHE_DIR, "sessions.json");
// Changed: state.db → drsai.db under workspace
const DB_PATH = join(DRSAI_HOME, "workspace", "drsai", "drsai.db");

export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
}

type BetterSqliteDatabase = {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => unknown[];
  };
  close: () => void;
};

// Generate a short, readable title from the first user message
function generateTitle(message: string): string {
  if (!message || !message.trim())
    return t("sessions.newConversation", getAppLocale());

  let text = message.trim();
  text = text.replace(/[#*_`~\[\]()]/g, "");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return t("sessions.newConversation", getAppLocale());
  if (text.length <= 50) return text;

  const words = text.split(" ");
  let title = "";
  for (const word of words) {
    if ((title + " " + word).trim().length > 45) break;
    title = (title + " " + word).trim();
  }
  return title || text.slice(0, 45) + "...";
}

// Extract first user message preview from Thread.messages JSON
function extractPreview(messagesJson: string | null): string {
  if (!messagesJson) return "";
  try {
    const msgs = JSON.parse(messagesJson);
    if (!Array.isArray(msgs)) return "";
    for (const m of msgs) {
      if (m.role === "user" && m.content?.trim()) {
        return m.content.trim().split("\n")[0].slice(0, 120);
      }
    }
  } catch {
    /* ignore malformed JSON */
  }
  return "";
}

function readCache(): CacheData {
  try {
    if (!existsSync(CACHE_FILE)) return { sessions: [], lastSync: 0 };
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(): BetterSqliteDatabase | null {
  if (!existsSync(DB_PATH)) return null;
  try {
    // Lazy-load the native module so missing Electron ABI bindings do not crash
    // the Sessions screen. If unavailable, we fall back to the JSON cache.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as new (
      path: string,
      options: { readonly: boolean },
    ) => BetterSqliteDatabase;
    return new Database(DB_PATH, { readonly: true });
  } catch (err) {
    console.warn("[session-cache] better-sqlite3 unavailable; using cached sessions only:", err);
    return null;
  }
}

// Sync from drsai DB to local cache — only fetches new/updated sessions
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const db = getDb();
  if (!db) return cache.sessions;

  try {
    const rows = db
      .prepare(`
        SELECT
          thread_id                AS id,
          updated_at               AS started_at,
          json_array_length(messages) AS message_count,
          json_extract(meta, '$.name') AS title,
          messages
        FROM thread
        WHERE user_id IS NOT NULL
          AND updated_at > ?
        ORDER BY updated_at DESC
      `)
      .all(cache.lastSync > 0 ? cache.lastSync - 300 : 0) as Array<{
      id: string;
      started_at: string;
      message_count: number;
      title: string | null;
      messages: string | null;
    }>;

    const existingById = new Map<string, CachedSession>();
    for (const s of cache.sessions) existingById.set(s.id, s);
    const newSessions: CachedSession[] = [];

    for (const row of rows) {
      const existing = existingById.get(row.id);
      if (existing) {
        existing.messageCount = row.message_count;
        continue;
      }

      let title = row.title || "";
      if (!title) {
        const preview = extractPreview(row.messages);
        title = preview
          ? generateTitle(preview)
          : t("sessions.newConversation", getAppLocale());
      }

      const startedAt = row.started_at
        ? new Date(row.started_at).getTime()
        : Date.now();

      newSessions.push({
        id: row.id,
        title,
        startedAt,
        source: "desktop",
        messageCount: row.message_count || 0,
        model: "",
      });
    }

    const allSessions = [...newSessions, ...cache.sessions];
    allSessions.sort((a, b) => b.startedAt - a.startedAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated);
    return updated.sessions;
  } catch {
    return cache.sessions;
  } finally {
    db.close();
  }
}

// Fast read from cache only (no DB access)
export function listCachedSessions(
  limit = 50,
  offset = 0,
): CachedSession[] {
  const cache = readCache();
  return cache.sessions.slice(offset, offset + limit);
}

// Update title in local cache only (sync)
export function updateSessionTitle(
  sessionId: string,
  title: string,
): boolean {
  const cache = readCache();
  const session = cache.sessions.find(s => s.id === sessionId);
  if (!session) return false;
  session.title = title;
  writeCache(cache);
  return true;
}

// Async variant that also calls gateway API
export async function updateSessionTitleAsync(
  sessionId: string,
  title: string,
): Promise<boolean> {
  updateSessionTitle(sessionId, title);
  try {
    const http = require("http") as typeof import("http");
    const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "18642", 10);
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${DRSAI_API_PORT}/v1/threads/${encodeURIComponent(sessionId)}/rename?name=${encodeURIComponent(title)}`,
        { method: "POST", timeout: 5000 },
        (res: any) => { res.resume(); resolve(); },
      );
      req.on("error", () => resolve());
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.end();
    });
    return true;
  } catch {
    return true;
  }
}
