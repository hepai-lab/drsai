import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Database, Globe2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import type { PerceptorResource, SavePerceptorRequest } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import { requestAppDecision } from "./AppDecisionDialog";

type DraftKind = "tavily" | "facility";

interface DraftState {
  originalId?: string;
  kind: DraftKind;
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: string;
  searchDepth: string;
  extractDepth: string;
  maxDocumentChars: string;
  facilityIds: string;
  namespaces: string;
  classificationCeiling: string;
  maxTimeRangeSeconds: string;
  maxPoints: string;
}

const FACILITY_CAPABILITIES = [
  "facility.telemetry.read", "facility.archive.query", "facility.events.query",
  "facility.runs.query", "facility.catalog.search", "facility.metadata.read",
];

function emptyDraft(kind: DraftKind): DraftState {
  return {
    kind, id: kind === "tavily" ? "web-tavily-main" : "facility-data-main",
    name: kind === "tavily" ? "网页搜索" : "大装置运行数据", enabled: true,
    apiKey: "", baseUrl: kind === "tavily" ? "https://api.tavily.com" : "",
    timeoutSeconds: kind === "tavily" ? "15" : "10", searchDepth: "basic", extractDepth: "basic",
    maxDocumentChars: "20000", facilityIds: "facility-main", namespaces: "beam, detector, environment",
    classificationCeiling: "internal", maxTimeRangeSeconds: "86400", maxPoints: "10000",
  };
}

