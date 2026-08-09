import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play, RefreshCw, Search, Square } from "lucide-react";
import type { RegressionCaseDetail, RegressionCaseSummary, RegressionEvaluation, RegressionSuiteSummary } from "@shared/regression";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

interface Props {
  language: AppLanguage;
  onRunCase: (detail: RegressionCaseDetail, evaluation: RegressionEvaluation) => Promise<void>;
}
const TERMINAL = new Set(["passed", "failed", "blocked", "cancelled"]);

export function RegressionPanel({ language, onRunCase }: Props): React.JSX.Element {
  const zh = language === "zh";
  const [suites, setSuites] = useState<RegressionSuiteSummary[]>([]);
  const [suiteId, setSuiteId] = useState("p3-desktop");
  const [cases, setCases] = useState<RegressionCaseSummary[]>([]);
  const [details, setDetails] = useState<Record<string, RegressionCaseDetail>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<RegressionEvaluation[]>([]);
  const [running, setRunning] = useState<RegressionEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(preferred = suiteId): Promise<void> {
    setLoading(true); setError(null);
    try {
      const available = await desktopApi.listRegressionSuites();
      setSuites(available.suites);
      const selected = available.suites.some((item) => item.id === preferred) ? preferred : available.suites[0]?.id;
      if (!selected) { setCases([]); return; }
      setSuiteId(selected);
      const [catalog, recent] = await Promise.all([desktopApi.listRegressionCases(selected), desktopApi.listRegressionHistory(50)]);
      setCases(catalog.cases); setHistory(recent);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const latestByCase = useMemo(() => {
    const result = new Map<string, RegressionEvaluation>();
    for (const item of history) if (!result.has(item.case_id)) result.set(item.case_id, item);
    if (running) result.set(running.case_id, running);
    return result;
  }, [history, running]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? cases.filter((item) => `${item.id} ${item.title} ${item.description} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(needle)) : cases;
  }, [cases, query]);

  async function toggle(item: RegressionCaseSummary): Promise<void> {
    if (expandedId === item.id) { setExpandedId(null); return; }
    setExpandedId(item.id);
    if (details[item.id]) return;
    try { const detail = await desktopApi.getRegressionCase(item.id); setDetails((current) => ({ ...current, [item.id]: detail })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function start(detail: RegressionCaseDetail): Promise<void> {
    setError(null);
    try {
      const evaluation = await desktopApi.beginRegressionEvaluation({ suiteId, caseId: detail.id, caseRevision: detail.revision, definitionSha256: detail.definition_sha256 });
      setRunning(evaluation);
      await onRunCase(detail, evaluation);
      const current = await desktopApi.getRegressionEvaluation(evaluation.evaluation_id);
      setRunning(TERMINAL.has(current.status) ? null : current);
      setHistory(await desktopApi.listRegressionHistory(50));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function cancel(): Promise<void> {
    if (!running) return;
    await desktopApi.cancelRegressionEvaluation(running.evaluation_id); setRunning(null);
    setHistory(await desktopApi.listRegressionHistory(50));
  }

  return <section className="regression-panel" aria-label={zh ? "回归测试" : "Regression tests"}>
    <header className="regression-panel__header"><div><h2>{zh ? "回归测试" : "Regression tests"}</h2><p>{zh ? "通过真实聊天界面运行代表性案例" : "Run cases through the real chat UI"}</p></div><button className="icon-button" onClick={() => void refresh()} aria-label={zh ? "刷新案例" : "Refresh cases"}><RefreshCw size={16} /></button></header>
    <div className="regression-panel__controls"><select value={suiteId} onChange={(event) => void refresh(event.target.value)} aria-label={zh ? "测试套件" : "Test suite"}>{suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.title} ({suite.case_count})</option>)}</select><label className="regression-panel__search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索案例" : "Search cases"} /></label></div>
    {running ? <div className="regression-panel__active" role="status"><span><strong>{running.case_id}</strong><small>{running.status}</small></span><button onClick={() => void cancel()}><Square size={13} />{zh ? "停止" : "Stop"}</button></div> : null}
    {error ? <div className="regression-panel__error" role="alert">{error}</div> : null}
    {loading ? <div className="regression-panel__empty">{zh ? "正在读取动态案例目录…" : "Loading dynamic catalog…"}</div> : null}
    {!loading && !visible.length ? <div className="regression-panel__empty">{zh ? "没有匹配案例" : "No matching cases"}</div> : null}
    <div className="regression-panel__list">{visible.map((item) => { const detail = details[item.id]; const expanded = expandedId === item.id; const latest = latestByCase.get(item.id); return <article className="regression-case" key={item.id}>
      <button className="regression-case__summary" onClick={() => void toggle(item)} aria-expanded={expanded}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span><strong>{item.title}</strong><small>{item.id} · {item.description}</small></span>{latest ? <em data-status={latest.status}>{latest.status}</em> : null}</button>
      {expanded ? <div className="regression-case__detail">{!detail ? <p>{zh ? "读取详情…" : "Loading details…"}</p> : <><h3>{zh ? "输入" : "Input"}</h3>{detail.input.messages.map((message, index) => <div className="regression-case__message" key={`${message.role}-${index}`}><b>{message.role}</b>{message.parts.map((part, partIndex) => <pre key={partIndex}>{part.text ?? part.asset_name ?? part.resource_ref ?? part.type}</pre>)}</div>)}<h3>{zh ? "预期与自动断言" : "Expected output and assertions"}</h3><ul>{detail.expectation_summary.map((expectation, index) => <li key={`${expectation.group}-${index}`}><b>{expectation.label}</b><span>{expectation.summary}</span></li>)}</ul><details><summary>{zh ? "环境与执行配置" : "Environment and execution"}</summary><pre>{JSON.stringify({ environment: detail.environment, execution: detail.execution }, null, 2)}</pre></details><button className="regression-case__run" disabled={Boolean(running)} onClick={() => void start(detail)}><Play size={14} />{zh ? "开始测试" : "Start test"}</button></>}</div> : null}
    </article>; })}</div>
  </section>;
}
