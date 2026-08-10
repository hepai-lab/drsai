import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AlertTriangle,
  Braces,
  BrainCircuit,
  Bug,
  CirclePause,
  CirclePlay,
  Clipboard,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  ListTree,
  Network,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { requestAppDecision } from "./AppDecisionDialog";
import type { AgentRunDiagnosticState, DiagnosticEvent, DiagnosticIncident, DiagnosticPackagePreview, DiagnosticSnapshot, DiagnosticSourceContext, DiagnosticSourceContextRequest, DiagnosticSourceLocation, DiagnosticTrace, InteractiveDebugPolicy, InteractiveDebugScope, InteractiveDebugSession, InteractiveDebugTarget, InteractiveDebugVariable, ProductionDiagnosticStatus } from "@shared/diagnostics";
import type { StructuredActivityEvent } from "@shared/structuredConversation";
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
  type DebugLogEntry,
  type DebugLogLevel,
} from "../debugLogStore";
import type { AppLanguage } from "../navigation";
import { copyTextSafely } from "../clipboard";

type DebugView = "agent" | "app-errors" | "runtime" | "overview" | "traces" | "errors" | "causes" | "interactive" | "production" | "activity" | "raw";
type RuntimeLogScope = "current-agent" | "all-agent" | "app" | "all";

interface DebugPanelProps {
  language: AppLanguage;
  onSelectTurn?: (turnId: string) => void;
  onPrepareRerun?: (runId: string) => boolean;
  requestedView?: { view: DebugView; nonce: number; runId?: string } | null;
}

export function DebugPanel({ language, onSelectTurn, onPrepareRerun, requestedView }: DebugPanelProps): React.JSX.Element {
  const logs = useSyncExternalStore(subscribeDebugLogs, getDebugLogs);
  const [visible, setVisible] = useState(logs);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<DebugView>("agent");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<DebugLogLevel>>(new Set(["log", "info", "warn", "error"]));
  const [runtimeScope, setRuntimeScope] = useState<RuntimeLogScope>("current-agent");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sourceRequest, setSourceRequest] = useState<DiagnosticSourceContextRequest | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const zh = language === "zh";

  useEffect(() => {
    if (!paused) setVisible(logs);
  }, [logs, paused]);

  useEffect(() => {
    if (!requestedView) return;
    setView(requestedView.view);
    if (["overview", "traces", "errors", "causes", "interactive", "production", "activity", "raw"].includes(requestedView.view)) {
      setAdvancedOpen(true);
    }
  }, [requestedView]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    void window.openDrSai.getDiagnosticSnapshot({ limit: 1_000 }).then((next) => {
      if (!cancelled) setSnapshot(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [logs.length, paused]);

  const activeRun = requestedView?.runId ? (
    snapshot?.agentRuns?.find((item) => item.runId === requestedView.runId || item.id === requestedView.runId)
  ) : (
    snapshot?.agentRuns?.find((item) => !["completed", "failed", "cancelled"].includes(item.status)) ?? snapshot?.agentRuns?.[0]
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visible.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (view === "activity" && entry.source !== "activity") return false;
      if (view === "runtime" && !matchesRuntimeScope(entry, runtimeScope, activeRun)) return false;
      if (view === "raw" && entry.source === "activity") return false;
      if (!normalizedQuery) return true;
      return [entry.message, entry.raw, entry.activityKind, entry.activityStatus, formatActivitySearchText(entry.activity), entry.module, entry.component, entry.operation, entry.traceId]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [activeRun, levels, query, runtimeScope, view, visible]);

  const diagnosticEvents = useMemo(() => filterDiagnosticEvents(snapshot?.events ?? [], query), [query, snapshot?.events]);
  const traces = useMemo(() => filterTraces(snapshot?.traces ?? [], diagnosticEvents, query), [diagnosticEvents, query, snapshot?.traces]);
  const errors = diagnosticEvents.filter((event) => event.status === "failed" || event.level === "error").reverse();
  const activityGroups = useMemo(() => groupActivities(visible.filter((entry) => entry.source === "activity")), [visible]);

  useEffect(() => {
    if (view === "raw" || view === "runtime") outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [filtered.length, view]);

  function toggleLevel(level: DebugLogLevel): void {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  async function exportLogs(): Promise<void> {
    const result = await window.openDrSai.exportDiagnostics();
    setActionMessage(result.message);
  }

  async function clearHistory(): Promise<void> {
    await window.openDrSai.clearDiagnostics();
    clearDebugLogs();
    setVisible([]);
    setSnapshot(await window.openDrSai.getDiagnosticSnapshot({ limit: 1_000 }));
    setActionMessage(zh ? "诊断记录已清空" : "Diagnostic history cleared");
  }

  async function updateIssue(clusterId: string, action: "mark-known" | "ignore" | "resolve" | "reopen"): Promise<void> {
    const result = await window.openDrSai.updateDiagnosticIssue({ clusterId, action });
    setActionMessage(result.message);
    if (result.updated) setSnapshot(await window.openDrSai.getDiagnosticSnapshot({ limit: 1_000 }));
  }

  const tabs: Array<{ id: DebugView; icon: typeof Activity; zh: string; en: string }> = [
    { id: "agent", icon: Activity, zh: "Agent", en: "Agent" },
    { id: "app-errors", icon: AlertTriangle, zh: "App 错误", en: "App Errors" },
    { id: "runtime", icon: ScrollText, zh: "运行日志", en: "Runtime Log" },
  ];
  const advancedTabs: Array<{ id: DebugView; icon: typeof Activity; zh: string; en: string }> = [
    { id: "overview", icon: Activity, zh: "概览", en: "Overview" },
    { id: "traces", icon: Network, zh: "链路", en: "Traces" },
    { id: "errors", icon: AlertTriangle, zh: "全部错误", en: "All Errors" },
    { id: "causes", icon: BrainCircuit, zh: "根因", en: "Causes" },
    { id: "interactive", icon: Bug, zh: "调试", en: "Debug" },
    { id: "production", icon: ShieldCheck, zh: "治理", en: "Governance" },
    { id: "activity", icon: ListTree, zh: "活动", en: "Activity" },
    { id: "raw", icon: Braces, zh: "原始", en: "Raw" },
  ];

  return (
    <section className="debug-panel" aria-label={zh ? "运行诊断中心" : "Runtime diagnostics"}>
      <header className="debug-panel-header">
        <div><Bug size={16} aria-hidden="true" /><strong>{zh ? "运行诊断" : "Diagnostics"}</strong><span>{snapshot?.storage.eventCount ?? visible.length}</span></div>
        <div className="debug-panel-actions">
          <button type="button" onClick={() => setPaused(!paused)} title={paused ? (zh ? "继续" : "Resume") : (zh ? "暂停" : "Pause")} aria-label={paused ? (zh ? "继续捕获诊断记录" : "Resume diagnostic capture") : (zh ? "暂停捕获诊断记录" : "Pause diagnostic capture")}>
            {paused ? <CirclePlay size={15} /> : <CirclePause size={15} />}
          </button>
          <button type="button" onClick={() => void exportLogs()} title={zh ? "导出诊断包" : "Export diagnostics"} aria-label={zh ? "导出脱敏诊断包" : "Export redacted diagnostic package"}><Download size={15} /></button>
          <button type="button" data-testid="debug-clear-history" onClick={() => void clearHistory()} title={zh ? "清空历史" : "Clear history"} aria-label={zh ? "清空调试历史" : "Clear diagnostic history"}><Trash2 size={15} /></button>
        </div>
      </header>

      <div className="debug-view-tabs" role="tablist" aria-label={zh ? "诊断视图" : "Diagnostic view"}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button type="button" key={tab.id} role="tab" aria-selected={view === tab.id} className={view === tab.id ? "active" : ""} onClick={() => setView(tab.id)}><Icon size={13} aria-hidden="true" /><span>{zh ? tab.zh : tab.en}</span></button>;
        })}
        <button type="button" className={advancedOpen ? "advanced active" : "advanced"} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((current) => !current)}><Braces size={13} /><span>{zh ? "高级" : "Advanced"}</span></button>
      </div>
      {advancedOpen && <div className="debug-advanced-tabs" role="tablist" aria-label={zh ? "高级诊断视图" : "Advanced diagnostic views"}>{advancedTabs.map((tab) => { const Icon = tab.icon; return <button type="button" key={tab.id} role="tab" aria-selected={view === tab.id} className={view === tab.id ? "active" : ""} onClick={() => setView(tab.id)}><Icon size={12} /><span>{zh ? tab.zh : tab.en}</span></button>; })}</div>}

      <div className="debug-filter-bar">
        <label><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "筛选模块、操作、链路或消息" : "Filter module, operation, trace, or message"} /></label>
        {view === "runtime" && <div className="runtime-log-scopes">{([
          ["current-agent", zh ? "当前任务" : "Current"], ["all-agent", zh ? "全部 Agent" : "All Agents"], ["app", "App"], ["all", zh ? "全部" : "All"],
        ] as Array<[RuntimeLogScope, string]>).map(([scope, label]) => <button type="button" key={scope} className={runtimeScope === scope ? "active" : ""} onClick={() => setRuntimeScope(scope)}>{label}</button>)}</div>}
        {(view === "activity" || view === "runtime" || view === "raw") && <div>{(["log", "info", "warn", "error"] as DebugLogLevel[]).map((level) => <button type="button" key={level} className={levels.has(level) ? `active ${level}` : ""} onClick={() => toggleLevel(level)}>{level}</button>)}</div>}
      </div>

      <div className={`debug-output ${view}`} ref={outputRef} role="log">
        {view === "agent" && <AgentDiagnosticView snapshot={snapshot} requestedRunId={requestedView?.runId} activityGroups={activityGroups} runtimeLogs={visible} zh={zh} onOpenSource={(source, workspaceId) => setSourceRequest({ source, workspaceId })} onSelectTurn={onSelectTurn} onPrepareRerun={onPrepareRerun} onMessage={setActionMessage} />}
        {view === "app-errors" && <AppErrorView snapshot={snapshot} zh={zh} onOpenSource={(source, workspaceId) => setSourceRequest({ source, workspaceId })} />}
        {view === "overview" && <DiagnosticOverview snapshot={snapshot} traces={traces} zh={zh} />}
        {view === "traces" && (traces.length ? traces.map((trace) => <TraceCard key={trace.traceId} trace={trace} zh={zh} onOpenSource={(source, workspaceId) => setSourceRequest({ source, workspaceId })} />) : <DebugEmpty zh={zh} />)}
        {view === "errors" && (errors.length ? errors.map((event) => <DiagnosticErrorCard key={event.id} event={event} zh={zh} onOpenSource={(source) => setSourceRequest({ source, workspaceId: event.workspaceId })} />) : <DebugEmpty zh={zh} />)}
        {view === "causes" && <RootCauseView snapshot={snapshot} zh={zh} onUpdateIssue={updateIssue} />}
        {view === "interactive" && <InteractiveDebugWorkbench zh={zh} onOpenSource={(source) => setSourceRequest({ source })} onMessage={setActionMessage} />}
        {view === "production" && <ProductionDiagnosticsWorkbench zh={zh} onMessage={setActionMessage} />}
        {view === "activity" && (activityGroups.length ? activityGroups.map((group) => <ActivityGroup key={group.turnId} group={group} zh={zh} onSelectTurn={onSelectTurn} />) : <DebugEmpty zh={zh} />)}
        {view === "runtime" && (filtered.length ? filtered.map((entry) => <RuntimeLogEntry key={entry.id} entry={entry} zh={zh} />) : <DebugEmpty zh={zh} />)}
        {view === "raw" && (filtered.length ? filtered.map((entry) => <RawDebugEntry key={entry.id} entry={entry} zh={zh} />) : <DebugEmpty zh={zh} />)}
      </div>
      {sourceRequest && <SourceInspector request={sourceRequest} zh={zh} onClose={() => setSourceRequest(null)} onMessage={setActionMessage} />}
      <footer>{actionMessage ?? (paused ? (zh ? "显示已暂停，后台仍继续记录" : "View paused; background capture continues") : (zh ? "跨模块实时诊断，清空不会影响会话" : "Live cross-module diagnostics; clearing does not affect conversations"))}</footer>
    </section>
  );
}

