import { appContext } from "@/hooks/provider";
import { Dropdown, Input, message, Modal, Popconfirm, Spin } from "antd";
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MoreVertical, Search, Trash2, Library, Plus, Upload, X } from "lucide-react";
import { parse } from "yaml";
import { useConfigStore } from "../../hooks/store";
import { useModeConfigStore } from "../../store/modeConfig";
import { Agent } from "../../types/common";
import { AgentSquare } from "../features/Agents/AgentSquare";
import { useAgentInfo } from "../features/Agents/useAgentInfo";
import PlanList from "../features/Plans/PlanList";
import { GeneralConfig, useSettingsStore } from "../store";
import type { Session, FilesEvent, MessageFileItem } from "../types/datamodel";
import { settingsAPI, docmasterAPI, type DocMasterTemplateEntry, type DocMasterPptxPreviewSlide } from "./api";
import ChatView from "../../pages/chat/chat";
import NewChatView from "../../pages/chat/NewChatView";
import { useAgentManager } from "./hooks/useAgentManager";
import { useLocation, useNavigate } from "../../hooks/useRouter";
import { useSessionManager } from "./hooks/useSessionManager";
import { useSessionStorage } from "./hooks/useSessionStorage";
import { useWebSocketManager } from "./hooks/useWebSocketManager";
import AgentManagementPage from "../../pages/AgentManagementPage";
import ChannelsPage from "../../pages/settings/ChannelsPage";
import FilePreviewPage from "../../pages/FilePreviewPage";
import LogsPage from "../../pages/settings/LogsPage";
import Config from "../../pages/settings/Config";
import SkillsSquarePage from "../../pages/SkillsSquarePage";
import UserManagementPage from "../../pages/UserManagementPage";
import CooperationManagementPage from "../../pages/CooperationManagementPage";
import LibraryPage from "../../pages/library/LibraryPage";
import type { ServerUploadedFileInfo } from "../../pages/chat/chat/hooks/useFileUpload";
import {
  MENU_LABELS,
  MENU_IDS,
  type CanvasViewId,
  type MenuId,
  createSearchWithMenu,
  createSearchWithView,
  getCanvasViewFromSearch,
  getMenuIdFromSearch,
} from "./menuRoutes";
import { SessionEditor } from "./session_editor";
import { AppLayout } from "../../layout";
import { useRightPanelStore } from "../../store/rightPanel";

