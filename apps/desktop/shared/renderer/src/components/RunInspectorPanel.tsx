import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  ClipboardCopy,
  FlaskConical,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { userFacingExecutionSource } from "../userFacingLanguage";
import type { OaepItem } from "@shared/oaep.generated";
import type { RunInspection, RunInspectionOpenRequest, RunInspectionTimelineItem } from "@shared/runInspection";
import { redactRunInspectionText, sanitizeRunInspection, sanitizeRunInspectionValue } from "@shared/runInspectionSafety";
import { desktopApi } from "../desktopApi";
import { copyTextSafely } from "../clipboard";
import { RunExperimentPanel } from "./RunExperimentPanel";
import { SessionRunHistory } from "./SessionRunHistory";

interface RunInspectorPanelProps {
  language: "en" | "zh";
  request: RunInspectionOpenRequest | null;
  focusedItemId?: string;
  onOpenDebug?: () => void;
  onOpenRun?: (runId: string) => void;
}

interface WebSearchCandidateInspection {
  rank: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  accepted: boolean;
  reason: string;
}

interface WebSearchInspection {
  kind: "web_search";
  query: string;
  requested_query?: string;
  effective_query?: string;
  rewrite_reason?: string;
  provider: string;
  candidate_count: number;
  accepted_count: number;
  rejected_count: number;
  candidates: WebSearchCandidateInspection[];
}

const ITEM_TYPES = [
  "message", "reasoning", "plan", "command_execution", "file_change", "tool_call",
  "artifact", "interaction", "subtask", "notice",
] as const;

