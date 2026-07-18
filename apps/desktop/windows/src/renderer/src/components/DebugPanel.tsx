import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Braces,
  Bug,
  CirclePause,
  CirclePlay,
  Clipboard,
  Download,
  ListTree,
  Search,
  Trash2,
} from "lucide-react";
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
  type DebugLogEntry,
  type DebugLogLevel,
} from "../debugLogStore";
import type { AppLanguage } from "../navigation";

type DebugView = "activity" | "raw";

interface DebugPanelProps {
  language: AppLanguage;
  onSelectTurn?: (turnId: string) => void;
}

export function DebugPanel({ language, onSelectTurn }: DebugPanelProps): React.JSX.Element {
  const logs = useSyncExternalStore(subscribeDebugLogs, getDebugLogs);
  const [visible, setVisible] = useState(logs);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<DebugView>("activity");
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<DebugLogLevel>>(new Set(["log", "info", "warn", "error"]));
  const outputRef = useRef<HTMLDivElement | null>(null);
  const zh = language === "zh";

  useEffect(() => {
    if (!paused) setVisible(logs);
  }, [logs, paused]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visible.filter((entry) => {
      const inView = view === "activity" ? entry.source === "activity" : entry.source !== "activity";
      if (!inView || !levels.has(entry.level)) return false;
      if (!normalizedQuery) return true;
      return [entry.message, entry.raw, entry.activityKind, entry.activityStatus]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [levels, query, view, visible]);

  const activityGroups = useMemo(() => groupActivities(filtered), [filtered]);

  useEffect(() => {
    if (view === "raw") outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [filtered.length, view]);

  function toggleLevel(level: DebugLogLevel): void {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function exportLogs(): void {
    const text = filtered.map((entry) => {
      const body = entry.raw || entry.message;
      return `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase()}] [${entry.source}] ${body}`;
    }).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `opendrsai-debug-${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="debug-panel" aria-label={zh ? "调试" : "Debug"}>
      <header className="debug-panel-header">
        <div><Bug size={16} aria-hidden="true" /><strong>{zh ? "调试" : "Debug"}</strong><span>{visible.length}</span></div>
        <div className="debug-panel-actions">
          <button type="button" onClick={() => setPaused(!paused)} title={paused ? (zh ? "继续" : "Resume") : (zh ? "暂停" : "Pause")} aria-label={paused ? (zh ? "继续捕获调试记录" : "Resume debug capture") : (zh ? "暂停捕获调试记录" : "Pause debug capture")}>
            {paused ? <CirclePlay size={15} /> : <CirclePause size={15} />}
          </button>
          <button type="button" onClick={exportLogs} title={zh ? "导出当前视图" : "Export current view"} aria-label={zh ? "导出当前调试视图" : "Export current debug view"}><Download size={15} /></button>
          <button
            type="button"
            data-testid="debug-clear-history"
            onClick={() => { clearDebugLogs(); setVisible([]); }}
            title={zh ? "清空历史" : "Clear history"}
            aria-label={zh ? "清空调试历史" : "Clear debug history"}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="debug-view-tabs" role="tablist" aria-label={zh ? "调试视图" : "Debug view"}>
        <button type="button" role="tab" aria-selected={view === "activity"} className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>
          <ListTree size={14} aria-hidden="true" />{zh ? "活动" : "Activity"}
        </button>
        <button type="button" role="tab" aria-selected={view === "raw"} className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>
          <Braces size={14} aria-hidden="true" />{zh ? "原始记录" : "Raw records"}
        </button>
      </div>

      <div className="debug-filter-bar">
        <label>
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "筛选当前视图" : "Filter current view"} />
        </label>
        <div>
          {(["log", "info", "warn", "error"] as DebugLogLevel[]).map((level) => (
            <button type="button" key={level} className={levels.has(level) ? `active ${level}` : ""} onClick={() => toggleLevel(level)}>{level}</button>
          ))}
        </div>
      </div>

      <div className={`debug-output ${view}`} ref={outputRef} role="log">
        {view === "activity" ? (
          activityGroups.length ? activityGroups.map((group) => (
            <ActivityGroup key={group.turnId} group={group} zh={zh} onSelectTurn={onSelectTurn} />
          )) : <DebugEmpty zh={zh} />
        ) : (
          filtered.length ? filtered.map((entry) => <RawDebugEntry key={entry.id} entry={entry} zh={zh} />) : <DebugEmpty zh={zh} />
        )}
      </div>
      <footer>{paused ? (zh ? "输出已暂停" : "Output paused") : (zh ? "实时捕获，清空不会影响会话" : "Live capture; clearing does not affect the conversation")}</footer>
    </section>
  );
}

interface ActivityGroupModel {
  turnId: string;
  entries: DebugLogEntry[];
}

function groupActivities(entries: DebugLogEntry[]): ActivityGroupModel[] {
  const groups = new Map<string, DebugLogEntry[]>();
  for (const entry of entries) {
    const turnId = entry.turnId || "unscoped";
    groups.set(turnId, [...(groups.get(turnId) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([turnId, groupEntries]) => ({ turnId, entries: groupEntries.sort((left, right) => left.timestamp - right.timestamp) }))
    .sort((left, right) => (right.entries.at(-1)?.timestamp ?? 0) - (left.entries.at(-1)?.timestamp ?? 0));
}

function ActivityGroup({
  group,
  zh,
  onSelectTurn,
}: {
  group: ActivityGroupModel;
  zh: boolean;
  onSelectTurn?: (turnId: string) => void;
}): React.JSX.Element {
  const hasAttention = group.entries.some((entry) => entry.activityStatus === "running" || entry.activityStatus === "pending" || entry.activityStatus === "error");
  const latest = group.entries.at(-1);
  return (
    <details className="debug-activity-group" open={hasAttention || undefined}>
      <summary>
        <span>{zh ? "本轮活动" : "Turn activity"}</span>
        <small>{group.entries.length}</small>
        <time>{latest ? new Date(latest.timestamp).toLocaleTimeString() : ""}</time>
      </summary>
      <ol>
        {group.entries.map((entry) => (
          <li key={entry.id} className={entry.activityStatus || "completed"}>
            <button type="button" disabled={!entry.turnId || !onSelectTurn} onClick={() => entry.turnId && onSelectTurn?.(entry.turnId)}>
              <span className="debug-activity-dot" aria-hidden="true" />
              <span>
                <strong>{entry.message}</strong>
                <small>{formatActivityKind(entry.activityKind, zh)} · {formatActivityStatus(entry.activityStatus, zh)}{entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ""}</small>
              </span>
              <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function RawDebugEntry({ entry, zh }: { entry: DebugLogEntry; zh: boolean }): React.JSX.Element {
  const body = entry.raw || entry.message;
  return (
    <article className={`debug-entry ${entry.level}`}>
      <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
      <span>{entry.source}</span>
      <pre>{body}</pre>
      <button type="button" className="debug-entry-copy" onClick={() => void navigator.clipboard.writeText(body)} title={zh ? "复制" : "Copy"} aria-label={zh ? "复制此调试记录" : "Copy this debug record"}>
        <Clipboard size={14} />
      </button>
    </article>
  );
}

function DebugEmpty({ zh }: { zh: boolean }): React.JSX.Element {
  return <div className="debug-empty">{zh ? "暂无匹配记录" : "No matching records"}</div>;
}

function formatActivityKind(kind: DebugLogEntry["activityKind"], zh: boolean): string {
  const labels = {
    tool: ["工具", "Tool"],
    model: ["模型", "Model"],
    retry: ["重试", "Retry"],
    file_change: ["文件", "File"],
    subtask: ["子任务", "Subtask"],
    log: ["日志", "Log"],
  } as const;
  const label = kind ? labels[kind] : undefined;
  return label ? label[zh ? 0 : 1] : (zh ? "活动" : "Activity");
}

function formatActivityStatus(status: DebugLogEntry["activityStatus"], zh: boolean): string {
  const labels = {
    pending: ["等待", "Pending"],
    running: ["进行中", "Running"],
    completed: ["已完成", "Completed"],
    error: ["失败", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  } as const;
  const label = status ? labels[status] : undefined;
  return label ? label[zh ? 0 : 1] : (zh ? "未知" : "Unknown");
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
