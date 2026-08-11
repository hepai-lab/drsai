import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRunEvent } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";
import { DRSAI_HOME } from "./paths";

const JOURNAL_FILE = join(DRSAI_HOME, "desktop", "agent-run-events.json");
const MAX_RUNS = 200;
const MAX_EVENTS_PER_RUN = 500;
let queue = Promise.resolve();
interface JournalEntry { updatedAt: number; events: AgentRunEvent[] }
type Journal = Record<string, JournalEntry>;

export function recordAgentRunEvent(event: AgentRunEvent): void {
  queue = queue.catch(() => undefined).then(async () => {
    const journal = await readJournal();
    const current = journal[event.runId]?.events ?? [];
    const previous = current[current.length - 1];
    const events = event.type === "chunk" && previous?.type === "chunk" && previous.requestId === event.requestId
      && previous.oaepItemId === event.oaepItemId
      ? [...current.slice(0, -1), { ...previous, content: `${previous.content ?? ""}${event.content ?? ""}`.slice(-500_000) }]
      : [...current, event].slice(-MAX_EVENTS_PER_RUN);
    journal[event.runId] = { updatedAt: Date.now(), events };
    const capped = Object.fromEntries(Object.entries(journal).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_RUNS));
    await writeJournal(capped);
  });
}

export async function listRecordedAgentRunEvents(runId: string): Promise<AgentRunEvent[]> {
  await queue.catch(() => undefined);
  return [...((await readJournal())[runId]?.events ?? [])];
}
export async function listLegacyAgentRunJournalEntries(): Promise<Record<string, AgentRunEvent[]>> {
  await queue.catch(() => undefined);
  const journal = await readJournal();
  return Object.fromEntries(Object.entries(journal).map(([runId, entry]) => [runId, [...entry.events]]));
}
export async function shutdownAgentRunJournal(): Promise<void> { await queue.catch(() => undefined); }

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
