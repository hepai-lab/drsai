import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { RunLogEntry } from "../../../components/types/datamodel";
import { formatUnixForDisplayZhCN } from "../../../utils/apiDatetime";

interface Props {
  logs: RunLogEntry[];
}

const LEVELS = ["ERROR", "WARNING", "INFO", "DEBUG"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_DOT: Record<Level, string> = {
  ERROR: "bg-red-400",
  WARNING: "bg-amber-400",
  INFO: "bg-violet-400",
  DEBUG: "bg-cyan-400",
};

const COLLAPSE_THRESHOLD = 500;

const formatTs = (t?: number | string) => {
  if (t === undefined || t === null) return "--";
  const s = formatUnixForDisplayZhCN(t as number | string);
  return s === "—" ? "--" : s;
};

const LogEntry: React.FC<{ log: RunLogEntry }> = React.memo(({ log }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const level = ((log.send_level || "INFO") as string).toUpperCase() as Level;
  const long = log.content.length > COLLAPSE_THRESHOLD;
  const displayContent =
    long && !expanded ? log.content.slice(0, COLLAPSE_THRESHOLD) + "…" : log.content;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(log.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [log.content]);

  return (
    <div className="rounded-lg border border-gray-800">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-800/50">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono text-[11px] text-slate-400 flex-shrink-0">
            {formatTs(log.send_time_stamp)}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium flex-shrink-0`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[level] ?? LEVEL_DOT.INFO}`} />
            {level}
          </span>
          <span className="text-[11px] text-slate-400 truncate">
            {log.source || "agent"}
          </span>
          {log.content_type && log.content_type !== "log" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/10 text-violet-300 border border-violet-500/30 flex-shrink-0">
              {log.content_type}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-white/10 transition-colors text-slate-500 hover:text-slate-300 flex-shrink-0"
          title="Copy"
        >
          {copied ? <Check size={13} className="text-violet-400" /> : <Copy size={13} />}
        </button>
      </div>
      {/* Body */}
      <div className="px-3 py-2">
        {log.title && (
          <div className="text-sm font-medium text-slate-200 mb-1">{log.title}</div>
        )}
        <pre className="max-w-full whitespace-pre-wrap break-words font-mono text-xs text-slate-300 leading-relaxed select-text [overflow-wrap:anywhere]">
          {displayContent}
        </pre>
        {long && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp size={12} /> 收起
              </>
            ) : (
              <>
                <ChevronDown size={12} /> 展开全部 ({log.content.length} 字符)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
});

const LogExecutionDrawer: React.FC<Props> = ({ logs }) => {
  const [search, setSearch] = useState("");
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleLevel = useCallback((l: Level) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let list = logs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.content.toLowerCase().includes(q) ||
          (l.title && l.title.toLowerCase().includes(q)) ||
          (l.source && l.source.toLowerCase().includes(q))
      );
    }
    list = list.filter((l) => {
      const lv = ((l.send_level || "INFO") as string).toUpperCase() as Level;
      return levels.has(lv);
    });
    return list;
  }, [logs, search, levels]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  // Level counts
  const counts = useMemo(() => {
    const c: Record<Level, number> = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
    logs.forEach((l) => {
      const lv = ((l.send_level || "INFO") as string).toUpperCase() as Level;
      if (c[lv] !== undefined) c[lv]++;
    });
    return c;
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[100px]">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        {/* Level toggles */}
        <div className="flex items-center gap-0">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => toggleLevel(lv)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                levels.has(lv)
                  ? "text-slate-200"
                  : "text-slate-600 line-through"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[lv]} ${!levels.has(lv) ? "opacity-30" : ""}`} />
              {counts[lv]}
            </button>
          ))}
        </div>
        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors flex-shrink-0 ${
            autoScroll
              ? "bg-violet-500/10 text-violet-300 border-violet-500/30"
              : "bg-transparent text-slate-500 border-gray-700"
          }`}
        >
          {autoScroll ? "⬇ 自动" : "⬇ 手动"}
        </button>
      </div>

      {/* Log list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-2"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#475569 #0f0f0f" }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-sm text-slate-500">
            {logs.length === 0 ? "暂无日志" : "无匹配日志"}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((log, i) => (
              <LogEntry key={`${log.send_time_stamp ?? i}-${i}`} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LogExecutionDrawer;