function ProductionDiagnosticsWorkbench({ zh, onMessage }: { zh: boolean; onMessage: (message: string) => void }): React.JSX.Element {
  const [status, setStatus] = useState<ProductionDiagnosticStatus | null>(null);
  const [preview, setPreview] = useState<DiagnosticPackagePreview | null>(null);
  useEffect(() => { void window.openDrSai.getProductionDiagnosticStatus().then(setStatus).catch((error) => onMessage(String(error))); }, [onMessage]);
  async function setMode(mode: ProductionDiagnosticStatus["settings"]["mode"]): Promise<void> { setStatus(await window.openDrSai.updateProductionDiagnosticSettings({ mode })); }
  async function inspect(): Promise<void> { setPreview(await window.openDrSai.previewDiagnosticPackage()); }
  async function exportPackage(): Promise<void> { const result = await window.openDrSai.exportProductionDiagnosticPackage(); setPreview(result.preview); onMessage(result.message); }
  async function importPackage(): Promise<void> { const result = await window.openDrSai.importProductionDiagnosticPackage(); if (result) { setPreview(result.preview); onMessage(result.message); } }
  if (!status) return <DebugEmpty zh={zh} />;
  return <div className="production-diagnostics-workbench">
    <section><header><ShieldCheck size={16} /><span><strong>{zh ? "生产诊断治理" : "Production diagnostics governance"}</strong><small>{status.selfCheck} · {status.policySource}{status.degraded ? " · degraded" : ""}</small></span></header><label>{zh ? "诊断级别" : "Diagnostic level"}<select value={status.settings.mode} disabled={status.lockedSettings.includes("mode")} onChange={(event) => void setMode(event.target.value as ProductionDiagnosticStatus["settings"]["mode"])}><option value="off">Off</option><option value="basic">Basic</option><option value="detailed">Detailed</option><option value="interactive">Interactive</option></select></label><dl><div><dt>{zh ? "事件" : "Events"}</dt><dd>{status.observedEvents}</dd></div><div><dt>{zh ? "丢弃" : "Dropped"}</dt><dd>{status.droppedEvents}</dd></div><div><dt>{zh ? "磁盘预算" : "Disk budget"}</dt><dd>{status.budgets.diskMb} MB</dd></div><div><dt>{zh ? "内存预算" : "Memory budget"}</dt><dd>{status.budgets.memoryMb} MB</dd></div></dl>{status.selfCheckMessages.map((message) => <p key={message} className="warning">{message}</p>)}</section>
    <section><h3>{zh ? "隐私诊断包" : "Privacy-safe diagnostic package"}</h3><p>{zh ? "导出前会最小化、二次扫描、完整性校验并按策略加密。" : "Packages are minimized, rescanned, integrity checked, and encrypted before export."}</p><div className="production-package-actions"><button type="button" onClick={() => void inspect()}>{zh ? "预览" : "Preview"}</button><button type="button" onClick={() => void exportPackage()}>{zh ? "导出" : "Export"}</button><button type="button" onClick={() => void importPackage()}>{zh ? "离线导入" : "Offline import"}</button></div>{preview && <dl><div><dt>{zh ? "事件" : "Events"}</dt><dd>{preview.eventCount}</dd></div><div><dt>{zh ? "敏感项移除" : "Sensitive removed"}</dt><dd>{preview.sensitiveMatchesRemoved}</dd></div><div><dt>{zh ? "加密" : "Encrypted"}</dt><dd>{String(preview.encrypted)}</dd></div><div><dt>SHA-256</dt><dd title={preview.integritySha256}>{preview.integritySha256.slice(0, 12)}</dd></div></dl>}</section>
    <section><h3>{zh ? "发布门禁" : "Release gates"}</h3><ul>{status.releaseGates.map((gate) => <li key={gate.id} className={gate.passed ? "passed" : "failed"}><strong>{gate.passed ? "✓" : "!"} {gate.id}</strong><span>{gate.message}</span></li>)}</ul></section>
    <section><h3>{zh ? "审计记录" : "Audit trail"}</h3><ul>{status.audit.slice(0, 20).map((entry) => <li key={entry.id}><strong>{entry.action}</strong><span>{entry.result} · {new Date(entry.timestamp).toLocaleString()}</span></li>)}</ul></section>
  </div>;
}

