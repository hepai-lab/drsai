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
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { DiagnosticEvent, DiagnosticPackagePreview, DiagnosticSnapshot, DiagnosticSourceContext, DiagnosticSourceContextRequest, DiagnosticSourceLocation, DiagnosticTrace, InteractiveDebugScope, InteractiveDebugSession, InteractiveDebugTarget, InteractiveDebugVariable, ProductionDiagnosticStatus } from "@shared/diagnostics";
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
  type DebugLogEntry,
  type DebugLogLevel,
} from "../debugLogStore";
import type { AppLanguage } from "../navigation";
import { copyTextSafely } from "../clipboard";

type DebugView = "overview" | "traces" | "errors" | "causes" | "interactive" | "production" | "activity" | "raw";

interface DebugPanelProps {
  language: AppLanguage;
  onSelectTurn?: (turnId: string) => void;
}

export function DebugPanel({ language, onSelectTurn }: DebugPanelProps): React.JSX.Element {
  const logs = useSyncExternalStore(subscribeDebugLogs, getDebugLogs);
  const [visible, setVisible] = useState(logs);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<DebugView>("overview");
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<DebugLogLevel>>(new Set(["log", "info", "warn", "error"]));
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sourceRequest, setSourceRequest] = useState<DiagnosticSourceContextRequest | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const zh = language === "zh";

  useEffect(() => {
    if (!paused) setVisible(logs);
  }, [logs, paused]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    void window.openDrSai.getDiagnosticSnapshot({ limit: 1_000 }).then((next) => {
      if (!cancelled) setSnapshot(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [logs.length, paused]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visible.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (view === "activity" && entry.source !== "activity") return false;
      if (view === "raw" && entry.source === "activity") return false;
      if (!normalizedQuery) return true;
      return [entry.message, entry.raw, entry.activityKind, entry.activityStatus, entry.module, entry.component, entry.operation, entry.traceId]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [levels, query, view, visible]);

  const diagnosticEvents = useMemo(() => filterDiagnosticEvents(snapshot?.events ?? [], query), [query, snapshot?.events]);
  const traces = useMemo(() => filterTraces(snapshot?.traces ?? [], diagnosticEvents, query), [diagnosticEvents, query, snapshot?.traces]);
  const errors = diagnosticEvents.filter((event) => event.status === "failed" || event.level === "error").reverse();
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
    { id: "overview", icon: Activity, zh: "概览", en: "Overview" },
    { id: "traces", icon: Network, zh: "链路", en: "Traces" },
    { id: "errors", icon: AlertTriangle, zh: "错误", en: "Errors" },
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
      </div>

      <div className="debug-filter-bar">
        <label><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "筛选模块、操作、链路或消息" : "Filter module, operation, trace, or message"} /></label>
        {(view === "activity" || view === "raw") && <div>{(["log", "info", "warn", "error"] as DebugLogLevel[]).map((level) => <button type="button" key={level} className={levels.has(level) ? `active ${level}` : ""} onClick={() => toggleLevel(level)}>{level}</button>)}</div>}
      </div>

      <div className={`debug-output ${view}`} ref={outputRef} role="log">
        {view === "overview" && <DiagnosticOverview snapshot={snapshot} traces={traces} zh={zh} />}
        {view === "traces" && (traces.length ? traces.map((trace) => <TraceCard key={trace.traceId} trace={trace} zh={zh} onOpenSource={(source, workspaceId) => setSourceRequest({ source, workspaceId })} />) : <DebugEmpty zh={zh} />)}
        {view === "errors" && (errors.length ? errors.map((event) => <DiagnosticErrorCard key={event.id} event={event} zh={zh} onOpenSource={(source) => setSourceRequest({ source, workspaceId: event.workspaceId })} />) : <DebugEmpty zh={zh} />)}
        {view === "causes" && <RootCauseView snapshot={snapshot} zh={zh} onUpdateIssue={updateIssue} />}
        {view === "interactive" && <InteractiveDebugWorkbench zh={zh} onOpenSource={(source) => setSourceRequest({ source })} onMessage={setActionMessage} />}
        {view === "production" && <ProductionDiagnosticsWorkbench zh={zh} onMessage={setActionMessage} />}
        {view === "activity" && (activityGroups.length ? activityGroups.map((group) => <ActivityGroup key={group.turnId} group={group} zh={zh} onSelectTurn={onSelectTurn} />) : <DebugEmpty zh={zh} />)}
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
    void Promise.all([window.openDrSai.listInteractiveDebugTargets(), window.openDrSai.listInteractiveDebugSessions()]).then(([nextTargets, nextSessions]) => {
      if (cancelled) return;
      setTargets(nextTargets); setSessions(nextSessions); setTargetId((current) => current || nextTargets.find((item) => item.available)?.id || nextTargets[0]?.id || "");
    }).catch((error) => onMessage(error instanceof Error ? error.message : String(error)));
    const unsubscribe = window.openDrSai.onInteractiveDebugEvent((session) => setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]));
    return () => { cancelled = true; unsubscribe(); };
  }, [onMessage]);

  const selectedTarget = targets.find((item) => item.id === targetId);
  const active = sessions[0];

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
  return <details className="debug-activity-group" open={hasAttention || undefined}><summary><span>{zh ? "本轮活动" : "Turn activity"}</span><small>{group.entries.length}</small><time>{latest ? new Date(latest.timestamp).toLocaleTimeString() : ""}</time></summary><ol>{group.entries.map((entry) => <li key={entry.id} className={entry.activityStatus || "completed"}><button type="button" disabled={!entry.turnId || !onSelectTurn} onClick={() => entry.turnId && onSelectTurn?.(entry.turnId)}><span className="debug-activity-dot" aria-hidden="true" /><span><strong>{entry.message}</strong><small>{formatActivityKind(entry.activityKind, zh)} · {formatActivityStatus(entry.activityStatus, zh)}{entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ""}</small></span><time>{new Date(entry.timestamp).toLocaleTimeString()}</time></button></li>)}</ol></details>;
}

