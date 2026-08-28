import { AlertTriangle } from "lucide-react";
import type { AppLanguage } from "../../navigation";
import type { AgentFileTraceEvent } from "./AgentFileActivityPanel";

export function FileConflictPanel({
  events,
  language,
}: {
  events: AgentFileTraceEvent[];
  language: AppLanguage;
}): React.JSX.Element | null {
  const zh = language === "zh";
  const conflicts = collectConflicts(events);
  if (conflicts.length === 0) return null;
  return (
    <section className="files-conflicts" aria-label="File conflicts">
      <div className="files-conflicts-title">
        <AlertTriangle size={13} />
        <span>{zh ? "多 run 冲突" : "Run Conflicts"}</span>
        <small>{conflicts.length} files</small>
      </div>
      <ol>
        {conflicts.slice(0, 10).map((conflict) => (
          <li key={conflict.path}>
            <strong title={conflict.path}>{conflict.path}</strong>
            <span>{conflict.runs.join(" / ")}</span>
            <small>{conflict.actions.join(", ")}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function collectConflicts(events: AgentFileTraceEvent[]): Array<{
  actions: string[];
  path: string;
  runs: string[];
}> {
  const writes = events.filter((event) =>
    event.action === "agent_file_write" ||
    event.action === "agent_file_delete" ||
    event.action === "agent_artifact",
  );
  const byPath = new Map<string, AgentFileTraceEvent[]>();
  for (const event of writes) {
    byPath.set(event.path, [...(byPath.get(event.path) ?? []), event]);
  }
  return Array.from(byPath.entries())
    .map(([path, pathEvents]) => {
      const runs = unique(pathEvents.map((event) => extractRunId(event.snapshotId)));
      return {
        actions: unique(pathEvents.map((event) => event.action)),
        path,
        runs,
      };
    })
    .filter((item) => item.runs.length > 1);
}

function extractRunId(snapshotId: string): string {
  const match = snapshotId.match(/^(?:evt|run)-(.+?)-[a-z0-9-]+$/i);
  return match?.[1] ?? snapshotId;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