export function PerceptorSettingsPanel({ language }: { language: "zh" | "en" }): React.JSX.Element {
  const zh = language === "zh";
  const [resources, setResources] = useState<PerceptorResource[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, { search?: boolean; extract?: boolean; latency?: string }>>({});

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { setResources(await desktopApi.listPerceptors()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const counts = useMemo(() => ({ enabled: resources.filter((item) => item.enabled).length, web: resources.filter((item) => item.kind === "public_web").length, facility: resources.filter((item) => item.kind === "large_facility_data").length }), [resources]);

  function edit(resource: PerceptorResource): void {
    const facility = resource.kind === "large_facility_data";
    const config = resource.config;
    setDraft({
      ...emptyDraft(facility ? "facility" : "tavily"), originalId: resource.perceptor_id,
      kind: facility ? "facility" : "tavily", id: resource.perceptor_id,
      name: resource.name || resource.perceptor_id, enabled: resource.enabled,
      apiKey: typeof config.api_key === "string" ? config.api_key : "",
      baseUrl: String(config.base_url || ""), timeoutSeconds: String(config.timeout_seconds || (facility ? 10 : 15)),
      searchDepth: String(config.search_depth || "basic"), extractDepth: String(config.extract_depth || "basic"),
      maxDocumentChars: String(config.max_document_chars || 20000),
      facilityIds: asList(config.facility_ids).join(", "), namespaces: asList(config.namespaces).join(", "),
      classificationCeiling: String(config.classification_ceiling || "internal"),
      maxTimeRangeSeconds: String(config.max_time_range_seconds || 86400), maxPoints: String(config.max_points || 10000),
    });
    setMessage(null); setError(null);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(draft.id)) { setError(zh ? "资源 ID 必须以小写字母开头，只能包含小写字母、数字、点、横线和下划线。" : "The resource ID must start with a lowercase letter and contain only lowercase letters, numbers, dots, dashes, and underscores."); return; }
    if (!draft.baseUrl.startsWith("http://") && !draft.baseUrl.startsWith("https://")) { setError(zh ? "请输入有效的 HTTP(S) 服务地址。" : "Enter a valid HTTP(S) service URL."); return; }
    if (!draft.originalId && !draft.apiKey.trim()) { setError(zh ? "新建感知器需要凭据。" : "A credential is required for a new perceptor."); return; }
    const request = toRequest(draft);
    setBusy(true); setError(null); setMessage(null);
    try {
      if (draft.originalId) await desktopApi.updatePerceptor(draft.originalId, request);
      else await desktopApi.savePerceptor(request);
      setDraft(null);
      setMessage(zh ? "感知器配置已保存；新运行会固化最新 revision。" : "Perceptor saved; new runs will freeze the latest revision.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function toggle(resource: PerceptorResource): Promise<void> {
    setBusy(true); setError(null);
    try {
      await desktopApi.updatePerceptor(resource.perceptor_id, { perceptor_id: resource.perceptor_id, ...(resource.name ? { name: resource.name } : {}), kind: resource.kind, adapter: resource.adapter, capabilities: resource.capabilities, config: resource.config, enabled: !resource.enabled });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function test(resource: PerceptorResource, capability: "search" | "extract"): Promise<void> {
    if (resource.adapter !== "tavily") { setMessage(zh ? "大装置 Gateway 的分能力只读诊断将在接入具体机构协议后启用；当前不会伪造可用状态。" : "Facility capability diagnostics become available after an institution protocol is connected; availability is not simulated."); return; }
    setBusy(true); setError(null); setMessage(null);
    const started = performance.now();
    try {
      const result = await desktopApi.testPerceptor(resource.perceptor_id, capability);
      if (!result.ok) throw new Error(result.error || result.status);
      setHealth((current) => ({ ...current, [resource.perceptor_id]: { ...current[resource.perceptor_id], [capability]: true, latency: `${Math.round(performance.now() - started)} ms` } }));
      setMessage(capability === "search" ? (zh ? `搜索测试成功，共 ${result.result_count ?? 0} 个结果。` : `Search test passed with ${result.result_count ?? 0} results.`) : (zh ? "网页读取测试成功。" : "Page extraction test passed."));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  async function remove(resource: PerceptorResource): Promise<void> {
    const confirmed = await requestAppDecision({
      id: `delete-perceptor-${resource.perceptor_id}`,
      tone: "danger",
      title: zh
        ? `删除感知器“${resource.name || resource.perceptor_id}”？`
        : `Delete perceptor “${resource.name || resource.perceptor_id}”?`,
      description: zh
        ? "该感知器将不再提供给新的智能体运行。"
        : "This perceptor will no longer be available to new Agent runs.",
      impact: zh
        ? "关联的安全凭据引用也会被清理；此操作不可撤销。"
        : "Its secure credential reference will also be cleaned up. This action cannot be undone.",
      confirmLabel: zh ? "删除感知器" : "Delete perceptor",
    });
    if (!confirmed) return;
    setBusy(true); setError(null);
    try { await desktopApi.deletePerceptor(resource.perceptor_id); if (draft?.originalId === resource.perceptor_id) setDraft(null); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  return <>
    <header className="settings-content-header"><h2>{zh ? "感知器配置" : "Perceptor configuration"}</h2><p>{zh ? "创建、测试和管理可复用的只读外部数据资源。智能体配置只引用这些资源，不保存连接凭据。" : "Create, test, and manage reusable read-only external data resources. Agent configuration references them without copying credentials."}</p></header>
    <section className="perceptor-summary" aria-label={zh ? "感知器摘要" : "Perceptor summary"}><span><strong>{resources.length}</strong>{zh ? "资源" : "Resources"}</span><span><strong>{counts.enabled}</strong>{zh ? "已启用" : "Enabled"}</span><span><strong>{counts.web}</strong>{zh ? "公共网络" : "Public web"}</span><span><strong>{counts.facility}</strong>{zh ? "大装置数据" : "Facility data"}</span><button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button></section>
    <section className="settings-section perceptor-create-actions"><div><h2>{zh ? "新增感知器" : "Add perceptor"}</h2><p>{zh ? "感知器只读地观察外部世界；改变外部状态的能力必须配置为执行器。" : "Perceptors observe external state read-only; state-changing capabilities belong to executors."}</p></div><button type="button" onClick={() => setDraft(emptyDraft("tavily"))}><Globe2 size={15} />{zh ? "网页搜索" : "Web search"}</button><button type="button" onClick={() => setDraft(emptyDraft("facility"))}><Database size={15} />{zh ? "大装置数据" : "Facility data"}</button></section>
    {error ? <div className="settings-message error" role="alert">{error}</div> : null}{message ? <div className="settings-message" role="status">{message}</div> : null}
    {draft ? <PerceptorEditor draft={draft} setDraft={setDraft} busy={busy} zh={zh} onSave={() => void save()} onCancel={() => setDraft(null)} /> : null}
    <section className="perceptor-resource-list">
      {resources.map((resource) => { const itemHealth = health[resource.perceptor_id]; return <article key={resource.perceptor_id} className="perceptor-resource-card" data-enabled={resource.enabled}>
        <header><span className="perceptor-kind-icon">{resource.kind === "public_web" ? <Globe2 size={18} /> : <Database size={18} />}</span><span><strong>{resource.name || resource.perceptor_id}</strong><small>{resource.perceptor_id} · {resource.adapter}</small></span><label><input type="checkbox" checked={resource.enabled} disabled={busy} onChange={() => void toggle(resource)} />{resource.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已禁用" : "Disabled")}</label></header>
        <div className="perceptor-capabilities">{resource.capabilities.map((capability) => <code key={capability}>{capability}</code>)}</div>
        <div className="perceptor-state-row"><span className={resource.config.api_key || resource.config.token ? "ok" : "warning"}><ShieldCheck size={12} />{resource.config.api_key || resource.config.token ? (zh ? "凭据已配置" : "Credential configured") : (zh ? "需要凭据" : "Credential required")}</span>{itemHealth ? <span className="ok"><Activity size={12} />{zh ? "最近测试成功" : "Recently tested"}{itemHealth.latency ? ` · ${itemHealth.latency}` : ""}</span> : null}<small title={resource.revision}>rev {resource.revision.slice(-8)}</small></div>
        <footer>{resource.adapter === "tavily" ? <><button type="button" disabled={busy || !resource.enabled} onClick={() => void test(resource, "search")}>{zh ? "测试搜索" : "Test search"}</button><button type="button" disabled={busy || !resource.enabled} onClick={() => void test(resource, "extract")}>{zh ? "测试读取" : "Test extraction"}</button></> : <button type="button" disabled={busy || !resource.enabled} onClick={() => void test(resource, "search")}>{zh ? "查看接入状态" : "Check integration"}</button>}<button type="button" disabled={busy} onClick={() => edit(resource)}><Pencil size={13} />{zh ? "编辑" : "Edit"}</button><button type="button" className="danger" disabled={busy} onClick={() => void remove(resource)}><Trash2 size={13} />{zh ? "删除" : "Delete"}</button></footer>
      </article>; })}
      {!busy && resources.length === 0 ? <div className="settings-empty-state"><Globe2 size={24} /><strong>{zh ? "尚未配置感知器" : "No perceptors configured"}</strong><span>{zh ? "可以先添加网页搜索感知器。" : "Start with a web-search perceptor."}</span></div> : null}
    </section>
  </>;
}

function PerceptorEditor({ draft, setDraft, busy, zh, onSave, onCancel }: { draft: DraftState; setDraft: (value: DraftState) => void; busy: boolean; zh: boolean; onSave: () => void; onCancel: () => void }): React.JSX.Element {
  const patch = (value: Partial<DraftState>) => setDraft({ ...draft, ...value });
  return <section className="settings-section perceptor-editor" data-testid="perceptor-editor"><header><div><h2>{draft.originalId ? (zh ? "编辑感知器" : "Edit perceptor") : (zh ? "新增感知器" : "New perceptor")}</h2><p>{draft.kind === "tavily" ? (zh ? "公共网络搜索与网页读取" : "Public web search and extraction") : (zh ? "大装置实时、历史、事件和数据目录的只读入口" : "Read-only access to facility telemetry, archives, events, and catalogs")}</p></div><button type="button" onClick={onCancel} aria-label={zh ? "关闭编辑器" : "Close editor"}><X size={15} /></button></header>
    <div className="perceptor-form-grid"><label>{zh ? "资源 ID" : "Resource ID"}<input value={draft.id} disabled={Boolean(draft.originalId)} onChange={(event) => patch({ id: event.target.value })} /></label><label>{zh ? "显示名称" : "Display name"}<input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label><label className="wide">{zh ? "服务地址" : "Service URL"}<input value={draft.baseUrl} placeholder="https://..." onChange={(event) => patch({ baseUrl: event.target.value })} /></label><label>{zh ? "凭据" : "Credential"}<input type="password" autoComplete="off" value={draft.apiKey} placeholder={draft.originalId ? (zh ? "已配置；留空保持不变" : "Configured; leave blank to keep") : "tvly-..."} onChange={(event) => patch({ apiKey: event.target.value })} /></label><label>{zh ? "超时（秒）" : "Timeout (seconds)"}<input type="number" min="1" max="120" value={draft.timeoutSeconds} onChange={(event) => patch({ timeoutSeconds: event.target.value })} /></label>
      {draft.kind === "tavily" ? <><label>{zh ? "搜索深度" : "Search depth"}<select value={draft.searchDepth} onChange={(event) => patch({ searchDepth: event.target.value })}><option value="basic">basic</option><option value="advanced">advanced</option></select></label><label>{zh ? "读取深度" : "Extract depth"}<select value={draft.extractDepth} onChange={(event) => patch({ extractDepth: event.target.value })}><option value="basic">basic</option><option value="advanced">advanced</option></select></label><label>{zh ? "单页最大字符" : "Max document characters"}<input type="number" min="1000" value={draft.maxDocumentChars} onChange={(event) => patch({ maxDocumentChars: event.target.value })} /></label></> : <><label className="wide">{zh ? "装置 ID（逗号分隔）" : "Facility IDs (comma separated)"}<input value={draft.facilityIds} onChange={(event) => patch({ facilityIds: event.target.value })} /></label><label className="wide">{zh ? "命名空间（逗号分隔）" : "Namespaces (comma separated)"}<input value={draft.namespaces} onChange={(event) => patch({ namespaces: event.target.value })} /></label><label>{zh ? "数据分级上限" : "Classification ceiling"}<select value={draft.classificationCeiling} onChange={(event) => patch({ classificationCeiling: event.target.value })}><option value="public">public</option><option value="internal">internal</option><option value="restricted">restricted</option></select></label><label>{zh ? "最大时间范围（秒）" : "Max time range (seconds)"}<input type="number" min="1" value={draft.maxTimeRangeSeconds} onChange={(event) => patch({ maxTimeRangeSeconds: event.target.value })} /></label><label>{zh ? "最大数据点" : "Max points"}<input type="number" min="1" value={draft.maxPoints} onChange={(event) => patch({ maxPoints: event.target.value })} /></label></>}
    </div><label className="settings-toggle"><span><strong>{zh ? "启用资源" : "Enable resource"}</strong><small>{zh ? "禁用后不会进入新运行的能力解析。" : "Disabled resources do not enter capability resolution for new runs."}</small></span><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /></label><footer><button type="button" onClick={onCancel} disabled={busy}>{zh ? "取消" : "Cancel"}</button><button type="button" className="primary" onClick={onSave} disabled={busy}><Plus size={14} />{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "保存感知器" : "Save perceptor")}</button></footer>
  </section>;
}

function toRequest(draft: DraftState): SavePerceptorRequest {
  const secret = draft.apiKey.trim();
  const common = { base_url: draft.baseUrl.trim(), timeout_seconds: number(draft.timeoutSeconds, 15), ...(secret ? { api_key: secret } : { api_key: "********" }) };
  return draft.kind === "tavily" ? { perceptor_id: draft.id, name: draft.name, kind: "public_web", adapter: "tavily", enabled: draft.enabled, capabilities: ["web.search", "web.extract"], config: { ...common, search_depth: draft.searchDepth, extract_depth: draft.extractDepth, max_document_chars: number(draft.maxDocumentChars, 20000) } } : { perceptor_id: draft.id, name: draft.name, kind: "large_facility_data", adapter: "facility_gateway", enabled: draft.enabled, capabilities: FACILITY_CAPABILITIES, config: { ...common, facility_ids: split(draft.facilityIds), namespaces: split(draft.namespaces), classification_ceiling: draft.classificationCeiling, max_time_range_seconds: number(draft.maxTimeRangeSeconds, 86400), max_points: number(draft.maxPoints, 10000) } };
}

function split(value: string): string[] { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function asList(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function number(value: string, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