function RawDebugEntry({ entry, zh }: { entry: DebugLogEntry; zh: boolean }): React.JSX.Element {
  const body = entry.raw || entry.message;
  return <article className={`debug-entry ${entry.level}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.module || entry.source}</span><pre>{body}</pre><button type="button" className="debug-entry-copy" onClick={() => void copyTextSafely(body)} title={zh ? "复制" : "Copy"} aria-label={zh ? "复制此诊断记录" : "Copy diagnostic record"}><Clipboard size={14} /></button></article>;
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
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function createAiAnalysisBrief(analysis: DiagnosticSnapshot["rootCause"]["analyses"][number]): string { return [`TRACE: ${analysis.traceId}`, `SUMMARY: ${analysis.summary}`, "FACTS:", ...analysis.facts.map((item) => `- ${item}`), "INFERENCES:", ...analysis.inferences.map((item) => `- (${Math.round(item.confidence * 100)}%) ${item.text}`), "UNCERTAINTIES:", ...analysis.uncertainties.map((item) => `- ${item}`)].join("\n"); }

function formatActivityKind(kind: DebugLogEntry["activityKind"], zh: boolean): string {
  const labels = { tool: ["工具", "Tool"], model: ["模型", "Model"], retry: ["重试", "Retry"], file_change: ["文件", "File"], subtask: ["子任务", "Subtask"], log: ["日志", "Log"] } as const;
  const label = kind ? labels[kind] : undefined; return label ? label[zh ? 0 : 1] : (zh ? "活动" : "Activity");
}

function formatActivityStatus(status: DebugLogEntry["activityStatus"], zh: boolean): string {
  const labels = { pending: ["等待", "Pending"], running: ["进行中", "Running"], completed: ["已完成", "Completed"], error: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"] } as const;
  const label = status ? labels[status] : undefined; return label ? label[zh ? 0 : 1] : (zh ? "未知" : "Unknown");
}