function InteractiveDebugWorkbench({ zh, onOpenSource, onMessage }: { zh: boolean; onOpenSource: (source: DiagnosticSourceLocation) => void; onMessage: (message: string) => void }): React.JSX.Element {
  const [policy, setPolicy] = useState<InteractiveDebugPolicy | null>(null);
  const [targets, setTargets] = useState<InteractiveDebugTarget[]>([]);
  const [sessions, setSessions] = useState<InteractiveDebugSession[]>([]);
  const [targetId, setTargetId] = useState("");
  const [program, setProgram] = useState("");
  const [inspectorUrl, setInspectorUrl] = useState("");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("5678");
  const [breakpointFile, setBreakpointFile] = useState("");
  const [breakpointLine, setBreakpointLine] = useState("1");
  const [breakpointCondition, setBreakpointCondition] = useState("");
  const [scopes, setScopes] = useState<InteractiveDebugScope[]>([]);
  const [variables, setVariables] = useState<InteractiveDebugVariable[]>([]);
  const [expression, setExpression] = useState("");
  const [evaluation, setEvaluation] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.openDrSai.getInteractiveDebugPolicy(), window.openDrSai.listInteractiveDebugTargets(), window.openDrSai.listInteractiveDebugSessions()]).then(([nextPolicy, nextTargets, nextSessions]) => {
      if (cancelled) return;
      setPolicy(nextPolicy); setTargets(nextTargets); setSessions(nextSessions); setTargetId((current) => current || nextTargets.find((item) => item.available)?.id || nextTargets[0]?.id || "");
    }).catch((error) => onMessage(error instanceof Error ? error.message : String(error)));
    const unsubscribe = window.openDrSai.onInteractiveDebugEvent((session) => setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]));
    return () => { cancelled = true; unsubscribe(); };
  }, [onMessage]);

  const selectedTarget = targets.find((item) => item.id === targetId);
  const active = sessions[0];

  async function setDebuggingEnabled(enabled: boolean): Promise<void> {
    if (enabled && !await requestAppDecision({ id: "enable-interactive-debugging", tone: "danger", title: zh ? "启用交互调试？" : "Enable interactive debugging?", description: zh ? "交互调试可以启动或连接本地进程，并读取暂停时的变量。" : "Interactive debugging can launch or attach to local processes and inspect paused variables.", impact: zh ? "仅应在你信任当前工作区时启用；活动进程可能受到影响。" : "Enable only for a trusted workspace; active processes may be affected.", confirmLabel: zh ? "我信任并启用" : "Trust and enable" })) return;
    try {
      const nextPolicy = await window.openDrSai.updateInteractiveDebugPolicy({ enabled, acknowledgedRisk: true });
      const [nextTargets, nextSessions] = await Promise.all([window.openDrSai.listInteractiveDebugTargets(), window.openDrSai.listInteractiveDebugSessions()]);
      setPolicy(nextPolicy); setTargets(nextTargets); setSessions(nextSessions);
      onMessage(enabled ? (zh ? "交互调试已启用。" : "Interactive debugging enabled.") : (zh ? "交互调试已关闭，活动会话已安全终止。" : "Interactive debugging disabled; active sessions were safely terminated."));
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function start(): Promise<void> {
    try {
      const session = await window.openDrSai.startInteractiveDebugSession({ targetId, ...(program ? { program } : {}), ...(inspectorUrl ? { inspectorUrl } : {}), ...(selectedTarget?.kind === "remote-python" ? { host: remoteHost.trim(), port: Number(remotePort) } : {}), stopOnEntry: false });
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function control(action: "pause" | "continue" | "next" | "step-in" | "step-out" | "disconnect" | "terminate"): Promise<void> {
    if (!active) return;
    try { const session = await window.openDrSai.controlInteractiveDebugSession({ sessionId: active.id, action }); setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function addBreakpoint(): Promise<void> {
    if (!active || !breakpointFile.trim()) return;
    try { const session = await window.openDrSai.setInteractiveDebugBreakpoint({ sessionId: active.id, source: { file: breakpointFile.trim(), line: Math.max(1, Number(breakpointLine) || 1) }, condition: breakpointCondition.trim() || undefined }); setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function selectFrame(frameId: string): Promise<void> {
    if (!active) return;
    try { const nextScopes = await window.openDrSai.getInteractiveDebugScopes(active.id, frameId); setScopes(nextScopes); setVariables([]); if (nextScopes[0]) setVariables(await window.openDrSai.getInteractiveDebugVariables(active.id, nextScopes[0].variablesReference)); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function selectScope(scope: InteractiveDebugScope): Promise<void> {
    if (!active) return;
    try { setVariables(await window.openDrSai.getInteractiveDebugVariables(active.id, scope.variablesReference)); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function evaluate(): Promise<void> {
    if (!active?.activeFrameId || !expression.trim()) return;
    try { const result = await window.openDrSai.evaluateInteractiveDebugExpression({ sessionId: active.id, frameId: active.activeFrameId, expression }); setEvaluation(result.safe ? result.result : result.message); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="interactive-debug-workbench">
    <section className="interactive-debug-policy" data-testid="interactive-debug-policy"><h3>{zh ? "安全策略" : "Safety policy"}</h3><label><span><strong>{zh ? "允许交互调试" : "Allow interactive debugging"}</strong><small>{policy?.locked ? (zh ? "由环境策略锁定" : "Locked by environment policy") : (zh ? "默认关闭；仅对受信任工作区显式启用。" : "Off by default; enable explicitly for trusted workspaces only.")}</small></span><input type="checkbox" checked={policy?.enabled === true} disabled={!policy || policy.locked} onChange={(event) => void setDebuggingEnabled(event.target.checked)} /></label></section>
    <section className="interactive-debug-launch"><h3>{zh ? "调试目标" : "Debug target"}</h3><select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}{target.available ? "" : ` — ${zh ? "不可用" : "unavailable"}`}</option>)}</select>{selectedTarget?.kind === "python" && <input value={program} onChange={(event) => setProgram(event.target.value)} placeholder={zh ? "Python 程序路径" : "Python program path"} />}{selectedTarget?.kind === "node" && <input value={inspectorUrl} onChange={(event) => setInspectorUrl(event.target.value)} placeholder="ws://127.0.0.1:9229/..." />}{selectedTarget?.kind === "remote-python" && <div><input value={remoteHost} onChange={(event) => setRemoteHost(event.target.value)} aria-label="Remote Python tunnel host" /><input type="number" min="1" max="65535" value={remotePort} onChange={(event) => setRemotePort(event.target.value)} aria-label="Remote Python tunnel port" /></div>}<p>{selectedTarget?.reason || selectedTarget?.description}</p><button type="button" disabled={!selectedTarget?.available} onClick={() => void start()}>{zh ? "启动调试" : "Start debugging"}</button></section>
    {active && <>
      <section className={`interactive-debug-session ${active.state}`}><header><span className="diagnostic-state-dot" /><span><strong>{active.target.name}</strong><small>{active.state} · {active.pausedReason || active.message}</small></span></header><div className="interactive-debug-controls"><button type="button" onClick={() => void control(active.state === "paused" ? "continue" : "pause")}>{active.state === "paused" ? (zh ? "继续" : "Continue") : (zh ? "暂停" : "Pause")}</button><button type="button" disabled={active.state !== "paused"} onClick={() => void control("next")}>{zh ? "跳过" : "Step over"}</button><button type="button" disabled={active.state !== "paused"} onClick={() => void control("step-in")}>{zh ? "进入" : "Step in"}</button><button type="button" disabled={active.state !== "paused"} onClick={() => void control("step-out")}>{zh ? "跳出" : "Step out"}</button><button type="button" onClick={() => void control("disconnect")}>{zh ? "安全分离" : "Detach"}</button></div></section>
      <section className="interactive-debug-breakpoints"><h3>{zh ? "断点" : "Breakpoints"}</h3><div><input value={breakpointFile} onChange={(event) => setBreakpointFile(event.target.value)} placeholder={zh ? "源文件" : "Source file"} /><input type="number" min="1" value={breakpointLine} onChange={(event) => setBreakpointLine(event.target.value)} aria-label={zh ? "断点行号" : "Breakpoint line"} /><input value={breakpointCondition} onChange={(event) => setBreakpointCondition(event.target.value)} placeholder={zh ? "可选条件" : "Optional condition"} /><button type="button" onClick={() => void addBreakpoint()}>+</button></div><ul>{active.breakpoints.map((breakpoint) => <li key={breakpoint.id} className={breakpoint.verified ? "verified" : "pending"}><button type="button" onClick={() => onOpenSource(breakpoint.source)}>{formatLocation(breakpoint.source)}</button><span>{breakpoint.verified ? (zh ? "已绑定" : "Bound") : (zh ? "待绑定" : "Pending")}{breakpoint.condition ? ` · ${breakpoint.condition}` : ""}</span></li>)}</ul></section>
      <div className="interactive-debug-inspection"><section><h3>{zh ? "调用栈" : "Call stack"}</h3><ul>{active.stackFrames.map((frame) => <li key={frame.id}><button type="button" onClick={() => void selectFrame(frame.id)}><strong>{frame.name}</strong><small>{frame.source ? formatLocation(frame.source) : ""}</small></button></li>)}</ul></section><section><h3>{zh ? "作用域" : "Scopes"}</h3><ul>{scopes.map((scope) => <li key={scope.id}><button type="button" onClick={() => void selectScope(scope)}>{scope.name}</button></li>)}</ul></section><section><h3>{zh ? "变量" : "Variables"}</h3><ul>{variables.map((variable) => <li key={variable.name}><strong>{variable.name}</strong><code>{variable.sensitive ? "[REDACTED]" : variable.value}</code><small>{variable.type}</small></li>)}</ul></section></div>
      <section className="interactive-debug-evaluate"><h3>{zh ? "只读求值" : "Read-only evaluate"}</h3><div><input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder={zh ? "无副作用表达式" : "Side-effect-free expression"} /><button type="button" disabled={!active.activeFrameId} onClick={() => void evaluate()}>{zh ? "求值" : "Evaluate"}</button></div>{evaluation && <pre>{evaluation}</pre>}</section>
    </>}
  </div>;
}

function RootCauseView({ snapshot, zh, onUpdateIssue }: { snapshot: DiagnosticSnapshot | null; zh: boolean; onUpdateIssue: (clusterId: string, action: "mark-known" | "ignore" | "resolve" | "reopen") => Promise<void> }): React.JSX.Element {
  if (!snapshot || (!snapshot.rootCause.analyses.length && !snapshot.rootCause.clusters.length)) return <DebugEmpty zh={zh} />;
  return <div className="diagnostic-root-cause-view">
    <section><h3>{zh ? "根因分析" : "Root cause analysis"}</h3>{snapshot.rootCause.analyses.map((analysis) => <article key={analysis.traceId} className="diagnostic-cause-card">
      <header><BrainCircuit size={14} /><span><strong>{analysis.primary?.title ?? (zh ? "未确定根因" : "Undetermined cause")}</strong><small>{shortId(analysis.traceId)} · {Math.round((analysis.primary?.confidence ?? 0) * 100)}% {zh ? "置信度" : "confidence"}</small></span></header>
      <div className="diagnostic-confidence"><i style={{ width: `${Math.round((analysis.primary?.confidence ?? 0) * 100)}%` }} /></div>
      <p>{analysis.summary}</p>
      <details><summary>{zh ? "事实与推断" : "Facts and inference"}</summary><ul>{analysis.facts.map((fact) => <li key={fact}><strong>{zh ? "事实" : "Fact"}</strong>{fact}</li>)}{analysis.inferences.map((item) => <li key={item.text}><strong>{zh ? "推断" : "Inference"} {Math.round(item.confidence * 100)}%</strong>{item.text}</li>)}{analysis.uncertainties.map((item) => <li key={item}><strong>{zh ? "不确定" : "Uncertain"}</strong>{item}</li>)}</ul></details>
      {analysis.primary?.suggestedActions.length ? <ol>{analysis.primary.suggestedActions.map((action) => <li key={action}>{action}</li>)}</ol> : null}
      {analysis.alternatives.length ? <small>{zh ? "其他候选" : "Alternatives"}: {analysis.alternatives.map((item) => `${item.title} (${Math.round(item.confidence * 100)}%)`).join(" · ")}</small> : null}
      <button type="button" className="diagnostic-ai-brief" onClick={() => void copyTextSafely(createAiAnalysisBrief(analysis))}><Clipboard size={11} />{zh ? "复制 AI 分析材料" : "Copy AI analysis brief"}</button>
    </article>)}</section>
    <section><h3>{zh ? "错误聚类与趋势" : "Error clusters and trends"}</h3>{snapshot.rootCause.clusters.map((cluster) => <article key={cluster.id} className={`diagnostic-cluster-card ${cluster.state}`}>
      <header><span><strong>{cluster.title}</strong><small>{cluster.count}× · {cluster.trend} · {cluster.state}</small></span><time>{new Date(cluster.lastSeenAt).toLocaleString()}</time></header>
      {cluster.knownIssueNote && <p>{cluster.knownIssueNote}</p>}
      <footer>{cluster.state !== "known" && <button type="button" onClick={() => void onUpdateIssue(cluster.id, "mark-known")}>{zh ? "标为已知" : "Mark known"}</button>}{cluster.state !== "ignored" && <button type="button" onClick={() => void onUpdateIssue(cluster.id, "ignore")}>{zh ? "忽略" : "Ignore"}</button>}{cluster.state !== "resolved" && <button type="button" onClick={() => void onUpdateIssue(cluster.id, "resolve")}>{zh ? "标为已解决" : "Resolve"}</button>}{cluster.state !== "open" && <button type="button" onClick={() => void onUpdateIssue(cluster.id, "reopen")}><RotateCcw size={11} />{zh ? "重新打开" : "Reopen"}</button>}</footer>
    </article>)}</section>
  </div>;
}

function DiagnosticOverview({ snapshot, traces, zh }: { snapshot: DiagnosticSnapshot | null; traces: DiagnosticTrace[]; zh: boolean }): React.JSX.Element {
  if (!snapshot) return <DebugEmpty zh={zh} />;
  const active = traces.filter((trace) => !["completed", "failed", "cancelled"].includes(trace.status));
  const failed = traces.filter((trace) => trace.status === "failed");
  return <div className="diagnostic-overview">
    <div className="diagnostic-summary-grid">
      <span><strong>{active.length}</strong><small>{zh ? "正在运行" : "Active"}</small></span>
      <span><strong>{failed.length}</strong><small>{zh ? "失败链路" : "Failed"}</small></span>
      <span><strong>{snapshot.health.length}</strong><small>{zh ? "已登记组件" : "Components"}</small></span>
      <span><strong>{snapshot.droppedEvents}</strong><small>{zh ? "丢弃记录" : "Dropped"}</small></span>
    </div>
    <section><h3>{zh ? "当前运行位置" : "Current execution"}</h3>{active.length ? active.slice(0, 10).map((trace) => <TraceSummary key={trace.traceId} trace={trace} />) : <p>{zh ? "当前没有运行中的链路" : "No active traces"}</p>}</section>
    <section><h3>{zh ? "初步诊断" : "Findings"}</h3>{snapshot.findings.length ? <ul className="diagnostic-finding-list">{snapshot.findings.slice(0, 10).map((finding) => <li key={finding.id} className={finding.severity}><AlertTriangle size={13} /><span><strong>{finding.title}</strong><small>{finding.message}</small><em>{finding.suggestedAction}</em></span></li>)}</ul> : <p>{zh ? "暂未发现需要处理的问题" : "No actionable findings"}</p>}</section>
    <section><h3>{zh ? "组件健康" : "Component health"}</h3><ul className="diagnostic-health-list">{snapshot.health.map((item) => <li key={item.id} className={item.state}><span className="diagnostic-state-dot" /><span><strong>{item.component}</strong><small>{item.module} · {item.message}</small></span><time>{new Date(item.lastHeartbeatAt).toLocaleTimeString()}</time></li>)}</ul></section>
    <section><h3>{zh ? "性能热点" : "Performance hotspots"}</h3>{snapshot.deepTracing.performance.length ? <ul className="diagnostic-performance-list">{snapshot.deepTracing.performance.slice(0, 8).map((item) => <li key={item.key}><span><strong>{item.operation}</strong><small>{item.module} → {item.component} · {item.count}× · {item.failureCount} {zh ? "次失败" : "failed"}</small></span><time>P95 {formatDuration(item.p95DurationMs)}</time></li>)}</ul> : <p>{zh ? "尚无已完成操作的耗时样本" : "No completed operation samples yet"}</p>}</section>
    <section><h3>{zh ? "诊断资源" : "Diagnostic resources"}</h3>{snapshot.deepTracing.resources.at(-1) ? <p>{formatBytes(snapshot.deepTracing.resources.at(-1)!.rssBytes)} RSS · {formatBytes(snapshot.deepTracing.resources.at(-1)!.heapUsedBytes)} {zh ? "堆内存" : "heap"} · {snapshot.deepTracing.activeCheckpoints.length} {zh ? "个活动检查点" : "active checkpoints"}</p> : <p>{zh ? "尚无资源样本" : "No resource samples"}</p>}</section>
  </div>;
}

function TraceSummary({ trace }: { trace: DiagnosticTrace }): React.JSX.Element {
  const location = trace.activeEvent ?? trace.firstFailure ?? trace.events.at(-1);
  return <div className={`diagnostic-trace-summary ${trace.status}`}><span className="diagnostic-state-dot" /><span><strong>{trace.rootOperation}</strong><small>{location ? `${location.module} → ${location.component} → ${location.operation}` : trace.traceId}</small></span><time>{formatDuration(trace.durationMs ?? Math.max(0, Date.now() - Date.parse(trace.startedAt)))}</time></div>;
}

function TraceCard({ trace, zh, onOpenSource }: { trace: DiagnosticTrace; zh: boolean; onOpenSource: (source: DiagnosticSourceLocation, workspaceId?: string) => void }): React.JSX.Element {
  const depths = calculateDepths(trace.events);
  const started = Date.parse(trace.startedAt);
  const total = Math.max(1, (trace.endedAt ? Date.parse(trace.endedAt) : Date.now()) - started);
  return <details className={`diagnostic-trace-card ${trace.status}`} open={trace.status === "failed" || undefined}><summary><span className="diagnostic-state-dot" /><span><strong>{trace.rootOperation}</strong><small>{shortId(trace.traceId)} · {trace.events.length} {zh ? "个事件" : "events"} · {trace.machineIds?.length ?? 0} {zh ? "台机器" : "machines"}{trace.recovered ? ` · ${zh ? "已恢复" : "recovered"}` : ""}{trace.criticalPathMs ? ` · ${zh ? "关键路径" : "critical"} ${formatDuration(trace.criticalPathMs)}` : ""}</small></span><time>{formatDuration(trace.durationMs ?? Math.max(0, Date.now() - Date.parse(trace.startedAt)))}</time></summary><ol>{trace.events.map((event) => { const offset = Math.max(0, Date.parse(event.timestamp) - started); const left = Math.min(98, offset / total * 100); const width = Math.max(2, Math.min(100 - left, (event.durationMs ?? Math.max(1, total * .02)) / total * 100)); return <li key={event.id} className={event.status} style={{ "--diagnostic-depth": depths.get(event.id) ?? 0, "--waterfall-left": `${left}%`, "--waterfall-width": `${width}%` } as React.CSSProperties}><span className="diagnostic-state-dot" /><span><strong>{event.message}</strong><small>{event.module} → {event.component} · {event.operation}{event.machineId ? ` · ${shortId(event.machineId)}` : ""}</small><i className="diagnostic-waterfall"><b /></i>{event.source?.file && <button type="button" className="diagnostic-source-link" onClick={() => onOpenSource(event.source!, event.workspaceId)}><FileCode2 size={11} />{formatSource(event)}</button>}</span><time>{new Date(event.timestamp).toLocaleTimeString()}</time></li>; })}</ol></details>;
}

function DiagnosticErrorCard({ event, zh, onOpenSource }: { event: DiagnosticEvent; zh: boolean; onOpenSource: (source: DiagnosticSourceLocation) => void }): React.JSX.Element {
  const copyText = [event.message, ...(event.stack?.map((frame) => frame.raw) ?? [])].join("\n");
  return <article className="diagnostic-error-card"><header><AlertTriangle size={14} /><span><strong>{event.message}</strong><small>{event.module} → {event.component} · {event.operation}</small></span><button type="button" onClick={() => void copyTextSafely(copyText)} title={zh ? "复制错误" : "Copy error"}><Clipboard size={13} /></button></header>{event.errorCode && <p>{zh ? "错误代码" : "Error code"}: <code>{event.errorCode}</code></p>}{event.source?.file && <button type="button" className="diagnostic-primary-source" onClick={() => onOpenSource(event.source!)}><FileCode2 size={13} />{zh ? "查看代码位置" : "View source"}: <code>{formatSource(event)}</code></button>}{event.stack?.length ? <ol>{event.stack.map((frame, index) => <li key={`${event.id}-${index}`}><button type="button" disabled={!frame.file} onClick={() => frame.file && onOpenSource(frame)}><code>{frame.function || "<anonymous>"}</code><span>{frame.file ? `${frame.file}${frame.line ? `:${frame.line}${frame.column ? `:${frame.column}` : ""}` : ""}` : frame.raw}</span></button></li>)}</ol> : <p>{zh ? "该错误没有提供调用堆栈" : "No stack was provided for this error"}</p>}</article>;
}

function SourceInspector({ request, zh, onClose, onMessage }: { request: DiagnosticSourceContextRequest; zh: boolean; onClose: () => void; onMessage: (message: string) => void }): React.JSX.Element {
  const [context, setContext] = useState<DiagnosticSourceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferOriginal, setPreferOriginal] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.openDrSai.getDiagnosticSourceContext({ ...request, preferOriginal }).then((result) => {
      if (!cancelled) setContext(result);
    }).catch((error) => {
      if (!cancelled) onMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [onMessage, preferOriginal, request]);

  async function openSource(target: "system" | "editor" | "reveal"): Promise<void> {
    const result = await window.openDrSai.openDiagnosticSource({ ...request, preferOriginal, target });
    onMessage(result.message);
  }

  const numberedLines = context?.content?.split("\n") ?? [];
  return <aside className="diagnostic-source-inspector" aria-label={zh ? "源码查看器" : "Source inspector"}>
    <header>
      <FileCode2 size={14} />
      <span><strong>{zh ? "源码位置" : "Source location"}</strong><small>{context ? formatLocation(context.location) : formatLocation(request.source)}</small></span>
      {context?.mapping.status === "mapped" && <button type="button" onClick={() => setPreferOriginal(!preferOriginal)}>{preferOriginal ? (zh ? "查看生成代码" : "Generated") : (zh ? "查看原始源码" : "Original")}</button>}
      <button type="button" onClick={onClose} title={zh ? "关闭源码" : "Close source"}><X size={14} /></button>
    </header>
    {loading ? <div className="diagnostic-source-status">{zh ? "正在解析源码…" : "Resolving source…"}</div> : !context?.available ? <div className="diagnostic-source-status error"><AlertTriangle size={14} />{context?.reason ?? (zh ? "源码不可用" : "Source unavailable")}</div> : <>
      <div className="diagnostic-source-meta"><span>{context.address.remote ? (zh ? "远程" : "Remote") : (zh ? "本地" : "Local")}</span><span>{context.address.trusted ? (zh ? "可信范围" : "Trusted scope") : (zh ? "未信任" : "Untrusted")}</span><span>{context.mapping.status}</span>{context.address.version && <span title={context.address.version}>{zh ? "版本" : "Version"} {context.address.version.slice(0, 8)}</span>}{context.redacted && <span>{zh ? "已脱敏" : "Redacted"}</span>}{context.truncated && <span>{zh ? "已截断" : "Truncated"}</span>}</div>
      <pre className="diagnostic-source-code">{numberedLines.map((line, index) => { const number = (context.startLine ?? 1) + index; return <span key={number} className={number === context.highlightLine ? "highlight" : ""}><i>{number}</i><code>{line || " "}</code></span>; })}</pre>
      <footer><button type="button" disabled={!context.canOpen} onClick={() => void openSource("editor")}><FileCode2 size={12} />{zh ? "编辑器打开" : "Editor"}</button><button type="button" disabled={!context.canOpen} onClick={() => void openSource("system")}><ExternalLink size={12} />{zh ? "系统打开" : "Open"}</button><button type="button" disabled={!context.canOpen} onClick={() => void openSource("reveal")}><FolderOpen size={12} />{zh ? "显示文件" : "Reveal"}</button><button type="button" onClick={() => void copyTextSafely(`${formatLocation(context.location)}\n${context.content ?? ""}`)}><Clipboard size={12} />{zh ? "复制" : "Copy"}</button></footer>
    </>}
  </aside>;
}

interface ActivityGroupModel { turnId: string; entries: DebugLogEntry[]; }

function groupActivities(entries: DebugLogEntry[]): ActivityGroupModel[] {
  const groups = new Map<string, DebugLogEntry[]>();
  for (const entry of entries) { const turnId = entry.turnId || "unscoped"; groups.set(turnId, [...(groups.get(turnId) ?? []), entry]); }
  return [...groups.entries()].map(([turnId, groupEntries]) => ({ turnId, entries: groupEntries.sort((left, right) => left.timestamp - right.timestamp) })).sort((left, right) => (right.entries.at(-1)?.timestamp ?? 0) - (left.entries.at(-1)?.timestamp ?? 0));
}

function ActivityGroup({ group, zh, onSelectTurn }: { group: ActivityGroupModel; zh: boolean; onSelectTurn?: (turnId: string) => void }): React.JSX.Element {
  const hasAttention = group.entries.some((entry) => entry.activityStatus === "running" || entry.activityStatus === "pending" || entry.activityStatus === "error");
  const latest = group.entries.at(-1);
  return <details className="debug-activity-group" open={hasAttention || undefined}><summary><span>{zh ? "本轮活动" : "Turn activity"}</span><small>{group.entries.length}</small><time>{latest ? new Date(latest.timestamp).toLocaleTimeString() : ""}</time></summary><ol>{group.entries.map((entry) => <ActivityEntry key={entry.id} entry={entry} zh={zh} onSelectTurn={onSelectTurn} />)}</ol></details>;
}

function ActivityEntry({ entry, zh, onSelectTurn }: { entry: DebugLogEntry; zh: boolean; onSelectTurn?: (turnId: string) => void }): React.JSX.Element {
  const activity = entry.activity;
  const details = activity ? getActivityDetails(activity, zh) : [];
  const payloads = activity ? getActivityPayloads(activity, zh) : [];
  const missingFailureDetail = entry.activityStatus === "error" && payloads.length === 0
    && !(activity?.kind === "retry" && activity.errorCode);
  const copyText = activity ? formatActivityCopyText(activity, zh) : entry.raw || entry.message;
  return <li className={entry.activityStatus || "completed"}>
    <details className="debug-activity-entry" open={entry.activityStatus === "error" || undefined}>
      <summary>
        <span className="debug-activity-dot" aria-hidden="true" />
        <span><strong>{entry.message}</strong><small>{formatActivityKind(entry.activityKind, zh)} · {formatActivityStatus(entry.activityStatus, zh)}{entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ""}</small></span>
        <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
      </summary>
      <div className="debug-activity-details">
        {details.length ? <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
        {payloads.map(({ label, value, error }) => <section className={error ? "error" : ""} key={label}><h4>{label}</h4><pre>{formatActivityPayload(value)}</pre></section>)}
        {missingFailureDetail ? <p className="debug-activity-missing-error"><AlertTriangle size={12} />{zh ? "上游只报告了失败状态，没有提供错误正文。可在“错误”或“原始”页按本轮 ID 查找相邻事件。" : "The upstream reported failure without an error body. Search the Errors or Raw tab for adjacent events with this turn ID."}</p> : null}
        <footer>
          <button type="button" onClick={() => void copyTextSafely(copyText)}><Clipboard size={11} />{zh ? "复制详情" : "Copy details"}</button>
          {entry.turnId && onSelectTurn ? <button type="button" onClick={() => onSelectTurn(entry.turnId!)}><Search size={11} />{zh ? "定位到对话" : "Locate turn"}</button> : null}
        </footer>
      </div>
    </details>
  </li>;
}

function RawDebugEntry({ entry, zh }: { entry: DebugLogEntry; zh: boolean }): React.JSX.Element {
  const body = entry.raw || entry.message;
  return <article className={`debug-entry ${entry.level}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.module || entry.source}</span><pre>{body}</pre><button type="button" className="debug-entry-copy" onClick={() => void copyTextSafely(body)} title={zh ? "复制" : "Copy"} aria-label={zh ? "复制此诊断记录" : "Copy diagnostic record"}><Clipboard size={14} /></button></article>;
}

function AgentDiagnosticView({ snapshot, requestedRunId, activityGroups, runtimeLogs, zh, onOpenSource, onSelectTurn, onPrepareRerun, onMessage }: {
  snapshot: DiagnosticSnapshot | null;
  requestedRunId?: string;
  activityGroups: ActivityGroupModel[];
  runtimeLogs: DebugLogEntry[];
  zh: boolean;
  onOpenSource: (source: DiagnosticSourceLocation, workspaceId?: string) => void;
  onSelectTurn?: (turnId: string) => void;
  onPrepareRerun?: (runId: string) => boolean;
  onMessage?: (message: string) => void;
}): React.JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const runs = snapshot?.agentRuns ?? [];
  const run = requestedRunId
    ? runs.find((item) => item.runId === requestedRunId || item.id === requestedRunId)
    : runs.find((item) => !["completed", "failed", "cancelled"].includes(item.status)) ?? runs[0];
  if (requestedRunId && snapshot && !run) return <div className="agent-diagnostic-empty"><AlertTriangle size={22} /><strong>{zh ? "这条消息的调试记录不可用" : "Diagnostics for this message are unavailable"}</strong><span>{zh ? "运行记录可能由旧版本生成、已过期，或尚未同步。你可以在消息中重新运行任务。" : "The run may be from an older version, expired, or not yet synchronized. You can rerun the task from the message."}</span></div>;
  if (!run) return <div className="agent-diagnostic-empty"><Activity size={22} /><strong>{zh ? "当前没有 Agent 运行记录" : "No Agent run is available"}</strong><span>{zh ? "启动任务后，这里会显示阶段、动作、耗时和错误。" : "Start a task to see its phase, action, timing, and failures."}</span></div>;
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
  const elapsed = terminal ? run.elapsedMs : Math.max(run.elapsedMs, now - Date.parse(run.startedAt));
  const phaseElapsed = terminal ? run.phaseElapsedMs : Math.max(run.phaseElapsedMs, now - Date.parse(run.phaseStartedAt));
  const incident = (snapshot?.incidents ?? []).find((item) => item.domain === "agent" && item.traceId === run.traceId);
  const oaepEvents = runtimeLogs.filter((entry) => {
    const runtime = entry.runtime;
    if (runtime?.protocol !== "oaep/1" || !runtime.eventType?.startsWith("event.")) return false;
    if (run.runId) return runtime.runId === run.runId || (!runtime.runId && Boolean(run.sessionId) && runtime.sessionId === run.sessionId);
    return runtime.runId === run.traceId || runtime.sessionId === run.sessionId;
  });
  const activityGroup = activityGroups.find((group) => group.turnId === run.runId || group.turnId === run.traceId);
  return <div className="agent-diagnostic-view">
    <section className={`agent-current-state ${run.status}`}>
      <header><span className="diagnostic-state-dot" /><span><strong>{formatAgentStatus(run, zh)}</strong><small>{zh ? "当前 Agent 状态" : "Current Agent state"}</small></span><time>{formatLongDuration(elapsed)}</time></header>
      <div className="agent-current-action"><b>{formatAgentPhase(run.phase, zh)}</b><span>{run.action}</span></div>
      <dl>
        <div><dt>Backend</dt><dd>{run.backendId || "—"}</dd></div>
        <div><dt>{zh ? "模型" : "Model"}</dt><dd>{run.model || "—"}</dd></div>
        <div><dt>{zh ? "连接" : "Connection"}</dt><dd>{formatConnectionState(run.connectionState, zh)}</dd></div>
        <div><dt>{zh ? "阶段耗时" : "Phase time"}</dt><dd>{formatLongDuration(phaseElapsed)}</dd></div>
        {run.currentTool && <div><dt>{zh ? "当前工具" : "Current tool"}</dt><dd>{run.currentTool}</dd></div>}
        <div><dt>Run</dt><dd title={run.runId || run.traceId}>{shortId(run.runId || run.traceId)}</dd></div>
      </dl>
    </section>
    {incident && <section className="agent-failure-section"><h3>{zh ? "运行失败" : "Run failure"}</h3><IncidentCard incident={incident} zh={zh} onOpenSource={onOpenSource} /></section>}
    {run.status === "failed" && onPrepareRerun && <div className="agent-retry-actions"><button type="button" onClick={() => {
      const prepared = onPrepareRerun(run.runId || run.traceId);
      onMessage?.(prepared ? (zh ? "已将原任务放回输入框，请确认后重新运行。" : "The original task is ready in the composer for confirmation.") : (zh ? "未找到本轮的原始用户输入。" : "The original user input could not be found."));
    }}><RotateCcw size={11} />{zh ? "准备重新运行" : "Prepare rerun"}</button></div>}
    <section className="agent-milestone-section"><h3>{zh ? "OAEP 原始事件" : "Raw OAEP events"}</h3>{oaepEvents.length ? <ol>{oaepEvents.map((entry) => {
      const runtime = entry.runtime!;
      const metadata = [
        runtime.sequence !== undefined ? `sequence=${runtime.sequence}` : undefined,
        runtime.runId ? `run_id=${runtime.runId}` : undefined,
        runtime.itemId ? `item_id=${runtime.itemId}` : undefined,
        runtime.source ? `source=${runtime.source}` : undefined,
      ].filter(Boolean).join(" · ");
      return <li key={entry.id} className={runtime.status}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className="diagnostic-state-dot" /><span><strong><code>{runtime.eventType}</code></strong><small>{metadata || runtime.message}</small></span></li>;
    })}</ol> : <p>{zh ? "等待当前 Run 的第一个 OAEP 事件。" : "Waiting for the first OAEP event for this run."}</p>}</section>
    {activityGroup && <section className="agent-tool-activity"><h3>{zh ? "工具与活动" : "Tools and activity"}</h3><ActivityGroup group={activityGroup} zh={zh} onSelectTurn={onSelectTurn} /></section>}
  </div>;
}

function AppErrorView({ snapshot, zh, onOpenSource }: { snapshot: DiagnosticSnapshot | null; zh: boolean; onOpenSource: (source: DiagnosticSourceLocation, workspaceId?: string) => void }): React.JSX.Element {
  const incidents = (snapshot?.incidents ?? []).filter((incident) => incident.domain === "app");
  const directErrors = (snapshot?.events ?? []).filter((event) => event.domain === "app" && (event.status === "failed" || event.level === "error")).reverse();
  return <div className="app-error-view">
    <header><span><strong>{incidents.length || directErrors.length}</strong><small>{zh ? "类 App 错误" : "App error groups"}</small></span><p>{zh ? "这里只显示 Desktop、Runtime、网络、存储和权限等应用自身问题。" : "Only Desktop, Runtime, network, storage, and permission failures appear here."}</p></header>
    {incidents.length
      ? incidents.map((incident) => <IncidentCard key={incident.id} incident={incident} zh={zh} onOpenSource={onOpenSource} />)
      : directErrors.length
        ? directErrors.map((event) => <DiagnosticErrorCard key={event.id} event={event} zh={zh} onOpenSource={(source) => onOpenSource(source, event.workspaceId)} />)
        : <div className="app-error-empty"><ShieldCheck size={22} /><strong>{zh ? "未发现 App 错误" : "No App errors detected"}</strong></div>}
  </div>;
}

function IncidentCard({ incident, zh, onOpenSource }: { incident: DiagnosticIncident; zh: boolean; onOpenSource: (source: DiagnosticSourceLocation, workspaceId?: string) => void }): React.JSX.Element {
  const copyText = JSON.stringify(incident, null, 2);
  return <details className={`diagnostic-incident-card ${incident.severity}`} open={incident.domain === "agent" || undefined}>
    <summary><AlertTriangle size={14} /><span><strong>{incident.title}</strong><small>{incident.component} · {incident.operation}{incident.count > 1 ? ` · ${incident.count}×` : ""}</small></span><time>{new Date(incident.lastSeenAt).toLocaleTimeString()}</time></summary>
    <div>
      <p>{incident.message}</p>
      <dl><div><dt>{zh ? "影响" : "Impact"}</dt><dd>{incident.impact}</dd></div>{incident.errorCode && <div><dt>{zh ? "错误码" : "Error code"}</dt><dd>{incident.errorCode}</dd></div>}{incident.agentPhase && <div><dt>{zh ? "阶段" : "Phase"}</dt><dd>{formatAgentPhase(incident.agentPhase, zh)}</dd></div>}<div><dt>{zh ? "首次" : "First seen"}</dt><dd>{new Date(incident.firstSeenAt).toLocaleString()}</dd></div></dl>
      {incident.source?.file && <button type="button" className="diagnostic-primary-source" onClick={() => onOpenSource(incident.source!, incident.contextBefore.at(-1)?.workspaceId)}><FileCode2 size={12} />{zh ? "查看代码位置" : "View source"}: <code>{formatLocation(incident.source)}</code></button>}
      {incident.stack.length > 0 && <details><summary>{zh ? "调用栈" : "Stack"}</summary><pre>{incident.stack.map((frame) => frame.raw).join("\n")}</pre></details>}
      <details><summary>{zh ? "错误前后事件" : "Adjacent events"}</summary><ol>{[...incident.contextBefore, ...incident.contextAfter].map((event) => <li key={event.id}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><span>{event.message}</span></li>)}</ol></details>
      <ul>{incident.suggestedActions.map((action) => <li key={action}>{action}</li>)}</ul>
      <button type="button" onClick={() => void copyTextSafely(copyText)}><Clipboard size={11} />{zh ? "复制完整诊断" : "Copy full diagnostic"}</button>
    </div>
  </details>;
}

function RuntimeLogEntry({ entry, zh }: { entry: DebugLogEntry; zh: boolean }): React.JSX.Element {
  const runtime = entry.runtime;
  if (!runtime) return <RawDebugEntry entry={entry} zh={zh} />;
  const body = entry.raw || entry.message;
  const context = runtime.runId || runtime.sessionId;
  const logLine = `[${formatRuntimeLogTimestamp(entry.timestamp)}] [${runtime.protocol}] [${runtime.phase}] [${context}] [${runtime.level.toUpperCase()}]: ${runtime.message}`;
  return <details className={`debug-runtime-entry ${entry.level}`} open={entry.level === "error" || entry.level === "warn" || undefined}>
    <summary title={logLine}>
      <time>[{formatRuntimeLogTime(entry.timestamp)}]</time>
      <span className="protocol">[{runtime.protocol}]</span>
      <span className="phase">[{runtime.phase}]</span>
      <span className="context">[{context}]</span>
      <span className={`level ${entry.level}`}>[{runtime.level.toUpperCase()}]:</span>
      <strong>{runtime.message}{entry.coalescedCount && entry.coalescedCount > 1 ? ` ×${entry.coalescedCount}` : ""}</strong>
    </summary>
    <div className="debug-runtime-details">
      <dl>
        <div><dt>{zh ? "操作" : "Operation"}</dt><dd>{runtime.operation}</dd></div>
        <div><dt>{zh ? "会话" : "Session"}</dt><dd>{runtime.sessionId}</dd></div>
        {runtime.eventType && <div><dt>{zh ? "事件" : "Event"}</dt><dd>{runtime.eventType}</dd></div>}
        {runtime.sequence !== undefined && <div><dt>{zh ? "序号" : "Sequence"}</dt><dd>{runtime.sequence}</dd></div>}
        {runtime.runId && <div><dt>{zh ? "运行" : "Run"}</dt><dd>{runtime.runId}</dd></div>}
        {runtime.itemId && <div><dt>{zh ? "项目" : "Item"}</dt><dd>{runtime.itemId}</dd></div>}
        {runtime.source && <div><dt>{zh ? "来源" : "Source"}</dt><dd>{runtime.source}</dd></div>}
      </dl>
      {runtime.details && Object.keys(runtime.details).length > 0 ? <section><h4>{zh ? "协议数据" : "Protocol data"}</h4><pre>{JSON.stringify(runtime.details, null, 2)}</pre></section> : null}
      <button type="button" onClick={() => void copyTextSafely(body)}><Clipboard size={12} />{zh ? "复制完整日志" : "Copy full log"}</button>
    </div>
  </details>;
}

function formatRuntimeLogTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())},${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function formatRuntimeLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())},${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function DebugEmpty({ zh }: { zh: boolean }): React.JSX.Element { return <div className="debug-empty">{zh ? "暂无匹配记录" : "No matching records"}</div>; }

function filterDiagnosticEvents(events: DiagnosticEvent[], query: string): DiagnosticEvent[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return events;
  return events.filter((event) => [event.message, event.module, event.component, event.operation, event.traceId, event.errorCode].some((value) => value?.toLowerCase().includes(normalized)));
}

function filterTraces(traces: DiagnosticTrace[], events: DiagnosticEvent[], query: string): DiagnosticTrace[] {
  if (!query.trim()) return traces;
  const ids = new Set(events.map((event) => event.traceId));
  return traces.filter((trace) => ids.has(trace.traceId));
}

function calculateDepths(events: DiagnosticEvent[]): Map<string, number> {
  const bySpan = new Map(events.map((event) => [event.spanId, event]));
  const depths = new Map<string, number>();
  for (const event of events) {
    let depth = 0; let parent = event.parentSpanId; const seen = new Set<string>();
    while (parent && bySpan.has(parent) && !seen.has(parent) && depth < 8) { seen.add(parent); depth += 1; parent = bySpan.get(parent)?.parentSpanId; }
    depths.set(event.id, depth);
  }
  return depths;
}

function formatSource(event: DiagnosticEvent): string { const source = event.source; return source?.file ? `${source.file}${source.line ? `:${source.line}${source.column ? `:${source.column}` : ""}` : ""}` : ""; }
function formatLocation(source: DiagnosticSourceLocation): string { return source.file ? `${source.file}${source.line ? `:${source.line}${source.column ? `:${source.column}` : ""}` : ""}` : "Unknown source"; }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function formatDuration(durationMs: number): string { return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`; }
function formatLongDuration(durationMs: number): string { const seconds = Math.max(0, Math.floor(durationMs / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function formatAgentStatus(run: AgentRunDiagnosticState, zh: boolean): string {
  const labels = zh
    ? { started: "启动中", running: "运行中", waiting: "等待中", completed: "已完成", failed: "失败", cancelled: "已取消" }
    : { started: "Starting", running: "Running", waiting: "Waiting", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
  return labels[run.status];
}

function matchesRuntimeScope(entry: DebugLogEntry, scope: RuntimeLogScope, activeRun?: AgentRunDiagnosticState): boolean {
  if (scope === "all") return true;
  const isAgent = entry.diagnosticDomain === "agent" || entry.source === "activity" || entry.source === "runtime" || entry.source === "protocol";
  if (scope === "all-agent") return isAgent;
  if (scope === "app") return entry.diagnosticDomain === "app" || ["console", "window", "promise"].includes(entry.source);
  if (!activeRun) return entry.source === "runtime";
  const ids = new Set([activeRun.runId, activeRun.traceId, activeRun.sessionId].filter(Boolean));
  return isAgent && [entry.turnId, entry.traceId, entry.runtime?.runId, entry.runtime?.sessionId].some((id) => id && ids.has(id));
}
function formatAgentPhase(phase: AgentRunDiagnosticState["phase"], zh: boolean): string {
  const labels = zh ? {
    preparing: "准备任务", connecting: "连接 Runtime", waiting_model: "等待模型", reasoning: "推理中", calling_tool: "调用工具",
    waiting_approval: "等待确认", responding: "生成结果", completed: "已完成", failed: "运行失败", cancelled: "已取消",
  } : {
    preparing: "Preparing", connecting: "Connecting", waiting_model: "Waiting for model", reasoning: "Reasoning", calling_tool: "Calling tool",
    waiting_approval: "Waiting for approval", responding: "Responding", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  };
  return labels[phase];
}
function formatConnectionState(state: AgentRunDiagnosticState["connectionState"], zh: boolean): string {
  const labels = zh
    ? { unknown: "未知", connecting: "连接中", connected: "正常", retrying: "正在重连", disconnected: "已断开" }
    : { unknown: "Unknown", connecting: "Connecting", connected: "Connected", retrying: "Retrying", disconnected: "Disconnected" };
  return labels[state];
}
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function createAiAnalysisBrief(analysis: DiagnosticSnapshot["rootCause"]["analyses"][number]): string { return [`TRACE: ${analysis.traceId}`, `SUMMARY: ${analysis.summary}`, "FACTS:", ...analysis.facts.map((item) => `- ${item}`), "INFERENCES:", ...analysis.inferences.map((item) => `- (${Math.round(item.confidence * 100)}%) ${item.text}`), "UNCERTAINTIES:", ...analysis.uncertainties.map((item) => `- ${item}`)].join("\n"); }

function getActivityDetails(activity: StructuredActivityEvent, zh: boolean): Array<[string, string]> {
  const details: Array<[string, string]> = [
    [zh ? "来源" : "Source", activity.source],
    [zh ? "活动 ID" : "Activity ID", activity.id],
    [zh ? "本轮 ID" : "Turn ID", activity.turnId],
  ];
  if (activity.kind === "tool") {
    details.unshift([zh ? "工具" : "Tool", activity.toolName], [zh ? "调用 ID" : "Call ID", activity.callId]);
    if (activity.durationMs !== undefined) details.push([zh ? "耗时" : "Duration", formatDuration(activity.durationMs)]);
  } else if (activity.kind === "model") {
    if (activity.model) details.unshift([zh ? "模型" : "Model", activity.model]);
    if (activity.requestId) details.push([zh ? "请求 ID" : "Request ID", activity.requestId]);
    if (activity.usage) details.push([zh ? "用量" : "Usage", formatActivityPayload(activity.usage)]);
  } else if (activity.kind === "retry") {
    details.unshift([zh ? "重试" : "Attempt", `${activity.attempt}/${activity.limit}`]);
    if (activity.delayMs !== undefined) details.push([zh ? "等待" : "Delay", formatDuration(activity.delayMs)]);
    if (activity.errorCode) details.push([zh ? "错误代码" : "Error code", activity.errorCode]);
  } else if (activity.kind === "file_change") {
    details.unshift([zh ? "文件" : "File", activity.path], [zh ? "操作" : "Action", activity.action]);
  } else if (activity.kind === "subtask") {
    details.unshift([zh ? "子任务 ID" : "Subtask ID", activity.taskId]);
    if (activity.agentName) details.push([zh ? "智能体" : "Agent", activity.agentName]);
  } else {
    details.unshift([zh ? "级别" : "Level", activity.level]);
  }
  return details;
}

function getActivityPayloads(activity: StructuredActivityEvent, zh: boolean): Array<{ label: string; value: unknown; error: boolean }> {
  if (activity.kind === "tool") {
    const payloads: Array<{ label: string; value: unknown; error: boolean }> = [];
    if (activity.input !== undefined) payloads.push({ label: zh ? "输入" : "Input", value: activity.input, error: false });
    if (activity.output !== undefined) payloads.push({
      label: activity.status === "error" ? (zh ? "错误详情" : "Error details") : (zh ? "输出" : "Output"),
      value: activity.output,
      error: activity.status === "error",
    });
    return payloads;
  }
  if (activity.kind === "log" && activity.content) return [{
    label: activity.status === "error" || activity.level === "error" ? (zh ? "错误详情" : "Error details") : (zh ? "日志内容" : "Log content"),
    value: activity.content,
    error: activity.status === "error" || activity.level === "error",
  }];
  return [];
}

function formatActivityPayload(value: unknown): string {
  const text = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  })();
  return text.length > 16_000 ? `${text.slice(0, 16_000)}\n… [truncated]` : text;
}

function formatActivitySearchText(activity: StructuredActivityEvent | undefined): string {
  if (!activity) return "";
  return formatActivityPayload(activity).slice(0, 4_000);
}

function formatActivityCopyText(activity: StructuredActivityEvent, zh: boolean): string {
  return [
    `${zh ? "活动" : "Activity"}: ${activity.title}`,
    `${zh ? "状态" : "Status"}: ${activity.status}`,
    ...getActivityDetails(activity, zh).map(([label, value]) => `${label}: ${value}`),
    ...getActivityPayloads(activity, zh).flatMap(({ label, value }) => [`${label}:`, formatActivityPayload(value)]),
  ].join("\n");
}

function formatActivityKind(kind: DebugLogEntry["activityKind"], zh: boolean): string {
  const labels = { tool: ["工具", "Tool"], model: ["模型", "Model"], retry: ["重试", "Retry"], file_change: ["文件", "File"], subtask: ["子任务", "Subtask"], log: ["日志", "Log"] } as const;
  const label = kind ? labels[kind] : undefined; return label ? label[zh ? 0 : 1] : (zh ? "活动" : "Activity");
}

function formatActivityStatus(status: DebugLogEntry["activityStatus"], zh: boolean): string {
  const labels = { pending: ["等待", "Pending"], running: ["进行中", "Running"], completed: ["已完成", "Completed"], error: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"] } as const;
  const label = status ? labels[status] : undefined; return label ? label[zh ? 0 : 1] : (zh ? "未知" : "Unknown");
}
