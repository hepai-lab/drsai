import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Database,
  FileText,
  Globe2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { desktopApi } from "../desktopApi";
import type { KnowledgeBaseResource, AgentKnowledgePolicy, AgentKnowledgePreview } from "@shared/desktopApi";
import type { RAGFlowDiscoverResult } from "../../../main/myDrSaiConfig";

interface KnowledgeBasePanelProps {
  agentId: string;
  language: "zh" | "en";
}

export function KnowledgeBasePanel({ agentId, language }: KnowledgeBasePanelProps): React.JSX.Element {
  const refreshTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseResource[]>([]);
  const [knowledgePolicy, setKnowledgePolicy] = useState<AgentKnowledgePolicy | null>(null);
  const [knowledgePreview, setKnowledgePreview] = useState<AgentKnowledgePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, Array<{ source: string; score: number; content?: string }>>>({});
  const [fileList, setFileList] = useState<Record<string, Array<{ source: string; title: string; status: string; mtime: number; size: number }>>>({});
  const [fileListOpen, setFileListOpen] = useState<Record<string, boolean>>({});
  const [staleInfo, setStaleInfo] = useState<Record<string, boolean>>({});
  const [staleChecking, setStaleChecking] = useState<Record<string, boolean>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({
    id: "",
    name: "",
    type: "local-files" as "local-files" | "ragflow",
    location: "",
    dataset: "",
    credential: "",
  });
  const RAGFLOW_BASE_URL = "https://ragflow.ihep.ac.cn";
  const [ragflowApiKey, setRagflowApiKey] = useState("");
  const [discoveredDatasets, setDiscoveredDatasets] = useState<Array<{ id: string; name: string; chunk_count: number; document_count: number; status: string; selected: boolean }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [ragflowConnectError, setRagflowConnectError] = useState<string | null>(null);

  const [rediscovering, setRediscovering] = useState(false);
  const [newDatasets, setNewDatasets] = useState<Array<{ id: string; name: string; chunk_count: number; document_count: number; status: string; selected: boolean }>>([]);

  const isZh = language === "zh";

  const refresh = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    setError(null);
    try {
      const [bases, policy, preview] = await Promise.all([
        desktopApi.listKnowledgeBases(),
        desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId),
        desktopApi.previewMyDrSaiAgentKnowledge(agentId),
      ]);
      setKnowledgeBases(bases);
      setKnowledgePolicy(policy);
      setKnowledgePreview(preview);
      retryCountRef.current = 0;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      const transient = msg.includes("not running") || msg.includes("is not running") || msg.includes("gateway") || msg.includes("Gateway") || msg.includes("bootstrap") || msg.includes("503");
      if (transient && retryCountRef.current < 5) {
        const delay = Math.min(10_000, 500 * 2 ** retryCountRef.current);
        retryCountRef.current += 1;
        if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => void refresh(), delay);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  useEffect(() => {
    retryCountRef.current = 0;
    void refresh();
    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  const toggleKnowledgeBase = async (knowledgeId: string, checked: boolean) => {
    if (!knowledgePolicy || !knowledgePreview) return;
    setBusy(true);
    setError(null);
    try {
      // If enabling a local KB that hasn't been indexed, try indexing first
      if (checked) {
        const kb = knowledgeBases.find((b) => b.knowledge_id === knowledgeId);
        if (kb && kb.type === "local-files" && kb.status === "not_indexed") {
          try { await desktopApi.indexKnowledgeBase(knowledgeId); } catch { /* best-effort */ }
        }
      }
      // Re-fetch the latest policy to avoid revision conflict
      const freshPolicy = await desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId);
      const freshPreview = await desktopApi.previewMyDrSaiAgentKnowledge(agentId);
      const current = new Set(freshPreview.sources);
      if (checked) current.add(knowledgeId);
      else current.delete(knowledgeId);
      await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, {
        ...freshPolicy,
        mode: "explicit",
        sources: [...current],
        expected_revision: freshPolicy.revision,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!draft.location) return;
    setBusy(true);
    setError(null);
    try {
      const path = draft.location.replace(/[\\/]+$/, "");
      const folderName = path.split(/[\\/]/).filter(Boolean).pop() || "local";
      const knowledgeId = "local-" + folderName
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-")
        .slice(0, 120)
        .replace(/^[^a-z]/, (match) => "kb" + match);
      const displayName = folderName;
      await desktopApi.createKnowledgeBase({
        knowledge_id: knowledgeId,
        display_name: displayName,
        type: "local-files",
        enabled: true,
        config: { root_path: draft.location, paths: ["."], chunk_size: 800, chunk_overlap: 120 },
      });
      // Index the knowledge base so it can be searched immediately
      try {
        await desktopApi.indexKnowledgeBase(knowledgeId);
      } catch (cause) {
        const indexErr = cause instanceof Error ? cause.message : String(cause);
        setError(`${isZh ? "索引失败" : "Index failed"}: ${indexErr}`);
      }
      setDraft({ id: "", name: "", type: "local-files", location: "", dataset: "", credential: "" });
      setShowAddForm(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleRagflowDiscover = async () => {
    if (!ragflowApiKey.trim()) return;
    setDiscovering(true);
    setRagflowConnectError(null);
    try {
      const result = await desktopApi.discoverRagflowDatasets(ragflowApiKey);
      setDiscoveredDatasets(result.datasets.map((ds) => ({ ...ds, selected: false })));
    } catch (cause) {
      setRagflowConnectError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiscovering(false);
    }
  };

  const handleRagflowAddSelected = async () => {
    const selected = discoveredDatasets.filter((ds) => ds.selected);
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const ds of selected) {
        const kbId = "ragflow-" + ds.id.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase().replace(/^-+|-+$/g, "").slice(0, 120);
        const existing = knowledgeBases.find((kb) => kb.knowledge_id === kbId);
        if (existing) continue;
        await desktopApi.createKnowledgeBase({
          knowledge_id: kbId,
          display_name: ds.name || "RAGFlow " + ds.id.slice(0, 8),
          type: "ragflow",
          enabled: true,
          config: { base_url: RAGFLOW_BASE_URL, dataset_ids: [ds.id] },
          ...(ragflowApiKey ? { credential: ragflowApiKey } : {}),
        });
      }
            setDiscoveredDatasets([]);
      setShowAddForm(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleRediscoverRagflow = async () => {
    const ragflowKB = knowledgeBases.find((kb) => kb.type === "ragflow");
    if (!ragflowKB) return;
    setRediscovering(true);
    setRagflowConnectError(null);
    try {
      const result = await desktopApi.rediscoverRagflowDatasets();
      const existingIds = new Set(knowledgeBases.filter((kb) => kb.type === "ragflow").map((kb) => {
        const dsId = kb.config?.dataset_ids?.[0] ?? "";
        return dsId;
      }));
      const fresh = result.datasets
        .filter((ds) => !existingIds.has(ds.id))
        .map((ds) => ({ ...ds, selected: false }));
      setNewDatasets(fresh);
    } catch (cause) {
      setRagflowConnectError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRediscovering(false);
    }
  };

  const handleAddNewDatasets = async () => {
    const selected = newDatasets.filter((ds) => ds.selected);
    if (selected.length === 0) return;
    setDiscoveredDatasets(selected);
    setNewDatasets([]);
    await handleRagflowAddSelected();
  };

  const handleDelete = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await desktopApi.deleteKnowledgeBase(knowledgeId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleIndex = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await desktopApi.indexKnowledgeBase(knowledgeId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleListFiles = async (knowledgeId: string) => {
    const isOpen = fileListOpen[knowledgeId];
    if (isOpen) {
      setFileListOpen((prev) => ({ ...prev, [knowledgeId]: false }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await desktopApi.listKnowledgeBaseFiles(knowledgeId);
      setFileList((prev) => ({ ...prev, [knowledgeId]: result.data }));
      setFileListOpen((prev) => ({ ...prev, [knowledgeId]: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleStaleCheck = async (knowledgeId: string) => {
    setStaleChecking((prev) => ({ ...prev, [knowledgeId]: true }));
    try {
      const result = await desktopApi.checkKnowledgeBaseStale(knowledgeId);
      setStaleInfo((prev) => ({ ...prev, [knowledgeId]: result.stale }));
    } catch (cause) {
      // Silently fail for stale check
    } finally {
      setStaleChecking((prev) => ({ ...prev, [knowledgeId]: false }));
    }
  };

  const handleTest = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await desktopApi.testKnowledgeBase(knowledgeId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleSearch = async (knowledgeId: string) => {
    const query = (searchQuery[knowledgeId] ?? "").trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const result = await desktopApi.searchKnowledgeBase(knowledgeId, query);
      setSearchResults((prev) => ({ ...prev, [knowledgeId]: result.evidence }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const localKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "local-files"), [knowledgeBases]);
  const remoteKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "ragflow"), [knowledgeBases]);
  const selectedIds = useMemo(() => new Set(knowledgePreview?.sources ?? []), [knowledgePreview]);

  type KbTab = "all" | "local" | "remote";
  const [activeTab, setActiveTab] = useState<KbTab>("all");
  const tabKBs = useMemo(() => {
    if (activeTab === "local") return localKBs;
    if (activeTab === "remote") return remoteKBs;
    return knowledgeBases;
  }, [activeTab, localKBs, remoteKBs, knowledgeBases]);

  const renderKnowledgeRow = (kb: KnowledgeBaseResource) => (
    <div className="kb-panel-row" key={kb.knowledge_id} data-testid={`kb-panel-row-${kb.knowledge_id}`}>
      <div className="kb-panel-row-header">
        <span className="kb-panel-row-icon">
          {kb.type === "local-files" ? <Database size={14} /> : <Globe2 size={14} />}
        </span>
        <span className="kb-panel-row-name">
          <strong>{kb.display_name}</strong>
          <small>
            {kb.type === "local-files" ? (isZh ? "本地" : "Local") : "RAGFlow"}
            {kb.status ? ` · ${kb.status}` : ""}
            {kb.document_count !== undefined ? ` · ${kb.document_count} ${isZh ? "文档" : "docs"}` : ""}
          </small>
        </span>
        <span className="kb-panel-row-actions">
          <label className="kb-panel-toggle">
            <input
              type="checkbox"
              checked={selectedIds.has(kb.knowledge_id)}
              disabled={busy || kb.status === "credential_required"}
              onChange={(event) => void toggleKnowledgeBase(kb.knowledge_id, event.target.checked)}
            />
            <span className="kb-panel-toggle-label">
              {selectedIds.has(kb.knowledge_id) ? (isZh ? "已选" : "Selected") : (isZh ? "选用" : "Select")}
            </span>
          </label>
        </span>
      </div>
      <div className="kb-panel-row-actions-bar">
        {kb.type === "local-files" && (
          <button
            type="button"
            className="kb-panel-action-btn"
            disabled={busy}
            onClick={() => void handleIndex(kb.knowledge_id)}
            title={isZh ? "建立索引" : "Index"}
          >
            <FileText size={12} />
            {isZh ? "索引" : "Index"}
          </button>
        )}
        <button
          type="button"
          className="kb-panel-action-btn"
          disabled={busy}
          onClick={() => void handleTest(kb.knowledge_id)}
          title={isZh ? "测试连接" : "Test"}
        >
          <RefreshCw size={12} />
          {isZh ? "测试" : "Test"}
        </button>
        <div className="kb-panel-search-inline">
          <input
            className="kb-panel-search-input"
            type="text"
            placeholder={isZh ? "检索..." : "Search..."}
            value={searchQuery[kb.knowledge_id] ?? ""}
            onChange={(event) => setSearchQuery((prev) => ({ ...prev, [kb.knowledge_id]: event.target.value }))}
            onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(kb.knowledge_id); }}
          />
          <button
            type="button"
            className="kb-panel-action-btn"
            disabled={busy || !(searchQuery[kb.knowledge_id] ?? "").trim()}
            onClick={() => void handleSearch(kb.knowledge_id)}
          >
            <Search size={12} />
          </button>
        </div>
        <button
          type="button"
          className="kb-panel-action-btn kb-panel-action-danger"
          disabled={busy || selectedIds.has(kb.knowledge_id)}
          onClick={() => void handleDelete(kb.knowledge_id)}
          title={isZh ? "删除" : "Delete"}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {searchResults[kb.knowledge_id]?.length > 0 && (
        <div className="kb-panel-search-results">
          {searchResults[kb.knowledge_id].slice(0, 3).map((row, index) => (
            <div className="kb-panel-search-result" key={`${row.source}-${index}`}>
              <span className="kb-panel-search-result-score">{row.score.toFixed(3)}</span>
              <span className="kb-panel-search-result-text">
                {row.content ? row.content.slice(0, 120) : row.source}
              </span>
            </div>
          ))}
        </div>
      )}
      {staleInfo[kb.knowledge_id] && (
        <div className="n-stale-notice">
          {isZh ? "⚠ 本地文件已变更，请点击" : "⚠ Files changed, click "}
          <strong>{isZh ? "索引" : "Index"}</strong>
          {isZh ? " 更新" : " to update"}
        </div>
      )}
      {fileListOpen[kb.knowledge_id] && fileList[kb.knowledge_id] && (
        <div className="n-file-list">
          <div className="n-file-list-header">
            <span>{isZh ? "文档" : "File"}</span>
            <span>{isZh ? "大小" : "Size"}</span>
            <span>{isZh ? "状态" : "Status"}</span>
          </div>
          {fileList[kb.knowledge_id].map((file) => (
            <div className="n-file-list-row" key={file.source}>
              <span className="n-file-list-name" title={file.source}>{file.title}</span>
              <span className="n-file-list-size">{file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}</span>
              <span className={"n-file-list-status" + (file.status === "ok" ? "" : " n-file-list-status-fail")}>
                {file.status === "ok" ? (isZh ? "正常" : "OK") : (file.status === "failed" ? (isZh ? "失败" : "Failed") : file.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="kb-panel" data-testid="knowledge-base-panel">
      <div className="kb-panel-header">
        <BookOpen size={16} />
        <h3>{isZh ? "知识库" : "Knowledge Base"}</h3>
        <span className="kb-panel-selected-count">
          {selectedIds.size > 0 ? (isZh ? `${selectedIds.size} 个已启用` : `${selectedIds.size} active`) : (isZh ? "未启用" : "none")}
        </span>
        <button
          type="button"
          className="kb-panel-header-btn"
          onClick={() => void refresh()}
          disabled={busy}
          title={isZh ? "刷新" : "Refresh"}
        >
          <RefreshCw size={14} className={busy ? "kb-spin" : ""} />
        </button>
        <button
          type="button"
          className="kb-panel-header-btn"
          onClick={() => setShowAddForm((prev) => !prev)}
          title={isZh ? "添加知识库" : "Add Knowledge Base"}
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {error && <div className="kb-panel-error" role="alert">{error}</div>}

      {showAddForm && (
        <div className="kb-panel-add-form">
          <input
            className="kb-panel-input"
            placeholder={isZh ? "知识库 ID" : "KB ID"}
            value={draft.id}
            onChange={(event) => setDraft((prev) => ({ ...prev, id: event.target.value }))}
          />
          <input
            className="kb-panel-input"
            placeholder={isZh ? "名称" : "Name"}
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <select
            className="kb-panel-select"
            value={draft.type}
            onChange={(event) => {
              const t = event.target.value as "local-files" | "ragflow";
              setDraft((prev) => ({ ...prev, type: t, location: "", dataset: "", credential: "" }));
                            setDiscoveredDatasets([]);
              setRagflowConnectError(null);
            }}
          >
            <option value="local-files">{isZh ? "本地文档" : "Local files"}</option>
            <option value="ragflow">RAGFlow</option>
          </select>
          {draft.type === "local-files" ? (
            <>
              <div className="kb-panel-path-row">
                <input
                  className="kb-panel-input"
                  placeholder={isZh ? "根目录路径 (如 D:/docs)" : "Root path (e.g. D:/docs)"}
                  value={draft.location}
                  onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
                />
                <button
                  type="button"
                  className="kb-panel-browse-btn"
                  disabled={busy}
                  onClick={async () => {
                    const result = await desktopApi.pickFolder();
                    if (!result.canceled && result.paths.length > 0) {
                      setDraft((prev) => ({ ...prev, location: result.paths[0] }));
                    }
                  }}
                  title={isZh ? "浏览文件夹" : "Browse folder"}
                >
                  {isZh ? "浏览" : "Browse..."}
                </button>
              </div>
              <small className="kb-panel-hint">
                {isZh ? "知识库名称和 ID 将自动从路径生成" : "Name and ID will be auto-generated from the path"}
              </small>
              <button
                type="button"
                className="kb-panel-add-btn"
                disabled={busy || !draft.location}
                onClick={() => void handleAdd()}
              >
                {isZh ? "添加" : "Add"}
              </button>
            </>
          ) : (
            <>
              <div className="kb-panel-ragflow-info">
                <small>
                  {isZh ? "RAGFlow 服务器：" : "RAGFlow server: "}
                  <strong>{RAGFLOW_BASE_URL}</strong>
                </small>
              </div>
              <input
                className="kb-panel-input"
                type="password"
                autoComplete="off"
                placeholder={isZh ? "输入 API Key 发现远端数据集" : "Enter API Key to discover datasets"}
                value={ragflowApiKey}
                onChange={(event) => setRagflowApiKey(event.target.value)}
              />
              <button
                type="button"
                className="kb-panel-add-btn"
                disabled={discovering || !ragflowApiKey.trim()}
                onClick={() => void handleRagflowDiscover()}
              >
                {discovering ? (isZh ? "发现中..." : "Discovering...") : (isZh ? "发现数据集" : "Discover Datasets")}
              </button>
              {ragflowConnectError && <div className="kb-panel-error" role="alert">{ragflowConnectError}</div>}
              {discoveredDatasets.length > 0 && (
                <div className="kb-panel-ragflow-datasets">
                  <p className="kb-panel-ragflow-datasets-title">
                    {isZh ? "请选择要添加的数据集：" : "Select datasets to add:"}
                  </p>
                  {discoveredDatasets.map((ds) => (
                    <label className="kb-panel-ragflow-dataset" key={ds.id}>
                      <input
                        type="checkbox"
                        checked={ds.selected}
                        onChange={() => setDiscoveredDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, selected: !d.selected } : d))}
                      />
                      <span className="kb-panel-ragflow-dataset-name">{ds.name || ds.id}</span>
                      <small className="kb-panel-ragflow-dataset-meta">
                        {ds.document_count} docs · {ds.chunk_count} chunks
                      </small>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="kb-panel-add-btn"
                    disabled={busy || discoveredDatasets.every((ds) => !ds.selected)}
                    onClick={() => void handleRagflowAddSelected()}
                  >
                    {isZh ? "添加选中" : "Add Selected"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="kb-panel-tabs">
        <button
          type="button"
          className={`kb-panel-tab${activeTab === "all" ? " active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          {isZh ? "全部" : "All"}
          <span className="kb-panel-tab-count">{knowledgeBases.length}</span>
        </button>
        <button
          type="button"
          className={`kb-panel-tab${activeTab === "local" ? " active" : ""}`}
          onClick={() => setActiveTab("local")}
        >
          <Database size={12} />
          {isZh ? "本地" : "Local"}
          <span className="kb-panel-tab-count">{localKBs.length}</span>
        </button>
        <button
          type="button"
          className={`kb-panel-tab${activeTab === "remote" ? " active" : ""}`}
          onClick={() => setActiveTab("remote")}
        >
          <Globe2 size={12} />
          {isZh ? "远端" : "Remote"}
          <span className="kb-panel-tab-count">{remoteKBs.length}</span>
        </button>
        {remoteKBs.length > 0 && (
          <button
            type="button"
            className="kb-panel-tab-action"
            disabled={rediscovering}
            onClick={() => void handleRediscoverRagflow()}
            title={isZh ? "从 RAGFlow 重新发现新数据集" : "Re-discover new datasets from RAGFlow"}
          >
            <RefreshCw size={12} className={rediscovering ? "kb-spin" : ""} />
            <span>{rediscovering ? (isZh ? "发现中..." : "Discovering...") : (isZh ? "重新发现" : "Rediscover")}</span>
          </button>
        )}
        {newDatasets.length > 0 && <span className="kb-panel-tab-badge">+{newDatasets.length}</span>}
      </div>

      <div className="kb-panel-section">
        {tabKBs.length === 0 ? (
          <p className="kb-panel-empty">
            {activeTab === "local"
              ? (isZh ? "暂无本地知识库" : "No local knowledge bases")
              : activeTab === "remote"
                ? (isZh ? "暂无远端知识库" : "No remote knowledge bases")
                : (isZh ? "暂无知识库" : "No knowledge bases")}
          </p>
        ) : (
          tabKBs.map(renderKnowledgeRow)
        )}
      </div>

      {newDatasets.length > 0 && (
        <div className="kb-panel-add-form" style={{ marginTop: 0, borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div className="kb-panel-ragflow-datasets">
            <p className="kb-panel-ragflow-datasets-title">
              {isZh
                ? `发现 ${newDatasets.length} 个新数据集（RAGFlow 上新增，尚未注册到桌面端）：`
                : `Found ${newDatasets.length} new dataset(s) on RAGFlow not yet registered:`}
            </p>
            {newDatasets.map((ds) => (
              <label className="kb-panel-ragflow-dataset" key={ds.id}>
                <input
                  type="checkbox"
                  checked={ds.selected}
                  onChange={() => setNewDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, selected: !d.selected } : d))}
                />
                <span className="kb-panel-ragflow-dataset-name">{ds.name || ds.id}</span>
                <small className="kb-panel-ragflow-dataset-meta">
                  {ds.document_count} docs · {ds.chunk_count} chunks
                </small>
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="kb-panel-add-btn"
                disabled={busy || newDatasets.every((ds) => !ds.selected)}
                onClick={() => void handleAddNewDatasets()}
              >
                {isZh ? "添加选中" : "Add Selected"}
              </button>
              <button
                type="button"
                className="kb-panel-action-btn"
                onClick={() => setNewDatasets([])}
              >
                {isZh ? "忽略" : "Dismiss"}
              </button>
            </div>
          </div>
        </div>
      )}

      {knowledgePolicy && (
        <div className="kb-panel-footer">
          <div className="kb-panel-policy-row">
            <span className="kb-panel-policy-label">
              {isZh ? "检索策略" : "Retrieval policy"}
            </span>
            <select
              className="kb-panel-select kb-panel-policy-select"
              value={knowledgePolicy.retrieval_policy}
              disabled={busy}
              onChange={async (event) => {
                setBusy(true);
                try {
                  await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, {
                    ...knowledgePolicy,
                    retrieval_policy: event.target.value as AgentKnowledgePolicy["retrieval_policy"],
                    expected_revision: knowledgePolicy.revision,
                  });
                  await refresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                  setBusy(false);
                }
              }}
            >
              <option value="auto">Auto</option>
              <option value="always">Always</option>
              <option value="never">Never</option>
            </select>
          </div>
          <label className="kb-panel-toggle kb-panel-policy-toggle">
            <input
              type="checkbox"
              checked={knowledgePolicy.require_citations}
              disabled={busy}
              onChange={async (event) => {
                setBusy(true);
                try {
                  await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, {
                    ...knowledgePolicy,
                    require_citations: event.target.checked,
                    expected_revision: knowledgePolicy.revision,
                  });
                  await refresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                  setBusy(false);
                }
              }}
            />
            <span>{isZh ? "要求引用" : "Require citations"}</span>
          </label>
        </div>
      )}
    </section>
  );
}