export function RunInspectorPanel({
  language,
  request,
  focusedItemId,
  onOpenDebug,
  onOpenRun,
}: RunInspectorPanelProps): React.JSX.Element {
  const zh = language === "zh";
  const [inspection, setInspection] = useState<RunInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [itemType, setItemType] = useState("");
  const [itemStatus, setItemStatus] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(focusedItemId);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exportReceipt, setExportReceipt] = useState("");
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [followLive, setFollowLive] = useState(true);
  const panelRef = useRef<HTMLElement | null>(null);
  const focusedRunRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    if (request?.createExperiment) setExperimentOpen(true);
  }, [request]);

  useEffect(() => {
    setSelectedItemId(focusedItemId);
    if (focusedItemId) {
      setItemType("");
      setItemStatus("");
    }
  }, [focusedItemId]);

  useEffect(() => {
    if (!request) {
      setInspection(null);
      setError("");
      return;
    }
    let active = true;
    const requestGeneration = ++requestGenerationRef.current;
    setInspection((current) => current?.run.run_id === request.runId ? current : null);
    setLoading(true);
    setError("");
    void (async () => {
      let timelineCursor: string | undefined;
      if (focusedItemId) {
        const locator = await desktopApi.locateRunItem({
          workspacePath: request.workspacePath,
          workspaceId: request.workspaceId,
          runId: request.runId,
          itemId: focusedItemId,
        });
        timelineCursor = locator.timeline_cursor ?? undefined;
      }
      const result = sanitizeRunInspection(await desktopApi.getRunInspection({
        ...request,
        timelineCursor,
        limit: 100,
        itemType: focusedItemId ? undefined : itemType || undefined,
        status: focusedItemId ? undefined : itemStatus || undefined,
      }));
      if (!active || requestGeneration !== requestGenerationRef.current) return;
      setInspection(result);
      if (focusedItemId && result.timeline.some((item) => item.id === focusedItemId)) {
        setSelectedItemId(focusedItemId);
        const index = result.timeline.findIndex((item) => item.id === focusedItemId);
        setVisibleStart(Math.floor(index / 200) * 200);
      } else if (focusedItemId) {
        setError(zh ? "未找到目标项目；你仍可浏览当前运行。" : "The requested item was not found; the Run is still available.");
      }
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [focusedItemId, itemStatus, itemType, reloadNonce, request]);

  const selectedItem = useMemo(
    () => inspection?.timeline.find((item) => item.id === selectedItemId),
    [inspection, selectedItemId],
  );
  const webSearchInspection = useMemo(
    () => selectedItem ? findWebSearchInspection(selectedItem.content) : null,
    [selectedItem],
  );

  useEffect(() => {
    if (!request || livePaused) return;
    let debounce: number | undefined;
    const refresh = (): void => {
      if (debounce !== undefined) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => setReloadNonce((value) => value + 1), 120);
    };
    const unsubscribe = desktopApi.onAgentRunEvent((event) => {
      if (event.runId === request.runId) refresh();
    });
    const terminal = inspection && ["completed", "failed", "cancelled"].includes(String(inspection.run.status));
    const poll = terminal ? undefined : window.setInterval(refresh, 2000);
    return () => {
      unsubscribe();
      if (debounce !== undefined) window.clearTimeout(debounce);
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [inspection?.run.status, livePaused, request]);

  useEffect(() => {
    if (followLive && !focusedItemId && inspection?.timeline.length) {
      setVisibleStart(Math.floor((inspection.timeline.length - 1) / 200) * 200);
    }
  }, [focusedItemId, followLive, inspection?.timeline.length]);

  useEffect(() => {
    const loadedRunId = inspection?.run.run_id;
    if (!loadedRunId || focusedRunRef.current === loadedRunId) return;
    focusedRunRef.current = loadedRunId;
    panelRef.current?.focus();
  }, [inspection?.run.run_id]);

  const describedError = error ? describeInspectionError(error, language) : null;

  async function loadMore(): Promise<void> {
    if (!request || !inspection?.page.next_cursor || loading) return;
    const requestGeneration = requestGenerationRef.current;
    const runId = inspection.run.run_id;
    setLoading(true);
    try {
      const next = sanitizeRunInspection(await desktopApi.getRunInspection({
        ...request,
        timelineCursor: inspection.page.next_cursor,
        limit: 100,
        itemType: itemType || undefined,
        status: itemStatus || undefined,
      }));
      if (requestGeneration !== requestGenerationRef.current || next.run.run_id !== runId) return;
      setInspection((current) => current?.run.run_id === runId ? {
        ...next,
        timeline: [...current.timeline, ...next.timeline],
      } : current);
      setVisibleStart(Math.floor(inspection.timeline.length / 200) * 200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  if (!request) {
    return <section className="run-inspector-panel run-inspector-empty" aria-label={zh ? "运行检查器" : "Run Inspector"}>
      <CircleEllipsis size={28} aria-hidden />
      <h2>{zh ? "尚未选择运行" : "No run selected"}</h2>
      <p>{zh ? "在聊天消息中选择“查看运行”，这里会显示完整的只读轨迹。" : "Choose View run on a chat message to inspect its read-only trace."}</p>
    </section>;
  }

  if (error && !inspection) {
    return <section className="run-inspector-panel run-inspector-empty" role="alert">
      <AlertCircle size={28} aria-hidden />
      <h2>{describedError?.title || (zh ? "无法读取运行" : "Unable to load run")}</h2>
      <p>{describedError?.action}</p>
      <button type="button" onClick={() => setReloadNonce((value) => value + 1)}><RefreshCw size={14} />{zh ? "重试" : "Retry"}</button>
      <details><summary>{zh ? "技术详情" : "Technical details"}</summary><code>{describedError?.code}</code><pre>{redactRunInspectionText(error)}</pre></details>
    </section>;
  }

  if (!inspection) {
    return <section className="run-inspector-panel run-inspector-empty" aria-busy="true"><CircleEllipsis className="spin" size={28} /><p>{zh ? "正在读取运行证据…" : "Loading run evidence…"}</p></section>;
  }

  const manifest = inspection.manifest;
  const inspectedRunId = inspection.run.run_id;
  const statusLabel = runStatusLabel(String(inspection.run.status), language);
  const duration = formatDuration(inspection.summary.duration_ms, language);
  const counts = Object.entries(inspection.summary.counts_by_item_type).filter(([, count]) => count > 0);
  const visibleTimeline = inspection.timeline.slice(visibleStart, visibleStart + 200);
  const artifactsAndChanges = inspection.timeline.filter((item) => item.type === "artifact" || item.type === "file_change");
  const notRecorded = zh ? "未记录" : "Not recorded";

  async function exportSafeManifest(): Promise<void> {
    if (!request) return;
    setLoading(true);
    setError("");
    let exported: Awaited<ReturnType<typeof desktopApi.exportRunReproductionManifest>>;
    try {
      exported = await desktopApi.exportRunReproductionManifest(request);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
      return;
    }
    if (exported.cancelled) {
      setLoading(false);
      return;
    }
    const fileName = exported.savedPath?.split(/[\\/]/).pop() || `opendrsai-run-${inspectedRunId}-manifest.json`;
    setExportReceipt(zh ? `已安全导出：${fileName}` : `Safely exported: ${fileName}`);
    setExportConfirmOpen(false);
    setLoading(false);
  }

  return <section ref={panelRef} tabIndex={-1} className="run-inspector-panel" aria-label={zh ? "运行检查器" : "Run Inspector"} data-run-id={inspection.run.run_id} data-stale={error ? "true" : "false"}>
    <header className="run-inspector-header">
      <div>
        <small>{zh ? "只读运行证据" : "Read-only run evidence"}</small>
        <h2>{zh ? "运行检查器" : "Run Inspector"}</h2>
      </div>
      <div className="run-inspector-header-actions">
        <button type="button" aria-pressed={livePaused} onClick={() => setLivePaused((value) => !value)}>{livePaused ? <Play size={16} /> : <Pause size={16} />}{livePaused ? (zh ? "恢复实时更新" : "Resume live updates") : (zh ? "暂停实时更新" : "Pause live updates")}</button>
        <button type="button" aria-pressed={followLive} onClick={() => setFollowLive((value) => !value)}>{zh ? "跟随最新" : "Follow latest"}</button>
        <button data-testid="create-run-experiment" type="button" onClick={() => setExperimentOpen(true)}><FlaskConical size={16} />{zh ? "创建实验" : "Create experiment"}</button>
        <button type="button" className="icon-button" onClick={() => setReloadNonce((value) => value + 1)} aria-label={zh ? "刷新" : "Refresh"}><RefreshCw size={16} /></button>
      </div>
    </header>
    {loading ? <p className="run-inspector-refreshing" role="status">{zh ? "正在刷新证据…" : "Refreshing evidence…"}</p> : null}

    {onOpenRun && inspection.run.session_id ? <SessionRunHistory
      workspacePath={request.workspacePath}
      workspaceId={request.workspaceId}
      sessionId={String(inspection.run.session_id)}
      selectedRunId={inspection.run.run_id}
      language={language}
      onSelectRun={onOpenRun}
    /> : null}

    <div className="run-inspector-overview">
      <div className={`run-inspector-status status-${inspection.run.status}`}>
        {inspection.run.status === "completed" ? <CheckCircle2 size={16} /> : inspection.run.status === "failed" ? <AlertCircle size={16} /> : <CircleEllipsis size={16} />}
        <strong>{statusLabel}</strong>{duration ? <span>· {duration}</span> : null}
      </div>
      <dl>
        <div><dt>Run ID</dt><dd><button type="button" onClick={() => void copyTextSafely(inspection.run.run_id)}>{inspection.run.run_id}</button></dd></div>
        <div><dt>{zh ? "执行端" : "Backend"}</dt><dd>{String(inspection.run.backend_id || notRecorded)}</dd></div>
        <div><dt>Agent</dt><dd>{String(inspection.run.agent_definition || notRecorded)}</dd></div>
        <div><dt>{zh ? "模型" : "Model"}</dt><dd>{String((manifest.manifest.model as Record<string, unknown> | undefined)?.id || notRecorded)}</dd></div>
        <div><dt>{zh ? "开始时间" : "Started"}</dt><dd>{formatTimestamp(String(inspection.run.started_at || inspection.run.created_at || ""), notRecorded)}</dd></div>
        <div><dt>{zh ? "结束时间" : "Finished"}</dt><dd>{formatTimestamp(String(inspection.run.completed_at || ""), notRecorded)}</dd></div>
      </dl>
      {counts.length ? <div className="run-inspector-counts">{counts.map(([type, count]) => <span key={type}>{itemTypeLabel(type, language)} {count}</span>)}</div> : null}
      <div className="run-inspector-usage"><span>{zh ? "输入" : "Input"} {inspection.summary.usage.input_tokens}</span><span>{zh ? "输出" : "Output"} {inspection.summary.usage.output_tokens}</span><span>{zh ? "产物" : "Artifacts"} {inspection.summary.artifact_count}</span><span>{zh ? "警告" : "Warnings"} {inspection.summary.warning_count}</span></div>
      {inspection.summary.error ? <p className="run-inspector-error-summary" role="status"><AlertCircle size={14} />{inspection.summary.error.message}</p> : null}
      <small className="run-inspector-version">{inspection.schema_version} · {manifest.schema_version}</small>
    </div>

    <details className="run-inspector-section" open>
      <summary>{zh ? "时间线" : "Timeline"}<ChevronRight size={14} /></summary>
      <div className="run-inspector-filters">
        <label>{zh ? "类型" : "Type"}<select value={itemType} onChange={(event) => setItemType(event.target.value)}><option value="">{zh ? "全部" : "All"}</option>{ITEM_TYPES.map((type) => <option key={type} value={type}>{itemTypeLabel(type, language)}</option>)}</select></label>
        <label>{zh ? "状态" : "Status"}<select value={itemStatus} onChange={(event) => setItemStatus(event.target.value)}><option value="">{zh ? "全部" : "All"}</option>{["pending", "running", "waiting", "completed", "failed", "cancelled"].map((status) => <option key={status} value={status}>{runStatusLabel(status, language)}</option>)}</select></label>
      </div>
      {inspection.timeline.length ? <ol className="run-inspector-timeline" data-rendered-items={visibleTimeline.length}>
        {visibleTimeline.map((item) => <TimelineItem key={item.id} item={item} language={language} selected={selectedItemId === item.id} onSelect={() => setSelectedItemId(item.id)} />)}
      </ol> : <p className="run-inspector-muted">{zh ? "当前筛选条件下没有事件。" : "No items match the current filters."}</p>}
      {inspection.timeline.length > 200 ? <div className="run-inspector-window-controls"><button type="button" disabled={visibleStart === 0} onClick={() => setVisibleStart(Math.max(0, visibleStart - 200))}>{zh ? "上一段" : "Previous window"}</button><span>{visibleStart + 1}–{Math.min(visibleStart + 200, inspection.timeline.length)} / {inspection.timeline.length}</span><button type="button" disabled={visibleStart + 200 >= inspection.timeline.length} onClick={() => setVisibleStart(visibleStart + 200)}>{zh ? "下一段" : "Next window"}</button></div> : null}
      {inspection.page.has_more ? <button type="button" className="run-inspector-load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? (zh ? "加载中…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
    </details>

    {selectedItem ? <details className="run-inspector-section" open>
      <summary>{zh ? "项目详情" : "Item details"}<ChevronRight size={14} /></summary>
      <div className="run-inspector-item-detail">
        <button type="button" onClick={() => void copyTextSafely(selectedItem.id)} aria-label={zh ? "复制完整记录编号" : "Copy full record identifier"}>{zh ? "记录" : "Record"} {selectedItem.id.slice(-8)}</button>
        <dl><div><dt>{zh ? "状态" : "Status"}</dt><dd>{runStatusLabel(selectedItem.status, language)}</dd></div><div><dt>{zh ? "来源" : "Source"}</dt><dd>{userFacingExecutionSource(selectedItem.source.backend, language)}</dd></div></dl>
        {webSearchInspection ? <WebSearchInspectionView value={webSearchInspection} language={language} /> : null}
        <details><summary>{zh ? "查看脱敏技术数据" : "View redacted technical data"}</summary><pre>{boundedJson(selectedItem.content)}</pre></details>
        <p><strong>{zh ? "事件引用" : "Event references"}:</strong> {selectedItem.event_refs.length ? selectedItem.event_refs.map((ref) => `${ref.event_id} (#${ref.sequence})`).join(", ") : (zh ? "未记录" : "Not recorded")}</p>
      </div>
    </details> : null}

    <details className="run-inspector-section">
      <summary>{zh ? "输入与配置" : "Inputs and configuration"}<ChevronRight size={14} /></summary>
      <pre>{boundedJson(selectSafeConfiguration(manifest.manifest))}</pre>
    </details>

    <details className="run-inspector-section">
      <summary>{zh ? "产物与变更" : "Artifacts and changes"}<ChevronRight size={14} /></summary>
      {artifactsAndChanges.length ? <ul>{artifactsAndChanges.map((item) => <li key={item.id}><button type="button" onClick={() => setSelectedItemId(item.id)}>{itemTypeLabel(item.type, language)} · {itemSummary(item, language)}</button></li>)}</ul> : <p className="run-inspector-muted">{zh ? "当前已加载范围内没有产物或文件变更。" : "No artifacts or file changes in the loaded range."}</p>}
    </details>

    <details className="run-inspector-section" open>
      <summary>{zh ? "复现清单" : "Reproduction manifest"}<ChevronRight size={14} /></summary>
      <div className="run-inspector-manifest">
        <div className={`reproducibility-badge level-${manifest.reproducibility_level}`}><ShieldCheck size={15} />{reproducibilityLabel(manifest.reproducibility_level, language)}</div>
        <p>{reproducibilityDescription(manifest.reproducibility_level, language)}</p>
        {manifest.missing_evidence.length ? <ul>{manifest.missing_evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        <dl><div><dt>{zh ? "脱敏清单摘要" : "Safe manifest digest"}</dt><dd>{manifest.safe_manifest_digest}</dd></div></dl>
        <div className="run-inspector-manifest-actions"><button type="button" onClick={() => void copyTextSafely(JSON.stringify(manifest, null, 2))}><ClipboardCopy size={14} />{zh ? "复制脱敏复现清单" : "Copy safe manifest"}</button><button type="button" onClick={() => setExportConfirmOpen(true)}>{zh ? "导出 JSON…" : "Export JSON…"}</button></div>
        {exportConfirmOpen ? <div className="run-inspector-export-notice" role="dialog" aria-modal="true" aria-label={zh ? "导出隐私提示" : "Export privacy notice"}><strong>{zh ? "保存前请确认" : "Before saving"}</strong><p>{zh ? "导出文件包含脱敏后的运行配置、证据摘要、缺失证据列表和完整性摘要；不包含提示词正文、凭据或绝对秘密路径。" : "The export includes redacted run configuration, evidence and missing-evidence summaries, plus integrity digests. Prompt bodies, credentials, and sensitive absolute paths are excluded."}</p><button type="button" disabled={loading} onClick={() => void exportSafeManifest()}>{loading ? (zh ? "正在准备…" : "Preparing…") : (zh ? "确认导出" : "Export")}</button><button type="button" onClick={() => setExportConfirmOpen(false)}>{zh ? "取消" : "Cancel"}</button></div> : null}
        {exportReceipt ? <p className="run-inspector-export-receipt" role="status">{exportReceipt}</p> : null}
      </div>
    </details>

    {error && describedError ? <aside className="run-inspector-inline-error" role="alert"><strong>{describedError.title}</strong><p>{describedError.action}</p><details><summary>{zh ? "技术详情" : "Technical details"}</summary><code>{describedError.code}</code><pre>{redactRunInspectionText(error)}</pre></details></aside> : null}
    {onOpenDebug ? <button type="button" className="run-inspector-debug-link" onClick={onOpenDebug}>{zh ? "打开技术诊断" : "Open technical diagnostics"}</button> : null}
    {experimentOpen && request ? <RunExperimentPanel request={request} itemId={selectedItemId} language={language} onClose={() => setExperimentOpen(false)} /> : null}
  </section>;
}

function WebSearchInspectionView({ value, language }: { value: WebSearchInspection; language: "en" | "zh" }): React.JSX.Element {
  const zh = language === "zh";
  const requested = value.requested_query || value.query;
  const effective = value.effective_query || value.query;
  const rewritten = requested !== effective;
  return <section className="run-inspector-search-results" aria-label={zh ? "网络搜索结果" : "Web search results"}>
    <header>
      <div>
        <strong>{zh ? "搜索结果" : "Search results"}</strong>
        {rewritten ? <>
          <small>{zh ? `原始问题：${requested}` : `Requested: ${requested}`}</small>
          <small>{zh ? `实际搜索：${effective}` : `Searched: ${effective}`}</small>
        </> : <small>{effective}</small>}
      </div>
      <span>{zh ? `${value.accepted_count} 条采用 · ${value.rejected_count} 条过滤` : `${value.accepted_count} used · ${value.rejected_count} filtered`}</span>
    </header>
    {value.candidates.length ? <ol>
      {value.candidates.map((candidate) => <li key={`${candidate.rank}:${candidate.url}`}>
        <div className="run-inspector-search-result-heading">
          <span className={candidate.accepted ? "accepted" : "rejected"}>{candidate.accepted ? (zh ? "采用" : "Used") : (zh ? "已过滤" : "Filtered")}</span>
          <button type="button" onClick={() => void desktopApi.openExternal(candidate.url)}>{candidate.title}</button>
        </div>
        <small>{candidate.domain || candidate.url}</small>
        {candidate.snippet ? <p>{candidate.snippet}</p> : null}
        {!candidate.accepted ? <em>{searchRejectionLabel(candidate.reason, language)}</em> : null}
      </li>)}
    </ol> : <p className="run-inspector-muted">{zh ? "搜索引擎没有返回可展示的候选结果。" : "The search engine returned no displayable candidates."}</p>}
  </section>;
}

function searchRejectionLabel(reason: string, language: "en" | "zh"): string {
  if (reason === "query_mismatch") return language === "zh" ? "与查询主体不匹配" : "Did not match the query entity";
  if (reason === "result_limit") return language === "zh" ? "超出本次采用数量" : "Beyond the result limit";
  return language === "zh" ? "未采用" : "Not used";
}

function findWebSearchInspection(value: unknown, depth = 0): WebSearchInspection | null {
  if (depth > 5) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try { return findWebSearchInspection(JSON.parse(trimmed), depth + 1); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findWebSearchInspection(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidate = record._inspection && typeof record._inspection === "object"
    ? record._inspection as Record<string, unknown>
    : record;
  if (candidate.kind === "web_search" && Array.isArray(candidate.candidates)) {
    return candidate as unknown as WebSearchInspection;
  }
  for (const key of ["result", "content", "output", "tool"]) {
    const found = findWebSearchInspection(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function describeInspectionError(raw: string, language: "en" | "zh"): { title: string; action: string; code: string } {
  const zh = language === "zh";
  const code = raw.match(/\b(?:run_[a-z0-9_]+|unsupported_[a-z0-9_]+|[a-z][a-z0-9]+(?:_[a-z0-9]+){1,8}|http_[0-9]{3})\b/i)?.[0] || "run_inspection_error";
  if (/403|unauthor|forbidden/i.test(raw)) return { title: zh ? "没有查看此运行的权限" : "You cannot view this Run", action: zh ? "确认当前工作区和账号后重试；运行内容没有被删除。" : "Check the current Workspace and account, then retry. The Run was not deleted.", code };
  if (/404|not.?found/i.test(raw)) return { title: zh ? "找不到此运行" : "This Run could not be found", action: zh ? "返回运行历史选择仍存在的运行，或重新同步当前会话。" : "Choose an available Run from Run History, or resync this Session.", code };
  if (/409|stale|conflict|digest/i.test(raw)) return { title: zh ? "运行证据已经变化" : "The Run evidence changed", action: zh ? "刷新后重新检查；旧的计划或预览不会被继续执行。" : "Refresh and review again. A stale Plan or preview will not continue.", code };
  if (/policy|block|unsupported|evidence/i.test(raw)) return { title: zh ? "Runtime 已安全阻止此操作" : "Runtime safely blocked this operation", action: zh ? "展开技术详情查看缺失证据，并在补齐能力后重新生成计划。" : "Open technical details to see the missing evidence, then regenerate the Plan after the capability is available.", code };
  if (/offline|network|connect|timeout|503/i.test(raw)) return { title: zh ? "Runtime 暂时不可用" : "Runtime is temporarily unavailable", action: zh ? "现有证据已保留。恢复连接后重试。" : "Existing evidence is preserved. Retry after connectivity returns.", code };
  return { title: zh ? "无法更新运行证据" : "Run evidence could not be updated", action: zh ? "重试；若仍失败，请打开技术诊断并提供错误代码。" : "Retry. If it continues, open technical diagnostics and include the error code.", code };
}

function TimelineItem({ item, language, selected, onSelect }: { item: RunInspectionTimelineItem; language: "en" | "zh"; selected: boolean; onSelect: () => void }): React.JSX.Element {
  return <li><button type="button" className={selected ? "selected" : ""} onClick={onSelect} data-item-id={item.id}>
    <span className={`run-item-dot status-${item.status}`} aria-hidden />
    <span><strong>{itemTypeLabel(item.type, language)}</strong><small>{itemSummary(item, language)}</small></span>
    <time>{formatClock(item.updated_at)}</time>
  </button></li>;
}

function itemSummary(item: OaepItem, language: "en" | "zh"): string {
  const content = item.content as unknown as Record<string, unknown>;
  for (const key of ["summary", "title", "name", "reason", "code", "phase", "prompt", "text"]) {
    if (typeof content[key] === "string" && content[key]) return redactDisplayText(String(content[key])).slice(0, 160);
  }
  return language === "zh" ? runStatusLabel(item.status, language) : runStatusLabel(item.status, language);
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(sanitizeRunInspectionValue(value), null, 2) ?? "";
  return serialized.length > 8_000 ? `${serialized.slice(0, 8_000)}\n… [truncated]` : serialized;
}

function redactDisplayText(value: string): string {
  return redactRunInspectionText(value);
}

function formatClock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimestamp(value: string, fallback: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toLocaleString();
}

function selectSafeConfiguration(manifest: Record<string, unknown>): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const key of ["runtime", "backend", "protocol", "agent", "model", "prompt", "input", "attachments", "workspace", "environment", "tools", "skills", "external_dependencies", "security"]) {
    if (key in manifest) selected[key] = manifest[key];
  }
  return selected;
}

function formatDuration(value: number | null, language: "en" | "zh"): string {
  if (value === null) return "";
  if (value < 1_000) return language === "zh" ? "少于 1 秒" : "<1s";
  const seconds = Math.floor(value / 1_000);
  return seconds < 60 ? `${seconds}${language === "zh" ? " 秒" : "s"}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function runStatusLabel(status: string, language: "en" | "zh"): string {
  const zh: Record<string, string> = { queued: "排队中", pending: "待处理", running: "运行中", waiting: "等待中", waiting_approval: "等待审批", completed: "已完成", failed: "失败", cancelled: "已取消" };
  const en: Record<string, string> = { queued: "Queued", pending: "Pending", running: "Running", waiting: "Waiting", waiting_approval: "Waiting for approval", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
  return (language === "zh" ? zh : en)[status] ?? status;
}

function itemTypeLabel(type: string, language: "en" | "zh"): string {
  const zh: Record<string, string> = { message: "消息", reasoning: "分析摘要", plan: "计划", command_execution: "命令", file_change: "文件变更", tool_call: "工具调用", artifact: "产物", interaction: "交互/审批", subtask: "子任务", notice: "运行信息" };
  const en: Record<string, string> = { message: "Message", reasoning: "Analysis summary", plan: "Plan", command_execution: "Command", file_change: "File change", tool_call: "Tool call", artifact: "Artifact", interaction: "Interaction", subtask: "Subtask", notice: "Run notice" };
  return (language === "zh" ? zh : en)[type] ?? type;
}

function reproducibilityLabel(level: string, language: "en" | "zh"): string {
  const zh: Record<string, string> = { exact: "复现证据完整", compatible: "可在兼容环境复现", partial: "部分可复现", unavailable: "暂不可复现" };
  const en: Record<string, string> = { exact: "Complete evidence", compatible: "Compatible reproduction", partial: "Partially reproducible", unavailable: "Not reproducible yet" };
  return (language === "zh" ? zh : en)[level] ?? level;
}

function reproducibilityDescription(level: string, language: "en" | "zh"): string {
  if (language === "zh") return level === "exact" ? "关键输入和配置均有固定版本或摘要。此等级不承诺模型逐字输出一致。" : "系统会列出缺失或可变的证据；这不是一键重放承诺。";
  return level === "exact" ? "Critical inputs and configuration are versioned or digested. This does not promise byte-identical model output." : "Missing or mutable evidence is listed below; this is not a one-click replay guarantee.";
}
