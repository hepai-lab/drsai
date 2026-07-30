import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChatEvent } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";
import { DRSAI_HOME } from "./paths";

const JOURNAL_FILE = join(DRSAI_HOME, "desktop", "chat-run-events.json");
const MAX_RUNS = 200;
const MAX_EVENTS = 500;
let queue = Promise.resolve();
interface Entry { updatedAt: number; events: ChatEvent[] }
type Journal = Record<string, Entry>;

export function recordChatRunEvent(event: ChatEvent): void {
  if (!event.runId) return;
  queue = queue.catch(() => undefined).then(async () => {
    const journal = await readJournal();
    const current = journal[event.runId!]?.events ?? [];
    const previous = current.at(-1);
    const mergeable = previous && previous.requestId === event.requestId && previous.type === event.type && (event.type === "chunk" || event.type === "reasoning");
    const events = mergeable
      ? [...current.slice(0, -1), { ...event, content: `${previous.content ?? ""}${event.content ?? ""}`.slice(-500_000) }]
      : [...current, event].slice(-MAX_EVENTS);
    journal[event.runId!] = { updatedAt: Date.now(), events };
    await writeJournal(Object.fromEntries(Object.entries(journal).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_RUNS)));
  });
}

export async function listRecordedChatRunEvents(runId: string): Promise<ChatEvent[]> {
  await queue.catch(() => undefined);
  return [...((await readJournal())[runId]?.events ?? [])];
}
export async function shutdownChatRunJournal(): Promise<void> { await queue.catch(() => undefined); }

async function readJournal(): Promise<Journal> {
  try {
    const value = JSON.parse(await readFile(JOURNAL_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Journal : {};
  } catch { return {}; }
}
async function writeJournal(journal: Journal): Promise<void> {
  await mkdir(dirname(JOURNAL_FILE), { recursive: true });
  const temporary = `${JOURNAL_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(journal)}\n`, { mode: 0o600 }); await replaceFileSafely(temporary, JOURNAL_FILE); }
  finally { await rm(temporary, { force: true }); }
}
