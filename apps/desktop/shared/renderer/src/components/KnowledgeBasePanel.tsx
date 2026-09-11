import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Database,
  FileText,
  FolderOpen,
  Globe2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { desktopApi } from "../desktopApi";
import type {
  KnowledgeBaseResource,
  AgentKnowledgePolicy,
  AgentKnowledgePreview,
  WorkspaceFilePreview,
} from "@shared/desktopApi";
import { FilePreviewer } from "./files/file_previewer/FilePreviewer";

interface KnowledgeBasePanelProps {
  agentId: string;
  language: "zh" | "en";
}

type KbTab = "all" | "local" | "remote";
type DetailPane = "search" | "files";

function statusLabel(status: string | undefined, isZh: boolean): string {
  if (!status) return isZh ? "未知" : "Unknown";
  const map: Record<string, [string, string]> = {
    not_indexed: ["未索引", "Not indexed"],
    indexing: ["索引中", "Indexing"],
    ready: ["就绪", "Ready"],
    stale: ["已过期", "Stale"],
    failed: ["失败", "Failed"],
    credential_required: ["需凭证", "Credential required"],
    configured: ["已配置", "Configured"],
    disabled: ["已禁用", "Disabled"],
  };
  const pair = map[status];
  return pair ? pair[isZh ? 0 : 1] : status;
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
  /** knowledge_id → last completed search query (used to show empty-state vs never-searched) */
  const [lastSearchQuery, setLastSearchQuery] = useState<Record<string, string>>({});
  const [fileList, setFileList] = useState<Record<string, Array<{ source: string; title: string; status: string }>>>({});
  const [fileListOpen, setFileListOpen] = useState<Record<string, boolean>>({});
  const [staleChecking, setStaleChecking] = useState<Record<string, boolean>>({});
  const [actionToast, setActionToast] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  const actionToastTimerRef = useRef<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({
    type: "local-files" as "local-files" | "ragflow",
    location: "",
  });
  const RAGFLOW_BASE_URL = "https://ragflow.ihep.ac.cn";
  const [ragflowApiKey, setRagflowApiKey] = useState("");
  const [discoveredDatasets, setDiscoveredDatasets] = useState<Array<{ id: string; name: string; chunk_count: number; document_count: number; status: string; selected: boolean }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [ragflowConnectError, setRagflowConnectError] = useState<string | null>(null);
  const [rediscovering, setRediscovering] = useState(false);
  const [newDatasets, setNewDatasets] = useState<Array<{ id: string; name: string; chunk_count: number; document_count: number; status: string; selected: boolean }>>([]);
  const [activeKnowledgeId, setActiveKnowledgeId] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<WorkspaceFilePreview | null>(null);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [previewingFileKey, setPreviewingFileKey] = useState<string | null>(null);
  const [fileListFailed, setFileListFailed] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<KbTab>("all");
  const [detailPane, setDetailPane] = useState<DetailPane>("search");
  const [expandedSearchResults, setExpandedSearchResults] = useState<Record<string, boolean>>({});
  /** Full-height overlay on top of default B (narrow list) preview mode */
  const [previewOverlay, setPreviewOverlay] = useState(false);
  const [policyMenuOpen, setPolicyMenuOpen] = useState(false);
  const policyMenuRef = useRef<HTMLDivElement | null>(null);

  const isZh = language === "zh";
  const hasFilePreview = Boolean(filePreview || filePreviewLoading || filePreviewError);

  const clearFilePreview = useCallback(() => {
    setFilePreview(null);
    setFilePreviewError(null);
    setPreviewingFileKey(null);
    setPreviewOverlay(false);
  }, []);

  const clearKnowledgeLocalState = useCallback((knowledgeId: string) => {
    const dropKey = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(knowledgeId in prev)) return prev;
      const next = { ...prev };
      delete next[knowledgeId];
      return next;
    };
    setSearchQuery(dropKey);
    setSearchResults(dropKey);
    setLastSearchQuery(dropKey);
    setFileList(dropKey);
    setFileListOpen(dropKey);
    setFileListFailed(dropKey);
    setStaleChecking(dropKey);
    setExpandedSearchResults((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (key === knowledgeId || key.startsWith(`${knowledgeId}:`)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const showActionToast = useCallback((type: "success" | "warning" | "error", message: string) => {
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
    setActionToast({ type, message });
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      actionToastTimerRef.current = null;
    }, 3200);
  }, []);

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
      setActiveKnowledgeId((current) => {
        if (current && bases.some((item) => item.knowledge_id === current)) return current;
        return bases[0]?.knowledge_id ?? null;
      });
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

  const handleManualRefresh = async () => {
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
      setActiveKnowledgeId((current) => {
        if (current && bases.some((item) => item.knowledge_id === current)) return current;
        return bases[0]?.knowledge_id ?? null;
      });
      showActionToast("success", isZh ? "已刷新" : "Refreshed");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      showActionToast("error", isZh ? `刷新失败：${message}` : `Refresh failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    retryCountRef.current = 0;
    void refresh();
    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      if (actionToastTimerRef.current !== null) window.clearTimeout(actionToastTimerRef.current);
    };
  }, [refresh]);

  const toggleKnowledgeBase = async (knowledgeId: string, checked: boolean) => {
    if (!knowledgePolicy || !knowledgePreview) return;
    setBusy(true);
    setError(null);
    try {
      if (checked) {
        const kb = knowledgeBases.find((b) => b.knowledge_id === knowledgeId);
        if (kb && kb.type === "local-files" && kb.status === "not_indexed") {
          try { await desktopApi.indexKnowledgeBase(knowledgeId); } catch { /* best-effort */ }
        }
      }
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
      await desktopApi.createKnowledgeBase({
        knowledge_id: knowledgeId,
        display_name: folderName,
        type: "local-files",
        enabled: true,
        config: { root_path: draft.location, paths: ["."], chunk_size: 800, chunk_overlap: 120 },
      });
      try {
        await desktopApi.indexKnowledgeBase(knowledgeId);
      } catch (cause) {
        const indexErr = cause instanceof Error ? cause.message : String(cause);
        setError(`${isZh ? "索引失败" : "Index failed"}: ${indexErr}`);
      }
      setDraft({ type: "local-files", location: "" });
      setShowAddForm(false);
      setActiveKnowledgeId(knowledgeId);
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
      const datasets = result.datasets.map((ds) => ({ ...ds, selected: false }));
      setDiscoveredDatasets(datasets);
      if (datasets.length === 0) {
        showActionToast(
          "success",
          isZh
            ? "已连接 RAGFlow，但该账号下暂无数据集。请先在 RAGFlow 网页创建知识库并上传文档。"
            : "Connected to RAGFlow, but this account has no datasets. Create one in the RAGFlow web UI first.",
        );
      } else {
        showActionToast(
          "success",
          isZh ? `发现 ${datasets.length} 个数据集` : `Found ${datasets.length} dataset(s)`,
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRagflowConnectError(message);
      showActionToast("error", isZh ? `发现失败：${message}` : `Discover failed: ${message}`);
    } finally {
      setDiscovering(false);
    }
  };

  const handleRagflowAddSelected = async (
    datasets?: Array<{ id: string; name: string; chunk_count: number; document_count: number; status: string; selected: boolean }>,
  ) => {
    const selected = (datasets ?? discoveredDatasets).filter((ds) => ds.selected);
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let lastId: string | null = null;
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
        lastId = kbId;
      }
      setDiscoveredDatasets([]);
      setNewDatasets([]);
      setShowAddForm(false);
      if (lastId) setActiveKnowledgeId(lastId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const handleRediscoverRagflow = async () => {
    setRediscovering(true);
    setRagflowConnectError(null);
    try {
      const result = await desktopApi.rediscoverRagflowDatasets();
      const existingIds = new Set(knowledgeBases.filter((kb) => kb.type === "ragflow").map((kb) => {
        const dsId = (kb.config?.dataset_ids as string[] | undefined)?.[0] ?? "";
        return dsId;
      }));
      const fresh = result.datasets
        .filter((ds) => !existingIds.has(ds.id))
        .map((ds) => ({ ...ds, selected: false }));
      setNewDatasets(fresh);
      if (fresh.length > 0) {
        showActionToast(
          "success",
          isZh
            ? `重新发现完成，找到 ${fresh.length} 个新数据集`
            : `Rediscover complete: found ${fresh.length} new dataset(s)`,
        );
      } else {
        showActionToast(
          "success",
          isZh ? "重新发现完成，没有新的数据集" : "Rediscover complete: no new datasets",
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRagflowConnectError(message);
      showActionToast("error", isZh ? `重新发现失败：${message}` : `Rediscover failed: ${message}`);
    } finally {
      setRediscovering(false);
    }
  };

  const handleAddNewDatasets = async () => {
    const selected = newDatasets.filter((ds) => ds.selected).map((ds) => ({ ...ds, selected: true }));
    if (selected.length === 0) return;
    await handleRagflowAddSelected(selected);
  };

  const handleDelete = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await desktopApi.deleteKnowledgeBase(knowledgeId);
      clearKnowledgeLocalState(knowledgeId);
      if (activeKnowledgeId === knowledgeId) {
        setActiveKnowledgeId(null);
        clearFilePreview();
      }
      await refresh();
      showActionToast("success", isZh ? "知识库已删除" : "Knowledge base deleted");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      showActionToast("error", isZh ? `删除失败：${message}` : `Delete failed: ${message}`);
      setBusy(false);
    }
  };

  const handleIndex = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      const indexed = await desktopApi.indexKnowledgeBase(knowledgeId);
      await refresh();
      // Index writes the corpus DB; reload the file list so the UI matches
      // without requiring a separate "Refresh files" click.
      let fileCount = indexed.document_count;
      try {
        const result = await desktopApi.listKnowledgeBaseFiles(knowledgeId);
        setFileList((prev) => ({ ...prev, [knowledgeId]: result.data }));
        setFileListOpen((prev) => ({ ...prev, [knowledgeId]: true }));
        setFileListFailed((prev) => ({ ...prev, [knowledgeId]: false }));
        fileCount = result.data.length;
      } catch {
        // Index succeeded; file list refresh is best-effort.
      }
      showActionToast(
        "success",
        isZh
          ? `重新索引完成，共 ${fileCount} 个文件`
          : `Re-index complete: ${fileCount} file(s)`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      showActionToast("error", isZh ? `重新索引失败：${message}` : `Re-index failed: ${message}`);
      setBusy(false);
    }
  };

  const handleListFiles = async (knowledgeId: string, forceReload = false) => {
    const isOpen = fileListOpen[knowledgeId];
    if (isOpen && !forceReload) {
      setFileListOpen((prev) => ({ ...prev, [knowledgeId]: false }));
      return;
    }
    setBusy(true);
    setError(null);
    setFileListFailed((prev) => ({ ...prev, [knowledgeId]: false }));
    try {
      const result = await desktopApi.listKnowledgeBaseFiles(knowledgeId);
      setFileList((prev) => ({ ...prev, [knowledgeId]: result.data }));
      setFileListOpen((prev) => ({ ...prev, [knowledgeId]: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setFileListFailed((prev) => ({ ...prev, [knowledgeId]: true }));
      setFileListOpen((prev) => ({ ...prev, [knowledgeId]: false }));
    } finally {
      setBusy(false);
    }
  };

  const handleStaleCheck = async (knowledgeId: string) => {
    setStaleChecking((prev) => ({ ...prev, [knowledgeId]: true }));
    setError(null);
    try {
      const result = await desktopApi.checkKnowledgeBaseStale(knowledgeId);
      const added = result.added?.length ?? 0;
      const changed = result.changed?.length ?? 0;
      const removed = result.removed?.length ?? 0;
      if (result.stale) {
        showActionToast(
          "warning",
          isZh
            ? `索引已过期：新增 ${added}，变更 ${changed}，删除 ${removed}。请重新索引。`
            : `Index is stale: ${added} added, ${changed} changed, ${removed} removed. Please re-index.`,
        );
      } else {
        showActionToast(
          "success",
          isZh ? "索引与本地文件一致，无需重新索引。" : "Index matches local files. No re-index needed.",
        );
      }
    } catch (cause) {
      showActionToast("error", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStaleChecking((prev) => ({ ...prev, [knowledgeId]: false }));
    }
  };

  const handleTest = async (knowledgeId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await desktopApi.testKnowledgeBase(knowledgeId);
      await refresh();
      const statusText = result.status ? `（${statusLabel(result.status, isZh)}）` : "";
      showActionToast(
        "success",
        isZh
          ? `测试通过${statusText}`
          : `Test passed${result.status ? ` (${statusLabel(result.status, isZh)})` : ""}`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      showActionToast("error", isZh ? `测试失败：${message}` : `Test failed: ${message}`);
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
      const evidence = Array.isArray(result.evidence) ? result.evidence : [];
      setSearchResults((prev) => ({ ...prev, [knowledgeId]: evidence }));
      setLastSearchQuery((prev) => ({ ...prev, [knowledgeId]: query }));
      setExpandedSearchResults((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${knowledgeId}:`)) delete next[key];
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const openKnowledgeFilePreview = async (
    kb: KnowledgeBaseResource,
    file: { source: string; title: string },
  ): Promise<void> => {
    const rootPath = typeof kb.config?.root_path === "string" ? kb.config.root_path.trim() : "";
    if (!rootPath) {
      setFilePreview(null);
      setFilePreviewError(isZh ? "该知识库没有本地根目录，无法预览文件。" : "This knowledge base has no local root path for preview.");
      return;
    }
    const relativePath = file.source.replace(/^[\\/]+/, "");
    const previewKey = `${kb.knowledge_id}:${relativePath}`;
    setPreviewingFileKey(previewKey);
    setFilePreviewLoading(true);
    setFilePreviewError(null);
    try {
      const preview = await desktopApi.previewWorkspaceFile({
        workspacePath: rootPath,
        path: relativePath,
        maxBytes: 220_000,
      });
      setFilePreview(preview);
    } catch (cause) {
      setFilePreview(null);
      setFilePreviewError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFilePreviewLoading(false);
    }
  };

  const localKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "local-files"), [knowledgeBases]);
  const remoteKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "ragflow"), [knowledgeBases]);
  const selectedIds = useMemo(() => new Set(knowledgePreview?.sources ?? []), [knowledgePreview]);
  const tabKBs = useMemo(() => {
    if (activeTab === "local") return localKBs;
    if (activeTab === "remote") return remoteKBs;
    return knowledgeBases;
  }, [activeTab, localKBs, remoteKBs, knowledgeBases]);

  const activeKb = useMemo(
    () => tabKBs.find((kb) => kb.knowledge_id === activeKnowledgeId) ?? knowledgeBases.find((kb) => kb.knowledge_id === activeKnowledgeId) ?? null,
    [activeKnowledgeId, knowledgeBases, tabKBs],
  );

  useEffect(() => {
    setDetailPane("search");
    clearFilePreview();
  }, [activeKb?.knowledge_id, clearFilePreview]);

  useEffect(() => {
    if (!activeKb) return;
    if (activeKb.type !== "local-files") return;
    if (fileListOpen[activeKb.knowledge_id]) return;
    void handleListFiles(activeKb.knowledge_id);
    // intentionally only when switching active local KB
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKb?.knowledge_id]);

  useEffect(() => {
    if (!policyMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!policyMenuRef.current?.contains(event.target as Node)) {
        setPolicyMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPolicyMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [policyMenuOpen]);

  const updateRetrievalPolicy = async (value: AgentKnowledgePolicy["retrieval_policy"]) => {
    if (!knowledgePolicy) return;
    setPolicyMenuOpen(false);
    if (knowledgePolicy.retrieval_policy === value) return;
    setBusy(true);
    setError(null);
    try {
      await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, {
        ...knowledgePolicy,
        retrieval_policy: value,
        expected_revision: knowledgePolicy.revision,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const rootPath = typeof activeKb?.config?.root_path === "string" ? activeKb.config.root_path : "";
  const effectiveDetailPane: DetailPane =
    activeKb && activeKb.type === "local-files" ? detailPane : "search";

  return (
    <section
      className="kb-panel kb-panel-page skills-manager skills-manager-page"
      data-testid="knowledge-base-panel"
    >
      {actionToast ? (
        <div
          className={`skills-action-toast skills-action-toast-${actionToast.type}`}
          role="status"
          aria-live="polite"
        >
          {actionToast.message}
        </div>
      ) : null}
      <div className="skills-page-top">
        <header className="skills-header">
          <span className="skills-header-mark" aria-hidden>
            <BookOpen size={16} />
          </span>
          <div className="skills-header-text">
            <h2 className="skills-title">{isZh ? "知识库" : "Knowledge Base"}</h2>
            <p className="skills-relation-hint">
              {selectedIds.size > 0
                ? (isZh
                  ? `当前智能体已启用 ${selectedIds.size} 个知识库。打开后先检索验证内容，本地库也可浏览文件。`
                  : `${selectedIds.size} knowledge base(s) enabled. Search first to verify content; local bases also support file browsing.`)
                : (isZh
                  ? "绑定本地文件夹或 RAGFlow 数据集，供当前智能体检索引用。"
                  : "Bind a local folder or RAGFlow dataset for retrieval and citations.")}
            </p>
          </div>
        </header>

        <div className="skills-online-stats" aria-label={isZh ? "统计" : "Stats"}>
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "全部" : "Total"}</div>
            <div className="skills-online-stat-value">{knowledgeBases.length}</div>
          </div>
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "本地" : "Local"}</div>
            <div className="skills-online-stat-value">{localKBs.length}</div>
          </div>
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "远端" : "Remote"}</div>
            <div className="skills-online-stat-value">{remoteKBs.length}</div>
          </div>
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "已启用" : "Enabled"}</div>
            <div className="skills-online-stat-value">{selectedIds.size}</div>
          </div>
        </div>
      </div>

      <div className="skills-page-content skills-local kb-page-content">
        {error ? <div className="kb-panel-error" role="alert">{error}</div> : null}
        {ragflowConnectError ? <div className="kb-panel-error" role="alert">{ragflowConnectError}</div> : null}

        <div className="skills-online-filters">
          <div className="skills-online-filter-bar">
            <div className="skills-online-cat-tabs" role="tablist" aria-label={isZh ? "知识库筛选" : "Knowledge filters"}>
              <button type="button" role="tab" aria-selected={activeTab === "all"} className={`skills-online-cat-tab${activeTab === "all" ? " active" : ""}`} onClick={() => setActiveTab("all")}>
                {isZh ? "全部" : "All"}
              </button>
              <button type="button" role="tab" aria-selected={activeTab === "local"} className={`skills-online-cat-tab${activeTab === "local" ? " active" : ""}`} onClick={() => setActiveTab("local")}>
                {isZh ? "本地" : "Local"}
              </button>
              <button type="button" role="tab" aria-selected={activeTab === "remote"} className={`skills-online-cat-tab${activeTab === "remote" ? " active" : ""}`} onClick={() => setActiveTab("remote")}>
                {isZh ? "远端" : "Remote"}
              </button>
            </div>
            <div className="skills-online-filter-actions">
              {remoteKBs.length > 0 ? (
                <button
                  type="button"
                  className="skills-btn ghost"
                  disabled={rediscovering}
                  onClick={() => void handleRediscoverRagflow()}
                  title={isZh ? "重新发现 RAGFlow 数据集" : "Rediscover RAGFlow datasets"}
                >
                  <RefreshCw size={13} className={rediscovering ? "kb-spin" : ""} />
                  {rediscovering ? (isZh ? "发现中" : "Discovering") : (isZh ? "重新发现" : "Rediscover")}
                  {newDatasets.length > 0 ? <span className="kb-filter-badge">+{newDatasets.length}</span> : null}
                </button>
              ) : null}
              <button
                type="button"
                className="skills-online-icon-btn"
                onClick={() => void handleManualRefresh()}
                disabled={busy}
                title={isZh ? "刷新" : "Refresh"}
                aria-label={isZh ? "刷新" : "Refresh"}
              >
                <RefreshCw size={15} className={busy ? "kb-spin" : ""} />
              </button>
              <button
                type="button"
                className="skills-btn primary"
                onClick={() => setShowAddForm((prev) => !prev)}
              >
                {showAddForm ? <X size={14} /> : <Plus size={14} />}
                {showAddForm ? (isZh ? "取消" : "Cancel") : (isZh ? "添加" : "Add")}
              </button>
            </div>
          </div>
        </div>

        {showAddForm ? (
          <div className="kb-add-card">
            <div className="skills-online-cat-tabs" role="group" aria-label={isZh ? "添加类型" : "Add type"}>
              <button
                type="button"
                className={`skills-online-cat-tab${draft.type === "local-files" ? " active" : ""}`}
                onClick={() => {
                  setDraft({ type: "local-files", location: "" });
                  setDiscoveredDatasets([]);
                  setRagflowConnectError(null);
                }}
              >
                <FolderOpen size={14} />
                {isZh ? "本地文档" : "Local files"}
              </button>
              <button
                type="button"
                className={`skills-online-cat-tab${draft.type === "ragflow" ? " active" : ""}`}
                onClick={() => {
                  setDraft({ type: "ragflow", location: "" });
                  setDiscoveredDatasets([]);
                  setRagflowConnectError(null);
                }}
              >
                <Globe2 size={14} />
                RAGFlow
              </button>
            </div>

            {draft.type === "local-files" ? (
              <>
                <div className="kb-panel-path-row">
                  <input
                    className="kb-panel-input"
                    placeholder={isZh ? "根目录路径（如 D:/docs）" : "Root path (e.g. D:/docs)"}
                    value={draft.location}
                    onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="skills-btn ghost"
                    disabled={busy}
                    onClick={async () => {
                      const result = await desktopApi.pickFolder();
                      if (!result.canceled && result.paths.length > 0) {
                        setDraft((prev) => ({ ...prev, location: result.paths[0] }));
                      }
                    }}
                  >
                    {isZh ? "浏览" : "Browse"}
                  </button>
                </div>
                <small className="kb-panel-hint">
                  {isZh ? "名称与 ID 会根据文件夹自动生成，添加后会尝试建立索引。" : "Name and ID are derived from the folder. Indexing starts after add."}
                </small>
                <div className="kb-panel-inline-actions">
                  <button type="button" className="skills-btn primary" disabled={busy || !draft.location} onClick={() => void handleAdd()}>
                    {isZh ? "添加本地知识库" : "Add local knowledge base"}
                  </button>
                </div>
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
                <div className="kb-panel-inline-actions">
                  <button
                    type="button"
                    className="skills-btn primary"
                    disabled={discovering || !ragflowApiKey.trim()}
                    onClick={() => void handleRagflowDiscover()}
                  >
                    {discovering ? (isZh ? "发现中…" : "Discovering…") : (isZh ? "发现数据集" : "Discover datasets")}
                  </button>
                </div>
                {discoveredDatasets.length > 0 ? (
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
                    <div className="kb-panel-inline-actions">
                      <button
                        type="button"
                        className="skills-btn primary"
                        disabled={busy || discoveredDatasets.every((ds) => !ds.selected)}
                        onClick={() => void handleRagflowAddSelected()}
                      >
                        {isZh ? "添加选中" : "Add selected"}
                      </button>
                    </div>
                  </div>
                ) : discovering ? null : (
                  <p className="kb-panel-hint" role="status">
                    {isZh
                      ? "连接成功后会在此列出可添加的数据集。若提示暂无数据集，请先到 RAGFlow 网页创建知识库。"
                      : "Discovered datasets will appear here. If none are found, create a knowledge base in the RAGFlow web UI first."}
                  </p>
                )}
              </>
            )}
          </div>
        ) : null}

        {newDatasets.length > 0 ? (
          <div className="kb-add-card">
            <p className="kb-panel-ragflow-datasets-title">
              {isZh
                ? `发现 ${newDatasets.length} 个新数据集（尚未注册到桌面端）：`
                : `Found ${newDatasets.length} new dataset(s) not yet registered:`}
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
            <div className="kb-panel-inline-actions">
              <button
                type="button"
                className="skills-btn primary"
                disabled={busy || newDatasets.every((ds) => !ds.selected)}
                onClick={() => void handleAddNewDatasets()}
              >
                {isZh ? "添加选中" : "Add selected"}
              </button>
              <button type="button" className="skills-btn ghost" onClick={() => setNewDatasets([])}>
                {isZh ? "忽略" : "Dismiss"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="kb-panel-workspace">
          <aside className="kb-panel-list" aria-label={isZh ? "知识库列表" : "Knowledge base list"}>
            {tabKBs.length === 0 ? (
              <div className="skills-empty-state skills-online-empty">
                <div className="skills-online-empty-icon">
                  <BookOpen size={28} />
                </div>
                <p className="skills-online-empty-title">
                  {activeTab === "local"
                    ? (isZh ? "暂无本地知识库" : "No local knowledge bases")
                    : activeTab === "remote"
                      ? (isZh ? "暂无远端知识库" : "No remote knowledge bases")
                      : (isZh ? "还没有知识库" : "No knowledge bases yet")}
                </p>
                <p className="skills-online-empty-desc">
                  {isZh ? "点击「添加」创建本地库或连接 RAGFlow。" : "Use Add to create a local library or connect RAGFlow."}
                </p>
                <button type="button" className="skills-btn primary" onClick={() => setShowAddForm(true)}>
                  <Plus size={14} />
                  {isZh ? "添加知识库" : "Add knowledge base"}
                </button>
              </div>
            ) : (
              tabKBs.map((kb) => {
                const active = kb.knowledge_id === activeKnowledgeId;
                const enabled = selectedIds.has(kb.knowledge_id);
                return (
                  <button
                    type="button"
                    key={kb.knowledge_id}
                    className={`kb-panel-list-item${active ? " active" : ""}${enabled ? " enabled" : ""}`}
                    data-testid={`kb-panel-row-${kb.knowledge_id}`}
                    onClick={() => {
                      setActiveKnowledgeId(kb.knowledge_id);
                      setDetailPane("search");
                      clearFilePreview();
                    }}
                  >
                    <span className="kb-panel-list-icon" aria-hidden>
                      {kb.type === "local-files" ? <Database size={15} /> : <Globe2 size={15} />}
                    </span>
                    <span className="kb-panel-list-copy">
                      <strong>{kb.display_name}</strong>
                      <span className="kb-panel-list-meta">
                        <span className="skills-online-tag-pill">
                          {kb.type === "local-files" ? (isZh ? "本地" : "Local") : "RAGFlow"}
                        </span>
                        {kb.document_count !== undefined ? (
                          <span className="kb-panel-list-meta-text">
                            {kb.document_count} {isZh ? "文档" : "docs"}
                          </span>
                        ) : null}
                        <span className={`kb-panel-status-pill status-${kb.status || "unknown"}`}>
                          {statusLabel(kb.status, isZh)}
                        </span>
                      </span>
                    </span>
                    <label
                      className="kb-panel-toggle"
                      title={enabled ? (isZh ? "已启用" : "Enabled") : (isZh ? "启用" : "Enable")}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={busy || kb.status === "credential_required"}
                        onChange={(event) => void toggleKnowledgeBase(kb.knowledge_id, event.target.checked)}
                        aria-label={enabled ? (isZh ? "已启用" : "Enabled") : (isZh ? "启用" : "Enable")}
                      />
                    </label>
                  </button>
                );
              })
            )}
          </aside>

          <div
            className={[
              "kb-panel-detail",
              activeKb && activeKb.type !== "local-files" ? "is-remote" : "",
              effectiveDetailPane === "search" ? "is-search-pane" : "is-files-pane",
              hasFilePreview ? "has-file-preview" : "",
              previewOverlay && hasFilePreview ? "preview-overlay" : "",
            ].filter(Boolean).join(" ")}
            aria-label={isZh ? "知识库详情" : "Knowledge base detail"}
          >
            {!activeKb ? (
              <div className="skills-empty-state skills-online-empty">
                <div className="skills-online-empty-icon">
                  <BookOpen size={28} />
                </div>
                <p className="skills-online-empty-title">{isZh ? "选择一个知识库" : "Select a knowledge base"}</p>
                <p className="skills-online-empty-desc">
                  {isZh ? "从左侧打开知识库，在详情中检索内容。" : "Open a knowledge base on the left, then search its contents."}
                </p>
              </div>
            ) : (
              <>
                <div className="kb-panel-detail-header">
                  <div className="kb-panel-detail-title">
                    <span className="kb-panel-list-icon" aria-hidden>
                      {activeKb.type === "local-files" ? <Database size={16} /> : <Globe2 size={16} />}
                    </span>
                    <div>
                      <div className="kb-panel-detail-title-row">
                        <h4>{activeKb.display_name}</h4>
                        <span className={`kb-panel-status-pill status-${activeKb.status || "unknown"}`}>
                          {statusLabel(activeKb.status, isZh)}
                        </span>
                      </div>
                      <p>
                        {activeKb.type === "local-files" ? (isZh ? "本地文档库" : "Local files") : "RAGFlow"}
                        {rootPath ? ` · ${rootPath}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="kb-panel-detail-toolbar">
                    {activeKb.type === "local-files" ? (
                      <>
                        <button
                          type="button"
                          className="skills-btn ghost"
                          disabled={busy}
                          onClick={() => void handleIndex(activeKb.knowledge_id)}
                          title={isZh ? "扫描本地目录并更新文件列表" : "Scan the local folder and update the file list"}
                        >
                          <FileText size={13} />
                          {isZh ? "重新索引" : "Re-index"}
                        </button>
                        <button
                          type="button"
                          className="skills-btn ghost"
                          disabled={busy || staleChecking[activeKb.knowledge_id]}
                          onClick={() => void handleStaleCheck(activeKb.knowledge_id)}
                        >
                          <TriangleAlert size={13} />
                          {staleChecking[activeKb.knowledge_id] ? (isZh ? "检查中" : "Checking") : (isZh ? "过期检查" : "Stale check")}
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="skills-btn ghost" disabled={busy} onClick={() => void handleTest(activeKb.knowledge_id)}>
                      <RefreshCw size={13} />
                      {isZh ? "测试" : "Test"}
                    </button>
                    <button
                      type="button"
                      className="skills-btn ghost danger"
                      disabled={busy || selectedIds.has(activeKb.knowledge_id)}
                      onClick={() => void handleDelete(activeKb.knowledge_id)}
                      title={selectedIds.has(activeKb.knowledge_id)
                        ? (isZh ? "请先取消启用再删除" : "Disable before deleting")
                        : (isZh ? "删除" : "Delete")}
                    >
                      <Trash2 size={13} />
                      {isZh ? "删除" : "Delete"}
                    </button>
                  </div>
                </div>

                {activeKb.type === "local-files" ? (
                  <div className="kb-detail-tabs" role="tablist" aria-label={isZh ? "详情分区" : "Detail panes"}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailPane === "search"}
                      className={`kb-detail-tab${detailPane === "search" ? " active" : ""}`}
                      onClick={() => setDetailPane("search")}
                    >
                      {isZh ? "检索" : "Search"}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailPane === "files"}
                      className={`kb-detail-tab${detailPane === "files" ? " active" : ""}`}
                      onClick={() => setDetailPane("files")}
                    >
                      {isZh ? "文件" : "Files"}
                    </button>
                  </div>
                ) : null}

                {effectiveDetailPane === "search" ? (
                  <div className="kb-panel-search-pane">
                    <div className="kb-panel-search-bar">
                      <Search size={15} className="kb-panel-search-icon" aria-hidden />
                      <input
                        className="kb-panel-search-input"
                        type="search"
                        placeholder={isZh ? "在此知识库中检索…" : "Search this knowledge base…"}
                        value={searchQuery[activeKb.knowledge_id] ?? ""}
                        onChange={(event) => setSearchQuery((prev) => ({ ...prev, [activeKb.knowledge_id]: event.target.value }))}
                        onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(activeKb.knowledge_id); }}
                      />
                      <button
                        type="button"
                        className="skills-btn primary kb-panel-search-submit"
                        disabled={busy || !(searchQuery[activeKb.knowledge_id] ?? "").trim()}
                        onClick={() => void handleSearch(activeKb.knowledge_id)}
                      >
                        {isZh ? "检索" : "Search"}
                      </button>
                    </div>

                    {lastSearchQuery[activeKb.knowledge_id] !== undefined ? (
                      (searchResults[activeKb.knowledge_id]?.length ?? 0) > 0 ? (
                        <div className="kb-panel-search-results" role="list" aria-label={isZh ? "检索结果" : "Search results"}>
                          {searchResults[activeKb.knowledge_id].slice(0, 20).map((row, index) => {
                            const resultKey = `${activeKb.knowledge_id}:${index}`;
                            const fullText = (row.content || row.source || "").trim();
                            const longResult = fullText.length > 40;
                            const expanded = expandedSearchResults[resultKey] === true;
                            return (
                              <div className="kb-panel-search-result" role="listitem" key={resultKey}>
                                <span className="kb-panel-search-result-score">{row.score.toFixed(3)}</span>
                                <div className="kb-panel-search-result-body">
                                  <p className={`kb-panel-search-result-text${expanded ? " is-expanded" : ""}`}>
                                    {fullText || row.source}
                                  </p>
                                  {row.source ? (
                                    <small className="kb-panel-search-result-source" title={row.source}>
                                      {row.source}
                                    </small>
                                  ) : null}
                                  {longResult ? (
                                    <button
                                      type="button"
                                      className="kb-panel-search-result-toggle"
                                      onClick={() => setExpandedSearchResults((prev) => ({
                                        ...prev,
                                        [resultKey]: !prev[resultKey],
                                      }))}
                                    >
                                      {expanded
                                        ? (isZh ? "收起" : "Show less")
                                        : (isZh ? "展开全文" : "Show more")}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="kb-panel-empty kb-panel-search-empty" role="status">
                          {isZh
                            ? `未检索到与「${lastSearchQuery[activeKb.knowledge_id]}」相关的内容。`
                            : `No results found for “${lastSearchQuery[activeKb.knowledge_id]}”.`}
                        </p>
                      )
                    ) : (
                      <div className="kb-panel-search-idle" role="status">
                        <p>{isZh ? "输入关键词后按回车或点「检索」" : "Type a keyword, then press Enter or Search"}</p>
                        <small>
                          {isZh
                            ? "结果会按相关度列出，便于核对智能体可引用的片段。"
                            : "Matches appear by relevance so you can verify citable snippets."}
                        </small>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="kb-panel-detail-split">
                    <div className="kb-panel-files-pane">
                      <div className="kb-panel-files-title">
                        <strong>{isZh ? "文件" : "Files"}</strong>
                        <small>
                          {fileList[activeKb.knowledge_id]?.length
                            ? `${fileList[activeKb.knowledge_id].length}`
                            : (isZh ? "尚未加载" : "Not loaded")}
                        </small>
                      </div>
                      {fileListOpen[activeKb.knowledge_id] && fileList[activeKb.knowledge_id] ? (
                        fileList[activeKb.knowledge_id].length === 0 ? (
                          <p className="kb-panel-empty">{isZh ? "暂无文件" : "No files"}</p>
                        ) : (
                          <div className="n-file-list">
                            <div className="n-file-list-header">
                              <span>{isZh ? "文档" : "File"}</span>
                              <span>{isZh ? "状态" : "Status"}</span>
                            </div>
                            {fileList[activeKb.knowledge_id].map((file) => {
                              const previewKey = `${activeKb.knowledge_id}:${file.source.replace(/^[\\/]+/, "")}`;
                              const active = previewingFileKey === previewKey;
                              return (
                                <button
                                  type="button"
                                  className={`n-file-list-row${active ? " active" : ""}`}
                                  key={file.source}
                                  onClick={() => void openKnowledgeFilePreview(activeKb, file)}
                                  title={isZh ? `预览 ${file.title}` : `Preview ${file.title}`}
                                >
                                  <span className="n-file-list-name" title={file.source}>{file.title}</span>
                                  <span className={"n-file-list-status" + (file.status === "ok" ? "" : " n-file-list-status-fail")}>
                                    {file.status === "ok" ? (isZh ? "正常" : "OK") : (file.status === "failed" ? (isZh ? "失败" : "Failed") : file.status)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        <p className="kb-panel-empty">{isZh ? "正在加载文件列表…" : "Loading files…"}</p>
                      )}
                    </div>

                    <div className="kb-panel-preview" data-testid="kb-panel-preview">
                      <div className="kb-panel-preview-header">
                        <strong>{isZh ? "文件预览" : "File preview"}</strong>
                        <div className="kb-panel-preview-actions">
                          {hasFilePreview ? (
                            previewOverlay ? (
                              <button
                                type="button"
                                className="skills-icon-btn"
                                onClick={() => setPreviewOverlay(false)}
                                title={isZh ? "退出全高预览" : "Exit full preview"}
                                aria-label={isZh ? "退出全高预览" : "Exit full preview"}
                              >
                                <Minimize2 size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="skills-icon-btn"
                                onClick={() => setPreviewOverlay(true)}
                                title={isZh ? "全高预览" : "Full-height preview"}
                                aria-label={isZh ? "全高预览" : "Full-height preview"}
                              >
                                <Maximize2 size={14} />
                              </button>
                            )
                          ) : null}
                          {(filePreview || filePreviewError) ? (
                            <button
                              type="button"
                              className="skills-icon-btn"
                              onClick={clearFilePreview}
                              aria-label={isZh ? "关闭预览" : "Close preview"}
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {filePreviewLoading ? (
                        <p className="kb-panel-empty">{isZh ? "正在加载预览…" : "Loading preview…"}</p>
                      ) : null}
                      {filePreviewError ? <p className="kb-panel-error" role="alert">{filePreviewError}</p> : null}
                      {!filePreviewLoading && !filePreviewError && filePreview ? (
                        <div className="kb-panel-preview-body">
                          <FilePreviewer language={language} preview={filePreview} />
                        </div>
                      ) : !filePreviewLoading && !filePreviewError ? (
                        <p className="kb-panel-empty">
                          {isZh ? "点击左侧文件即可预览内容" : "Select a file to preview its contents"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {knowledgePolicy ? (
          <footer className="kb-panel-footer">
            <div className="kb-panel-policy-row">
              <span className="kb-panel-policy-label">{isZh ? "检索策略" : "Retrieval policy"}</span>
              <div className="kb-policy-menu" ref={policyMenuRef}>
                <button
                  type="button"
                  className="kb-policy-menu-trigger"
                  disabled={busy}
                  aria-haspopup="listbox"
                  aria-expanded={policyMenuOpen}
                  onClick={() => setPolicyMenuOpen((open) => !open)}
                >
                  <span>
                    {knowledgePolicy.retrieval_policy === "always"
                      ? "Always"
                      : knowledgePolicy.retrieval_policy === "never"
                        ? "Never"
                        : "Auto"}
                  </span>
                  <ChevronDown size={14} />
                </button>
                {policyMenuOpen ? (
                  <div className="kb-policy-menu-dropdown" role="listbox" aria-label={isZh ? "检索策略" : "Retrieval policy"}>
                    {([
                      { value: "auto", label: "Auto" },
                      { value: "always", label: "Always" },
                      { value: "never", label: "Never" },
                    ] as const).map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        role="option"
                        aria-selected={knowledgePolicy.retrieval_policy === option.value}
                        className={`kb-policy-menu-option${knowledgePolicy.retrieval_policy === option.value ? " active" : ""}`}
                        disabled={busy}
                        onClick={() => void updateRetrievalPolicy(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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
          </footer>
        ) : null}
      </div>
    </section>
  );
}