export const SessionManager: React.FC = () => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyScrollTopRef = useRef(0);
  /** 从「库」带入聊天输入框的已上传文件（短时清空引用，避免重复注入） */
  const [libraryAttachPrefill, setLibraryAttachPrefill] = useState<
    ServerUploadedFileInfo[] | null
  >(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [baseUrl, setBaseUrl] = useState<string | undefined>();
  const [sessionFileEvents, setSessionFileEvents] = useState<Record<number, FilesEvent[]>>({});
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<MessageFileItem | null>(null);
  const [previewReadOnly, setPreviewReadOnly] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const activeSubMenuItem = useMemo(
    () => getMenuIdFromSearch(location.search),
    [location.search]
  );
  const activeCanvasView = useMemo(
    () => getCanvasViewFromSearch(location.search),
    [location.search]
  );
  const activeMenuLabel = useMemo(
    () => MENU_LABELS[activeSubMenuItem],
    [activeSubMenuItem]
  );

  const navigateToMenu = useCallback(
    (menuId: MenuId) => {
      const withMenu = createSearchWithMenu(location.search, menuId);
      navigate(createSearchWithView(withMenu, "chat"));
    },
    [location.search, navigate]
  );

  const navigateToView = useCallback(
    (viewId: CanvasViewId) => {
      navigate(createSearchWithView(location.search, viewId));
    },
    [location.search, navigate]
  );

  const { user, darkMode } = useContext(appContext);
  const rightPanelTab = useRightPanelStore((s) => s.layoutTab);
  const formatFileSize = useCallback((size: number | null | undefined) => {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "-";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const buildDownloadHref = useCallback((file: MessageFileItem): string | null => {
    if (file.download_method === "url" && file.url) return file.url;
    if (file.download_method === "base64" && file.base64_content) {
      const mime = file.mime_type || "application/octet-stream";
      return `data:${mime};base64,${file.base64_content}`;
    }
    return null;
  }, []);

  const handleFileEventsChange = useCallback((sessionId: number, fileEvents: FilesEvent[]) => {
    setSessionFileEvents((prev) => {
      const current = prev[sessionId] || [];
      if (current === fileEvents) return prev;
      return {
        ...prev,
        [sessionId]: fileEvents,
      };
    });
  }, []);

  const { session, setSession, setSessions } = useConfigStore();
  const { selectedAgent, setSelectedAgent, setConfig } = useModeConfigStore();
  const { saveSessionId } = useSessionStorage();
  const { config: settingsConfig, updateConfig: updateSettingsConfig } = useSettingsStore();

  // Session management
  const {
    sessions,
    isLoading: isSessionLoading,
    sessionRunStatuses,
    pendingFirstMessage,
    fetchSessions,
    selectSession,
    createNewChatSession,
    updateSession,
    updateSessionName,
    deleteSession,
    clearCurrentSession,
    updateSessionRunStatus,
    setPendingFirstMessage,
  } = useSessionManager({
    userEmail: user?.email,
    onSuccess: (msg) => messageApi.success(msg),
    onError: (msg) => messageApi.error(msg),
  });

  // WebSocket management
  const { getSessionSocket, closeSocket, stopSession } = useWebSocketManager();

  // Agent management
  const { agents, fetchAgentList, deleteAgent } = useAgentManager(user?.email);

  const { agentInfo } = useAgentInfo(user?.email);

  // Load settings on page refresh
  useEffect(() => {
    const loadSettings = async () => {
      if (user?.email) {
        try {
          // 请求全局setting配置
          const settings = await settingsAPI.getSettings(user.email) as GeneralConfig;
          // 不再使用服务端/历史里的 default_agent_id 驱动前端选中的智能体
          const { default_agent_id: _omit, ...settingsForStore } = settings as GeneralConfig & {
            default_agent_id?: string;
          };

          // 存储到store
          updateSettingsConfig(settingsForStore as GeneralConfig);

          // 更新前端页面渲染（通过store的更新自动触发）
          // 同时提取baseUrl用于其他用途
          if (settings.model_configs) {
            try {
              const parsed = parse(settings.model_configs);
              const baseUrl = parsed.model_config?.config?.base_url;
              if (baseUrl) {
                setBaseUrl(baseUrl);
              }
            } catch (parseError) {
              console.warn("Failed to parse model_configs for baseUrl:", parseError);
            }
          }
        } catch (error) {
          console.error("Failed to load settings:", error);
        }
      }
    };
    loadSettings();
  }, [user?.email, updateSettingsConfig]);

  // 等 modeConfig 从 localStorage rehydrate 后再拉列表，否则 agentId 未恢复会误选默认智能体
  useEffect(() => {
    if (!user?.email) return;
    const run = () => fetchAgentList();
    if (useModeConfigStore.persist.hasHydrated()) {
      run();
      return;
    }
    return useModeConfigStore.persist.onFinishHydration(() => {
      run();
    });
  }, [user?.email, fetchAgentList]);

  useEffect(() => {
    const handleAgentListChanged = () => {
      fetchAgentList();
    };

    window.addEventListener(
      "agentListChanged",
      handleAgentListChanged as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "agentListChanged",
        handleAgentListChanged as unknown as EventListener
      );
    };
  }, [fetchAgentList]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 库 → 聊天 时把文件放在 state 里传给 NewChatView；不要用短时定时器清空，否则智能体信息未加载完时
  // NewChatView 尚未挂载，prefill 已被清空，输入框收不到附件。
  useEffect(() => {
    if (activeSubMenuItem === MENU_IDS.currentSession) return;
    if (!libraryAttachPrefill) return;
    setLibraryAttachPrefill(null);
  }, [activeSubMenuItem, libraryAttachPrefill]);

  const { setAgentId, setMode } = useModeConfigStore();
  // Handle agent click
  const handleAgentClick = useCallback(async (agent: Agent) => {
    if (!user?.email) return;

    // 更新 agentId（在函数开始时就设置，确保及时触发 useAgentInfo）
    if (agent.id) {
      setAgentId(agent.id);
    } else {
      setAgentId(null);
    }
    setMode(agent.mode || "");
    // 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
    // 对于非自定义智能体，使用 mode 来判断
    const isDifferentAgent = agent.type === "add"
      ? (selectedAgent?.id !== agent.id && selectedAgent?.name !== agent.name)
      : (selectedAgent?.mode !== agent.mode);
    if (isDifferentAgent) {
      clearCurrentSession();
    }

    navigateToMenu(MENU_IDS.currentSession);

  }, [user?.email, selectedAgent, clearCurrentSession, setAgentId, setMode]);

  // Handle edit session
  const handleEditSession = useCallback(async (sessionData?: Session) => {
    navigateToMenu(MENU_IDS.currentSession);

    if (sessionData) {
      setEditingSession(sessionData);
      setIsEditorOpen(true);
    } else {
      // 不创建新会话，只是清空当前会话
      // 保持当前选中的 agent 不变
      // 会话将在用户发送第一条消息时创建
      clearCurrentSession();
    }
  }, [clearCurrentSession]);

  // Handle save session
  const handleSaveSession = useCallback(async (sessionData: Partial<Session>) => {
    await updateSession(sessionData);
    setIsEditorOpen(false);
    setEditingSession(undefined);
  }, [updateSession]);

  // Handle delete session
  const handleDeleteSession = useCallback(async (sessionId: number) => {
    const isDeletingCurrentSession = session?.id === sessionId;
    await deleteSession(sessionId, closeSocket);

    // 如果删除的是当前会话，确保显示 NewChatView
    if (isDeletingCurrentSession) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [deleteSession, closeSocket, session?.id]);

  // Handle delete agent
  const handleDeleteAgent = useCallback(async (id: string) => {
    await deleteAgent(
      id,
      () => messageApi.success("Agent deleted successfully"),
      () => messageApi.error("Failed to delete agent")
    );
  }, [deleteAgent, messageApi]);

  // Handle stop session
  const handleStopSession = useCallback((sessionId: number) => {
    if (sessionId === undefined || sessionId === null) return;

    stopSession(sessionId);
    updateSessionRunStatus(sessionId, "stopped");
  }, [stopSession, updateSessionRunStatus]);

  // Handle create session from plan
  const handleCreateSessionFromPlan = useCallback((sessionId: number, planData: any) => {
    selectSession({ id: sessionId } as Session);

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("planReady", {
          detail: {
            planData: planData,
            sessionId: sessionId,
            messageId: `plan_${Date.now()}`,
          },
        })
      );
    }, 2000);
  }, [selectSession]);

  // Handle selecting a session from sidebar / plan list:
  // always switch back to "current_session" view so the chat is visible.
  const handleSelectSession = useCallback(
    async (selectedSession: Session) => {
      if (historyScrollRef.current) {
        historyScrollTopRef.current = historyScrollRef.current.scrollTop;
      }
      navigateToMenu(MENU_IDS.currentSession);
      selectSession(selectedSession);
    },
    [selectSession]
  );

  const setHistoryScrollContainer = useCallback((el: HTMLDivElement | null) => {
    historyScrollRef.current = el;
    if (el) {
      el.scrollTop = historyScrollTopRef.current;
    }
  }, []);

  useLayoutEffect(() => {
    if (rightPanelTab !== "history") return;
    const el = historyScrollRef.current;
    if (!el) return;
    el.scrollTop = historyScrollTopRef.current;
  }, [rightPanelTab, session?.id, sessions]);

  // Listen for switchToCurrentSession event
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession, config, clearSession } = event.detail || {};

      navigateToMenu(MENU_IDS.currentSession);
      if (agent) {
        setSelectedAgent(agent);
      }
      if (config) {
        setConfig(config);
      }

      if (clearSession) {
        clearCurrentSession();
        return;
      }

      if (newSession) {
        try {
          const currentSessions = Array.isArray(sessions) ? sessions : [];
          setSessions([newSession, ...currentSessions]);
          setSession(newSession);

          window.history.pushState({}, "", `?sessionId=${newSession.id}`);
          saveSessionId(newSession.id);
        } catch (error) {
          console.error("Error setting new session:", error);
        }
      }
    };

    window.addEventListener(
      "switchToCurrentSession",
      handleSwitchToCurrentSession as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "switchToCurrentSession",
        handleSwitchToCurrentSession as unknown as EventListener
      );
    };
  }, [setSelectedAgent, sessions, setSessions, setSession, saveSessionId, setConfig, clearCurrentSession]);

  // Listen for sessionDeleted event and ensure NewChatView is shown
  useEffect(() => {
    const handleSessionDeleted = () => {
      navigateToMenu(MENU_IDS.currentSession);
    };

    window.addEventListener(
      "sessionDeleted",
      handleSessionDeleted as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "sessionDeleted",
        handleSessionDeleted as unknown as EventListener
      );
    };
  }, []);

  // Ensure NewChatView is shown when session becomes null
  useEffect(() => {

    // Only enforce the chat menu when the user is already on chat.
    // Otherwise (e.g. agent_management), keep the current menu on refresh.
    if (
      activeSubMenuItem === MENU_IDS.currentSession &&
      !session &&
      selectedAgent &&
      selectedAgent.name
    ) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [activeSubMenuItem, session, selectedAgent, navigateToMenu]);

  // Chat views
  const chatViews = useMemo(() => {
    if (!Array.isArray(sessions) || !session) {
      return [];
    }

    return sessions.map((s: Session) => {
      if (!s.id) return null;

      // Always render ChatView for all sessions to preserve streamed messages when switching.
      // Non-current sessions are hidden via CSS (className="hidden").
      return (
        <div
          key={s.id}
          className={`${session?.id === s.id ? "block" : "hidden"} relative h-full min-h-0`}
        >
          <ChatView
            session={s}
            onSessionNameChange={updateSessionName}
            getSessionSocket={getSessionSocket}
            visible={session?.id === s.id}
            onRunStatusChange={updateSessionRunStatus}
            pendingFirstMessage={session?.id === s.id ? pendingFirstMessage : null}
            onPendingMessageSent={() => setPendingFirstMessage(null)}
            libraryServerFilesPrefill={
              session?.id === s.id ? libraryAttachPrefill : null
            }
            onFileEventsChange={handleFileEventsChange}
          />
        </div>
      );
    });
  }, [
    sessions,
    session,
    updateSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    pendingFirstMessage,
    libraryAttachPrefill,
    handleFileEventsChange,
  ]);

  const rightPanelFiles = useMemo(() => {
    const currentSessionId = session?.id;
    if (!currentSessionId) return null;
    const events = sessionFileEvents[currentSessionId] || [];
    const files = events.flatMap((event) => event.content?.files || []);
    if (files.length === 0) return null;

    return (
      <div className="h-full overflow-y-auto p-3 space-y-2">
        {files.map((file, index) => {
          const href = buildDownloadHref(file);
          return (
            <div
              key={`${file.name}-${index}`}
              className="rounded-lg border border-border-primary/30 bg-tertiary/10 p-3"
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedPreviewFile(file);
                  setPreviewReadOnly(false);
                  navigateToView("file_preview");
                }}
                className="text-sm font-medium text-primary break-all text-left hover:text-accent transition-colors"
                title="点击预览并编辑"
              >
                {file.name || `file-${index + 1}`}
              </button>
              <div className="mt-1 text-xs text-secondary">
                {file.description || "无描述"} · {formatFileSize(file.size)}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreviewFile(file);
                    setPreviewReadOnly(false);
                    navigateToView("file_preview");
                  }}
                  className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30 transition-colors"
                >
                  预览/编辑
                </button>
                {href ? (
                  <a
                    href={href}
                    download={file.name || `file-${index + 1}`}
                    target={file.download_method === "url" ? "_blank" : undefined}
                    rel={file.download_method === "url" ? "noreferrer" : undefined}
                    className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                  >
                    下载文件
                  </a>
                ) : (
                  <span className="text-xs text-secondary">暂无可用下载链接</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [session?.id, sessionFileEvents, buildDownloadHref, formatFileSize]);

  // Templates tab (DocMaster only) ------------------------------------------------
  const isDocMaster = useMemo(() => {
    const name =
      (agentInfo as { name?: string } | null | undefined)?.name ||
      selectedAgent?.name ||
      "";
    return name === "DocMaster";
  }, [agentInfo, selectedAgent]);

  const [docmasterTemplates, setDocmasterTemplates] = useState<{
    shared: DocMasterTemplateEntry[];
    mine: DocMasterTemplateEntry[];
  }>({ shared: [], mine: [] });
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!isDocMaster) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const data = await docmasterAPI.listTemplates({ userId: user?.email });
      setDocmasterTemplates(data);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "加载模板失败");
    } finally {
      setTemplatesLoading(false);
    }
  }, [isDocMaster, user?.email]);

  useEffect(() => {
    if (!isDocMaster) {
      setDocmasterTemplates({ shared: [], mine: [] });
      return;
    }
    void fetchTemplates();
  }, [isDocMaster, fetchTemplates]);

  // Allow chat-side template save/delete tool flows to refresh the catalog.
  useEffect(() => {
    if (!isDocMaster) return;
    const handler = () => {
      void fetchTemplates();
    };
    window.addEventListener("drsai:templateLibraryChanged", handler);
    return () => {
      window.removeEventListener("drsai:templateLibraryChanged", handler);
    };
  }, [isDocMaster, fetchTemplates]);

  const handleUseTemplate = useCallback((entry: DocMasterTemplateEntry) => {
    const alias =
      (Array.isArray(entry.aliases) && entry.aliases.find((a) => a && a.trim())) ||
      entry.name;
    if (!alias) return;
    const text = `请使用模板 ${alias}`;
    window.dispatchEvent(
      new CustomEvent("drsai:chatinput:setValue", { detail: { text } })
    );
    navigateToMenu(MENU_IDS.currentSession);
    navigateToView("chat");
  }, [navigateToMenu, navigateToView]);

  const handlePreviewTemplate = useCallback(async (entry: DocMasterTemplateEntry) => {
    const source = (entry.source as "shared" | "mine") || "shared";
    const templateId = typeof entry.id === "string" ? entry.id : entry.name;
    if (!templateId) return;
    const fileType = String(entry.file_type || "docx").toLowerCase();

    if (fileType === "pptx") {
      try {
        const preview = await docmasterAPI.getPptxPreview({
          templateId,
          source,
          userId: source === "mine" ? user?.email : undefined,
        });
        const previewFile: MessageFileItem & { preview_slides?: DocMasterPptxPreviewSlide[]; previewSlides?: DocMasterPptxPreviewSlide[] } = {
          name: `${entry.name || templateId}.pptx`,
          url: docmasterAPI.templateFileUrl({
            templateId,
            source,
            userId: source === "mine" ? user?.email : undefined,
          }),
          base64_content: "",
          size: 0,
          mime_type:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          description: entry.description || "模板预览（只读）",
          download_method: "url",
          preview_slides: preview.slides,
          previewSlides: preview.slides,
        };
        setSelectedPreviewFile(previewFile);
        setPreviewReadOnly(true);
        navigateToView("file_preview");
      } catch (err) {
        messageApi.error(err instanceof Error ? err.message : "PPTX 预览加载失败");
      }
      return;
    }

    const url = docmasterAPI.templateFileUrl({
      templateId,
      source,
      userId: source === "mine" ? user?.email : undefined,
    });
    const previewFile: MessageFileItem = {
      name: `${entry.name || templateId}.docx`,
      url,
      base64_content: "",
      size: 0,
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      description: entry.description || "模板预览（只读）",
      download_method: "url",
    };
    setSelectedPreviewFile(previewFile);
    setPreviewReadOnly(true);
    navigateToView("file_preview");
  }, [navigateToView, user?.email, messageApi]);

  // --- Add / delete template flows --------------------------------------------
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [addTemplateName, setAddTemplateName] = useState("");
  const [addTemplateDescription, setAddTemplateDescription] = useState("");
  const [addTemplateCategory, setAddTemplateCategory] = useState("");
  const [addTemplateTags, setAddTemplateTags] = useState("");
  const [addTemplateAliases, setAddTemplateAliases] = useState("");
  const [addTemplateFile, setAddTemplateFile] = useState<File | null>(null);
  const [addTemplateSubmitting, setAddTemplateSubmitting] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const resetAddTemplateForm = useCallback(() => {
    setAddTemplateName("");
    setAddTemplateDescription("");
    setAddTemplateCategory("");
    setAddTemplateTags("");
    setAddTemplateAliases("");
    setAddTemplateFile(null);
  }, []);

  const openAddTemplate = useCallback(() => {
    resetAddTemplateForm();
    setAddTemplateOpen(true);
  }, [resetAddTemplateForm]);

  const parseCsvList = (raw: string): string[] =>
    raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmitAddTemplate = useCallback(async () => {
    if (!user?.email) {
      messageApi.error("未登录或无法识别用户邮箱");
      return;
    }
    if (!addTemplateFile) {
      messageApi.error("请选择 .docx 或 .pptx 模板文件");
      return;
    }
    if (![".docx", ".pptx"].some((ext) => addTemplateFile.name.toLowerCase().endsWith(ext))) {
      messageApi.error("模板必须是 .docx 或 .pptx 文件");
      return;
    }
    if (!addTemplateName.trim()) {
      messageApi.error("请填写模板名称");
      return;
    }
    setAddTemplateSubmitting(true);
    try {
      await docmasterAPI.saveTemplate({
        userId: user.email,
        name: addTemplateName.trim(),
        description: addTemplateDescription.trim(),
        category: addTemplateCategory.trim() || undefined,
        tags: parseCsvList(addTemplateTags),
        aliases: parseCsvList(addTemplateAliases),
        file: addTemplateFile,
      });
      messageApi.success("模板已保存");
      setAddTemplateOpen(false);
      resetAddTemplateForm();
      await fetchTemplates();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "保存模板失败");
    } finally {
      setAddTemplateSubmitting(false);
    }
  }, [
    user?.email,
    addTemplateFile,
    addTemplateName,
    addTemplateDescription,
    addTemplateCategory,
    addTemplateTags,
    addTemplateAliases,
    messageApi,
    fetchTemplates,
    resetAddTemplateForm,
  ]);

  const handleDeleteTemplate = useCallback(async (entry: DocMasterTemplateEntry) => {
    if (!user?.email) {
      messageApi.error("未登录或无法识别用户邮箱");
      return;
    }
    const templateId = typeof entry.id === "string" ? entry.id : "";
    if (!templateId) return;
    setDeletingTemplateId(templateId);
    try {
      await docmasterAPI.deleteTemplate({ templateId, userId: user.email });
      messageApi.success(`已删除模板 ${entry.name || templateId}`);
      await fetchTemplates();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "删除模板失败");
    } finally {
      setDeletingTemplateId(null);
    }
  }, [user?.email, messageApi, fetchTemplates]);

  const rightPanelTemplates = useMemo(() => {
    if (!isDocMaster) return null;

    const isDark = darkMode === "dark";
    const cardBase = isDark
      ? "rounded-lg border border-border-primary/30 bg-tertiary/10 p-3 hover:bg-tertiary/20"
      : "rounded-lg border border-gray-200/70 bg-white/70 p-3 hover:bg-gray-100/60";
    const chipBase = isDark
      ? "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-white/[0.06] text-secondary"
      : "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600";
    const aliasChip = isDark
      ? "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-accent/15 text-accent"
      : "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-violet-100 text-violet-700";

    const actionBtn = isDark
      ? "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-white/[0.06] text-primary hover:bg-white/[0.12]"
      : "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-gray-100 text-gray-700 hover:bg-gray-200";
    const actionBtnAccent = isDark
      ? "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25"
      : "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200";

    const renderEntry = (entry: DocMasterTemplateEntry, idx: number) => {
      const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [];
      const tags = Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [];
      return (
        <div
          key={`${entry.name || "tpl"}-${idx}`}
          role="button"
          tabIndex={0}
          onClick={() => handlePreviewTemplate(entry)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handlePreviewTemplate(entry);
            }
          }}
          className={`block w-full text-left transition-colors cursor-pointer ${cardBase}`}
          title="点击预览模板内容"
        >
          <div className="text-sm font-medium text-primary break-all">
            {entry.name || `模板 ${idx + 1}`}
          </div>
          {entry.description && (
            <div className="mt-1 text-xs text-secondary break-all line-clamp-2">
              {entry.description}
            </div>
          )}
          {(entry.category || tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.category && (
                <span className={chipBase}>{entry.category}</span>
              )}
              {tags.map((t) => (
                <span key={t} className={chipBase}>#{t}</span>
              ))}
            </div>
          )}
          {aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {aliases.map((a) => (
                <span key={a} className={aliasChip}>{a}</span>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePreviewTemplate(entry);
              }}
              className={actionBtn}
            >
              预览
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUseTemplate(entry);
              }}
              className={actionBtnAccent}
              title="把 “请使用模板 …” 写入聊天输入框"
            >
              使用
            </button>
            {entry.source === "mine" && (
              <Popconfirm
                title="删除该模板？"
                description="只会从你的模板库移除，共享模板不受影响。"
                okText="删除"
                okButtonProps={{ danger: true, loading: deletingTemplateId === entry.id }}
                cancelText="取消"
                onConfirm={(e) => {
                  e?.stopPropagation?.();
                  void handleDeleteTemplate(entry);
                }}
                onCancel={(e) => e?.stopPropagation?.()}
              >
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className={`ml-auto inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    isDark
                      ? "text-red-300/80 hover:text-red-300 hover:bg-red-500/10"
                      : "text-red-500/80 hover:text-red-600 hover:bg-red-50"
                  }`}
                  title="删除该模板"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Popconfirm>
            )}
          </div>
        </div>
      );
    };

    const sectionHeader = (text: string, count: number) => (
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-secondary tracking-wide uppercase">
          {text}
        </span>
        <span className="text-[11px] text-secondary opacity-70">{count}</span>
      </div>
    );

    const { shared, mine } = docmasterTemplates;
    const hasAny = shared.length > 0 || mine.length > 0;

    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 flex items-center justify-between px-3 pt-3 pb-2">
          <div className="text-[11px] text-secondary opacity-70">
            点击条目预览 · “使用” 写入聊天输入框
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openAddTemplate}
              className={`text-[11px] rounded-md px-2 py-1 inline-flex items-center gap-1 transition-colors ${
                isDark
                  ? "text-accent hover:bg-accent/10"
                  : "text-violet-700 hover:bg-violet-100"
              }`}
              title="上传新模板到我的模板库"
            >
              <Plus className="w-3.5 h-3.5" />
              添加
            </button>
            <button
              type="button"
              onClick={() => void fetchTemplates()}
              disabled={templatesLoading}
              className={`text-[11px] rounded-md px-2 py-1 transition-colors ${
                templatesLoading
                  ? "opacity-40 cursor-not-allowed"
                  : isDark
                    ? "text-secondary hover:text-primary hover:bg-white/5"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/60"
              }`}
            >
              {templatesLoading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
          {templatesError && (
            <div className="text-xs text-red-500/90 px-1">{templatesError}</div>
          )}
          {!templatesError && !templatesLoading && !hasAny && (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="text-center">
                <Library className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm opacity-50">暂无模板</p>
              </div>
            </div>
          )}
          {shared.length > 0 && (
            <div>
              {sectionHeader("共享模板", shared.length)}
              <div className="space-y-2">{shared.map(renderEntry)}</div>
            </div>
          )}
          {mine.length > 0 && (
            <div>
              {sectionHeader("我的模板", mine.length)}
              <div className="space-y-2">{mine.map(renderEntry)}</div>
            </div>
          )}
        </div>
      </div>
    );
  }, [
    isDocMaster,
    docmasterTemplates,
    templatesLoading,
    templatesError,
    darkMode,
    handleUseTemplate,
    handlePreviewTemplate,
    handleDeleteTemplate,
    deletingTemplateId,
    openAddTemplate,
    fetchTemplates,
  ]);

  const rightPanelHistory = useMemo(() => {
    const sortedSessions = Array.isArray(sessions)
      ? [...sessions].sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      )
      : [];

    if (sortedSessions.length === 0) {
      return null;
    }

    const q = historySearchQuery.trim().toLowerCase();
    const filteredSessions = q
      ? sortedSessions.filter((s) => {
        const name = (s.name || "").toLowerCase();
        const idStr = s.id != null ? String(s.id) : "";
        return name.includes(q) || idStr.includes(q);
      })
      : sortedSessions;

    const inputRing =
      darkMode === "dark"
        ? "border-border-primary/40 bg-white/[0.04] text-primary placeholder:text-secondary/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        : "border-gray-200/90 bg-white text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-200";

    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 px-3 pt-3 pb-2">
          <label className="sr-only" htmlFor="history-session-search">
            搜索会话
          </label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none"
              aria-hidden
            />
            <input
              id="history-session-search"
              type="search"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              placeholder="搜索会话名称或 ID…"
              autoComplete="off"
              className={`w-full rounded-lg pl-9 pr-3 py-2 text-sm border outline-none transition-shadow ${inputRing}`}
            />
          </div>
        </div>
        <div
          ref={setHistoryScrollContainer}
          onScroll={(e) => {
            historyScrollTopRef.current = e.currentTarget.scrollTop;
          }}
          className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1"
        >
          {filteredSessions.length === 0 ? (
            <div className="text-center text-sm text-secondary py-8 px-2">
              无匹配会话，请调整关键词
            </div>
          ) : (
            filteredSessions.map((historySession) => {
              const isCurrent = session?.id === historySession.id;
              const lastTime = historySession.updated_at || historySession.created_at;
              const sid = historySession.id;
              return (
                <div
                  key={sid ?? historySession.name}
                  className={`group relative flex items-center gap-0.5 rounded-lg transition-colors ${isCurrent ? "bg-accent/10" : "hover:bg-tertiary/15"
                    }`}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void handleSelectSession(historySession)}
                    className={`flex-1 min-w-0 text-left rounded-lg px-3 py-2 pr-1 transition-colors ${isCurrent ? "text-accent" : "text-primary"
                      }`}
                  >
                    <div className="text-sm font-medium truncate">
                      {historySession.name || `Session ${sid ?? ""}`}
                    </div>
                    <div className="text-xs text-secondary mt-1">
                      {lastTime ? new Date(lastTime).toLocaleString() : "-"}
                    </div>
                  </button>
                  {sid != null && (
                    <div className="flex-shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                          items: [
                            {
                              key: "delete",
                              danger: true,
                              disabled: isSessionLoading,
                              label: (
                                <>
                                  <Trash2 className="w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle" />
                                  删除
                                </>
                              ),
                              onClick: (e) => {
                                e.domEvent.stopPropagation();
                                void handleDeleteSession(sid);
                              },
                            },
                          ],
                        }}
                      >
                        <button
                          type="button"
                          title="更多"
                          aria-haspopup="menu"
                          aria-label="会话操作"
                          disabled={isSessionLoading}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`flex items-center justify-center w-7 h-7 rounded-lg outline-none border-0 bg-transparent shadow-none ring-0 transition-colors ${isSessionLoading
                              ? "opacity-40 cursor-not-allowed"
                              : "text-secondary hover:text-primary hover:bg-tertiary/30"
                            }`}
                        >
                          <MoreVertical className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                      </Dropdown>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }, [
    sessions,
    session?.id,
    handleSelectSession,
    historySearchQuery,
    darkMode,
    isSessionLoading,
    handleDeleteSession,
  ]);

  return (
    <>
      {contextHolder}

      <AppLayout
        // TopNav
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}

        // LeftMenu
        activeSubMenuItem={activeSubMenuItem}
        activeMenuLabel={activeMenuLabel}
        onSubMenuChange={(tabId) => navigateToMenu(tabId as MenuId)}
        canvasActiveView={activeCanvasView}
        onCanvasViewChange={navigateToView}
        canvasFilePreviewContent={<FilePreviewPage file={selectedPreviewFile} sessionId={session?.id ?? null} readOnly={previewReadOnly} onFileEvent={(evt) => {
          const sid = session?.id;
          if (!sid) return;
          setSessionFileEvents((prev) => ({
            ...prev,
            [sid]: [...(prev[sid] || []), evt],
          }));
        }} />}
        rightPanelHistory={rightPanelHistory}
        rightPanelFiles={rightPanelFiles}
        rightPanelTemplates={isDocMaster ? rightPanelTemplates : undefined}
        onRightPanelTabChange={(tab) => {
          if (tab === "files" || tab === "templates") {
            // Keep the current canvas view when switching to a non-chat side tab.
            // The canvas should switch only on explicit user action (e.g. file preview).
            return;
          }
          navigateToView("chat");
        }}
        onNewSession={() => {
          navigateToMenu(MENU_IDS.currentSession);
          navigateToView("chat");
          clearCurrentSession();
        }}
        showNewSessionButton={Boolean(session)}
      >
        {/* Canvas content */}
        {activeSubMenuItem === MENU_IDS.currentSession ? (
          (() => {
            if (session) {
              return <div className="h-full min-h-0">{chatViews}</div>;
            } else if (agentInfo || selectedAgent) {
              const chatAgent = (agentInfo || selectedAgent) as Agent;
              return (
                <NewChatView
                  agent={chatAgent}
                  serverFilesPrefill={libraryAttachPrefill}
                  onSubmit={async (agent, query, files, plan) => {
                    await createNewChatSession(agent, query, files, plan);
                  }}
                />
              );
            } else {
              return (
                <div className="flex items-center justify-center h-full text-secondary">
                  <div className="text-center">
                    <Spin size="large" />
                    <p className="mt-4 text-sm">Loading...</p>
                  </div>
                </div>
              );
            }
          })()
        ) : activeSubMenuItem === MENU_IDS.agentSquare || activeSubMenuItem === MENU_IDS.myAgents ? (
          <div className="h-full overflow-hidden">
            <AgentSquare agents={[]} handleAgentList={fetchAgentList} />
          </div>
        ) : activeSubMenuItem === MENU_IDS.skillsSquare ? (
          <SkillsSquarePage />
        ) : activeSubMenuItem === MENU_IDS.channels ? (
          <ChannelsPage />
        ) : activeSubMenuItem === MENU_IDS.logs ? (
          <LogsPage />
        ) : activeSubMenuItem === MENU_IDS.cooperationManagement ? (
          <CooperationManagementPage />
        ) : activeSubMenuItem === MENU_IDS.agentManagement ? (
          <AgentManagementPage />
        ) : activeSubMenuItem === MENU_IDS.userManagement ? (
          <UserManagementPage />
        ) : activeSubMenuItem === MENU_IDS.profile ? (
          <Config
            user={user || { name: "", email: "" }}
            onClose={() => navigateToMenu(MENU_IDS.currentSession)}
          />
        ) : activeSubMenuItem === MENU_IDS.savedPlan ? (
          <div className="h-full overflow-hidden">
            <PlanList
              onTabChange={(tabId) => navigateToMenu(tabId as MenuId)}
              onSelectSession={handleSelectSession}
              onCreateSessionFromPlan={handleCreateSessionFromPlan}
            />
          </div>
        ) : activeSubMenuItem === MENU_IDS.library ? (
          <div className="h-full min-h-0 overflow-hidden">
            <LibraryPage
              onStartChat={async (files, query) => {
                const chatAgent = (agentInfo || selectedAgent) as import("../../types/common").Agent;
                if (!chatAgent) return;
                // 把文件放进 prefill 以便 ChatView 回显（不重新上传）
                flushSync(() => setLibraryAttachPrefill(files));
                // 直接创建会话并发送首条消息，跳过 NewChatView
                await createNewChatSession(chatAgent, query, files);
                // Use live URL after clearCurrentSession so sessionId is not re-applied from stale React location
                const withMenu = createSearchWithMenu(
                  window.location.search,
                  MENU_IDS.currentSession
                );
                navigate(createSearchWithView(withMenu, "chat"));
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-secondary">
            <div className="text-center">
              <p className="text-sm opacity-50">敬请期待</p>
            </div>
          </div>
        )}

        <SessionEditor
          session={editingSession}
          isOpen={isEditorOpen}
          onSave={handleSaveSession}
          onCancel={() => {
            setIsEditorOpen(false);
            setEditingSession(undefined);
          }}
        />
      </AppLayout>

      <Modal
        title="添加模板"
        open={addTemplateOpen}
        onCancel={() => {
          if (addTemplateSubmitting) return;
          setAddTemplateOpen(false);
        }}
        onOk={() => void handleSubmitAddTemplate()}
        okText="保存"
        cancelText="取消"
        confirmLoading={addTemplateSubmitting}
        destroyOnClose
        maskClosable={!addTemplateSubmitting}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-secondary mb-1">
              模板文件 <span className="text-red-500">*</span> <span className="opacity-60">(.docx / .pptx)</span>
            </label>
            <div className="flex items-center gap-2">
              <label
                className="inline-flex items-center gap-1.5 cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
              >
                <Upload className="w-3.5 h-3.5" />
                选择文件
                <input
                  type="file"
                  accept=".docx,.pptx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setAddTemplateFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {addTemplateFile && (
                <div className="flex items-center gap-1 text-xs text-primary truncate max-w-[260px]">
                  <span className="truncate">{addTemplateFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAddTemplateFile(null)}
                    className="text-secondary hover:text-primary"
                    title="移除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">
              名称 <span className="text-red-500">*</span>
            </label>
            <Input
              value={addTemplateName}
              onChange={(e) => setAddTemplateName(e.target.value)}
              placeholder="例如：技术开发合同 3-1"
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">描述</label>
            <Input.TextArea
              value={addTemplateDescription}
              onChange={(e) => setAddTemplateDescription(e.target.value)}
              placeholder="可选，简短说明这个模板的用途"
              rows={2}
              maxLength={500}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">分类</label>
            <Input
              value={addTemplateCategory}
              onChange={(e) => setAddTemplateCategory(e.target.value)}
              placeholder="例如：合同/技术开发"
              maxLength={80}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">标签</label>
            <Input
              value={addTemplateTags}
              onChange={(e) => setAddTemplateTags(e.target.value)}
              placeholder="逗号分隔，例如：合同, 技术开发"
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">别名</label>
            <Input
              value={addTemplateAliases}
              onChange={(e) => setAddTemplateAliases(e.target.value)}
              placeholder="逗号分隔，便于 “请使用模板 …” 命中"
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

