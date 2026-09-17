import type { AgentRunEvent } from "../api/desktopApi";
import { listLegacyAgentRunJournalEntries } from "./agentRunJournal";
import { connectRuntimeClientForWorkspace } from "./runtimeClient";
import { listThreads, updateThread } from "./threads";

export interface LegacyAgentRunMigrationSummary {
  candidates: number;
  migrated: number;
  skipped: number;
  failed: number;
  itemsCreated: number;
}

/** Imports only pre-OAEP Agent journals. Current Runtime-backed Agent events
 * carry OAEP identities and must never be re-imported as legacy history. */
export async function migrateLegacyAgentRunsToRuntime(): Promise<LegacyAgentRunMigrationSummary> {
  const summary: LegacyAgentRunMigrationSummary = { candidates: 0, migrated: 0, skipped: 0, failed: 0, itemsCreated: 0 };
  const [threads, journal] = await Promise.all([listThreads(), listLegacyAgentRunJournalEntries()]);
  for (const thread of threads) {
    const legacyRunId = thread.lastRunId;
    const events = legacyRunId ? journal[legacyRunId] : undefined;
    if (thread.kind !== "agent_run" || thread.runtimeSessionId || !legacyRunId || !thread.workspacePath || !events?.length) continue;
    if (!isLegacyJournal(events)) continue;
    summary.candidates += 1;
    try {
      const { client, workspaceId } = await connectRuntimeClientForWorkspace(thread.workspacePath);
      const result = await client.importLegacyDesktopAgentRun({
        workspace_id: workspaceId,
        thread_id: thread.id,
        run_id: legacyRunId,
        title: thread.title,
        created_at: thread.createdAt,
        updated_at: thread.updatedAt,
        events: events.map((event) => ({ ...event })),
      });
      await updateThread({
        id: thread.id,
        runtimeSessionId: result.session_id,
        lastRunId: result.run_id,
        status: result.terminal_status === "failed" ? "error" : "idle",
        messageCount: Math.max(thread.messageCount || 0, result.oaep_item_count),
      });
      summary.itemsCreated += result.items_created;
      if (result.session_created || result.run_created || result.items_created > 0) summary.migrated += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn("[desktop] Legacy Agent Run migration deferred:", error instanceof Error ? error.message : String(error));
    }
  }
  return summary;
}

export function isLegacyJournal(events: AgentRunEvent[]): boolean {
  const meaningful = events.filter((event) => !["start", "done", "error", "aborted"].includes(event.type));
  return meaningful.length > 0 && meaningful.every((event) => !event.oaepItemId && event.structuredSequence == null);
}
